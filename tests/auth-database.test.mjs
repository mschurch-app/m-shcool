import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite} = await import(process.env.MSCHOOL_PGLITE_MODULE || '@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20261009090347_school_auth_phase1.sql',import.meta.url),'utf8');
const usersSchema=await readFile(new URL('fixtures/school-users-schema.sql',import.meta.url),'utf8');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const sessions=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
async function fixture({ambiguous=false}={}) {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema church_auth;create schema mschool;
 create table church_auth.accounts(user_id uuid primary key,display_name text,is_active boolean);
 create table church_auth.grants(user_id uuid,church_id text,permission text);
 create table church_auth.owners(user_id uuid);
 create table church_auth.account_home_preferences(user_id uuid,church_id text,home_modules text[]);
 create table church_auth.account_identity_links(alias_user_id uuid,canonical_user_id uuid);
 create table auth.sessions(id uuid primary key,user_id uuid);
 create function church_auth.canonical_account(p_user uuid) returns uuid language sql stable as $$select coalesce((select canonical_user_id from church_auth.account_identity_links where alias_user_id=p_user),p_user)$$;
 ${usersSchema}
 create table mschool.api_sessions(token_hash text primary key,user_id text references mschool.users on delete cascade,expires_at timestamptz,created_at timestamptz default now());
 insert into mschool.users(id,name,role_type,status) values('M-QA','Synthetic Admin','同工','在班'),('T-QA','Synthetic Teacher','老師','在班'),('P-QA','Synthetic Reader','工讀生','在班'),('S-QA','Synthetic Student','學生','在班');`);
 for(let i=0;i<3;i++){
  await db.query('insert into church_auth.accounts values($1,$2,true)',[ids[i],['Synthetic Admin','Synthetic Teacher','Synthetic Reader'][i]]);
  await db.query("insert into church_auth.grants values($1,'M+','members')",[ids[i]]);
  await db.query('insert into auth.sessions values($1,$2)',[sessions[i],ids[i]]);
  await db.query("insert into church_auth.account_home_preferences values($1,'M+',array['school'])",[ids[i]]);
 }
 await db.query("insert into church_auth.accounts values($1,'Synthetic Teacher',true)",[ids[3]]);
 if(!ambiguous)await db.query('insert into church_auth.account_identity_links values($1,$2)',[ids[3],ids[1]]);
 try { await db.exec(migration); } catch(error) { await db.close(); throw error; }
 const issue=async(i=0,hash=String(i+1).repeat(64),authId=ids[i],authSession=sessions[i]) => (await db.query('select public.school_issue_session($1,$2,$3) result',[authId,authSession,hash])).rows[0].result;
 const resolve=async(hash='1'.repeat(64))=>(await db.query('select public.school_resolve_session($1) result',[hash])).rows[0].result;
 const mutate=async({actor=0,method='PATCH',id='S-QA',payload={name:'Updated Student'},upsert=false}={}) =>(await db.query('select public.school_mutate_users($1,$2,$3,$4,$5) result',[String(actor+1).repeat(64),method,id,payload,upsert])).rows[0].result;
 for(let i=0;i<3;i++)await issue(i);
 return {db,issue,resolve,mutate};
}
async function scenario(fn){const h=await fixture();try{await fn(h);}finally{await h.db.close();}}
test('migration binds approved aliases once and denies ambiguous mappings atomically',async()=>{
 await scenario(async({db})=>{assert.equal((await db.query('select count(*) n from mschool.staff_access')).rows[0].n,3);});
 await assert.rejects(fixture({ambiguous:true}),/school_identity_mapping_requires_review/);
});
test('mapped M T P roles are authoritative and arbitrary profile roles do not grant access',async()=>scenario(async({db,resolve})=>{
 assert.equal((await resolve()).role_type,'同工');
 await db.exec("update mschool.users set role_type='同工' where id='T-QA'");
 assert.equal((await resolve('2'.repeat(64))).role_type,'老師');
 assert.equal(await resolve('f'.repeat(64)),null);
 await db.query("insert into mschool.api_sessions(token_hash,user_id,expires_at) values($1,'M-QA',now()+interval '1 hour')",['e'.repeat(64)]);
 assert.equal(await resolve('e'.repeat(64)),null);
}));
test('teacher creates and edits students, edits ordinary staff fields, but cannot change roles/status or delete',async()=>scenario(async({mutate,db})=>{
 await mutate({actor:1,method:'POST',id:null,payload:[{id:'S-NEW',name:'New Student',role_type:'學生'}]});
 await mutate({actor:1,payload:{name:'Updated Student',health_notes:'Synthetic note'}});
 await mutate({actor:1,id:'M-QA',payload:{phone:'00000000',status:'在班',role_type:'同工'}});
 for(const payload of [{role_type:'同工'},{role_type:null}])await assert.rejects(mutate({actor:1,id:'T-QA',payload}),/use_staff_access_management/);
 await assert.rejects(mutate({actor:1,id:'M-QA',payload:{status:'離職'}}),/staff_status_change_denied/);
 await assert.rejects(mutate({actor:1,method:'POST',id:null,payload:[{id:'M-NEW',role_type:'同工'}]}),/staff_creation_denied/);
 await assert.rejects(mutate({actor:1,method:'DELETE'}),/school_access_denied/);
 assert.equal((await db.query("select health_notes from mschool.users where id='S-QA'")).rows[0].health_notes,'Synthetic note');
}));
test('upsert batches are atomic, preserve omitted fields and cannot replace staff identities',async()=>scenario(async({mutate,db})=>{
 await mutate({payload:{phone:'00000000',health_notes:'Keep'}});
 await mutate({actor:1,method:'POST',id:null,upsert:true,payload:[{id:'S-QA',name:'Updated',role_type:'學生'}]});
 assert.equal((await db.query("select health_notes from mschool.users where id='S-QA'")).rows[0].health_notes,'Keep');
 await assert.rejects(mutate({actor:1,method:'POST',id:null,upsert:true,payload:[{id:'S-ROLLBACK',name:'Rollback Student',role_type:'學生'},{id:'M-QA',role_type:'學生'}]}),/use_staff_access_management/);
 assert.equal((await db.query("select count(*) n from mschool.users where id='S-ROLLBACK'")).rows[0].n,0);
 await assert.rejects(mutate({payload:{unexpected_field:'unsafe'}}),/invalid_profile_fields/);
 await assert.rejects(mutate({payload:{id:'M-QA'}}),/person_id_immutable/);
 await assert.rejects(mutate({method:'PATCH',id:null}),/single_person_required/);
}));
test('read-only staff cannot mutate profiles, and managers cannot change own role/status or delete themselves',async()=>scenario(async({mutate})=>{
 await assert.rejects(mutate({actor:2}),/school_access_denied/);
 await assert.rejects(mutate({id:'M-QA',payload:{role_type:'老師'}}),/use_staff_access_management/);
 await assert.rejects(mutate({id:'M-QA',payload:{status:'離職'}}),/staff_status_change_denied/);
 await assert.rejects(mutate({method:'DELETE',id:'M-QA'}),/school_access_denied/);
}));
test('logout, expiry, account suspension, church grant revocation and staff offboarding invalidate existing sessions',async()=>scenario(async({db,resolve,issue,mutate})=>{
 await db.query('select public.school_revoke_session($1)',['1'.repeat(64)]);assert.equal(await resolve(),null);await db.exec("delete from mschool.api_sessions where user_id='M-QA'");await issue();
 await db.exec("update mschool.api_sessions set expires_at=now()-interval '1 second' where user_id='M-QA'");assert.equal(await resolve(),null);await issue(0,'d'.repeat(64));
 await db.query('update church_auth.accounts set is_active=false where user_id=$1',[ids[0]]);assert.equal(await resolve('d'.repeat(64)),null);
 await db.query('update church_auth.accounts set is_active=true where user_id=$1',[ids[0]]);
 await db.query('delete from church_auth.grants where user_id=$1',[ids[0]]);assert.equal(await resolve('d'.repeat(64)),null);
 await db.query("insert into church_auth.grants values($1,'M+','members')",[ids[0]]);
 await db.query('select public.school_mutate_users($1,$2,$3,$4,false)',['d'.repeat(64),'PATCH','T-QA',{status:'離職'}]);assert.equal(await resolve('2'.repeat(64)),null);
 await db.query("update church_auth.account_home_preferences set home_modules='{}' where user_id=$1",[ids[0]]);assert.equal(await resolve('d'.repeat(64)),null);
 await db.query("update church_auth.account_home_preferences set home_modules=array['school'] where user_id=$1",[ids[0]]);
 await db.query('delete from auth.sessions where id=$1',[sessions[0]]);assert.equal(await resolve('d'.repeat(64)),null);
}));
test('dedicated role operation requires manager, denies self changes and revokes every target session',async()=>scenario(async({db,resolve})=>{
 const change=(actor,user,auth,role,active)=>db.query('select public.school_set_staff_access($1,$2,$3,$4,$5)',[actor.repeat(64),user,auth,role,active]);
 await assert.rejects(change('2','P-QA',ids[2],'同工',true),/school_access_denied/);
 await assert.rejects(change('1','M-QA',ids[0],'老師',true),/school_self_access_change_denied/);
 await change('1','T-QA',ids[1],'工讀生',true);assert.equal(await resolve('2'.repeat(64)),null);
 assert.equal((await db.query("select role_type from mschool.staff_access where user_id='T-QA'")).rows[0].role_type,'工讀生');
 await change('1','P-QA',ids[2],'工讀生',false);assert.equal(await resolve('3'.repeat(64)),null);
}));
test('public API roles cannot read auth links or execute privileged auth RPCs',async()=>scenario(async({db})=>{
 for(const role of ['anon','authenticated']) {
  assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,'mschool.staff_access','SELECT'])).rows[0].ok,false);
  for(const signature of ['school_resolve_session(text)','school_issue_session(uuid,uuid,text)','school_mutate_users(text,text,text,jsonb,boolean)','school_set_staff_access(text,text,uuid,text,boolean)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok',[role,'public.'+signature,'EXECUTE'])).rows[0].ok,false);
 }
}));
