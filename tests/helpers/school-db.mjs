import {readFile} from 'node:fs/promises';
const {PGlite} = await import(process.env.MSCHOOL_PGLITE_MODULE || '@electric-sql/pglite');
const migration = await readFile(new URL('../../supabase/migrations/20261009090347_school_auth_phase1.sql',import.meta.url),'utf8');
const usersSchema=await readFile(new URL('../fixtures/school-users-schema.sql',import.meta.url),'utf8');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const sessions=['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc'];
export async function fixture({ambiguous=false}={}) {
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
