import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers/school-db.mjs';
const root=new URL('../supabase/migrations/',import.meta.url);
const file=(await readdir(root)).find(n=>n.endsWith('_school_staff_people_management.sql'));
const migration=await readFile(new URL(file,root),'utf8');
const flow=await readFile(new URL('20261009113711_school_daily_data_integrity.sql',root),'utf8');
const helpers=flow.slice(flow.indexOf('create table mschool.flow_operations'),flow.indexOf('create function public.school_rollcall_read'));
const actor='1'.repeat(64);
async function scenario(run){const h=await fixture();try{
 await h.db.exec(helpers);await h.db.exec(migration);
 const list=async(who=actor)=>(await h.db.query('select public.school_staff_people($1) result',[who])).rows[0].result;
 const save=async(action='create',id=null,input={name:'Synthetic New Worker',role_type:'工讀生'},expected=null,request=randomUUID(),who=actor)=>(await h.db.query('select public.school_manage_staff_person($1,$2,$3,$4,$5,$6) result',[who,action,id,input,expected,request])).rows[0].result;
 await run({...h,list,save});
}finally{await h.db.close();}}

test('only school managers can list and mutate; unauthenticated and direct public RPC access denied',()=>scenario(async({db,list,save})=>{
 for(const who of ['2'.repeat(64),'3'.repeat(64),'f'.repeat(64)]){await assert.rejects(list(who),/school_access_denied/);await assert.rejects(save('create',null,{name:'Denied',role_type:'老師'},null,randomUUID(),who),/school_access_denied/);}
 for(const role of ['anon','authenticated'])for(const signature of ['school_staff_people(text)','school_manage_staff_person(text,text,text,jsonb,text,uuid)'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok',[role,'public.'+signature,'EXECUTE'])).rows[0].ok,false);
}));
test('create generates stable unique P/T numbers, replay creates once and never grants login or Church OS access',()=>scenario(async({db,save})=>{
 const churchBefore=(await db.query('select * from church_auth.grants order by user_id')).rows;
 const loginsBefore=(await db.query('select * from mschool.staff_access order by user_id')).rows;
 const request=randomUUID(),args=['create',null,{name:'Synthetic A',role_type:'工讀生'},null,request];
 const a=await save(...args);assert.deepEqual(await save(...args),a);assert.match(a.person.id,/^\d{4}P\d{4}$/);
 const b=await save(),t=await save('create',null,{name:'Synthetic Teacher',role_type:'老師'});
 assert.notEqual(a.person.id,b.person.id);assert.match(t.person.id,/^\d{4}T\d{4}$/);
 assert.deepEqual((await db.query('select * from mschool.staff_access order by user_id')).rows,loginsBefore);
 assert.deepEqual((await db.query('select * from church_auth.grants order by user_id')).rows,churchBefore);
 await assert.rejects(save('create',null,{name:'Changed',role_type:'老師'},null,request),/request_payload_changed/);
}));
test('edit updates only approved school personnel fields and profile type does not change login roles',()=>scenario(async({db,list,save})=>{
 await db.exec("update mschool.users set health_notes='Keep',points=17 where id='T-QA'");
 const person=(await list()).find(p=>p.id==='T-QA');
 const r=await save('update',person.id,{name:'Renamed',role_type:'工讀生',phone:'0900000000'},person.version);
 assert.equal(r.person.id,'T-QA');assert.equal(r.person.role_type,'工讀生');
 assert.equal((await db.query("select role_type from mschool.staff_access where user_id='T-QA'")).rows[0].role_type,'老師');
 assert.deepEqual((await db.query("select points,health_notes from mschool.users where id='T-QA'")).rows[0],{points:17,health_notes:'Keep'});
 await assert.rejects(save('update',person.id,{name:'Stale'},person.version),/staff_profile_changed/);
}));
test('manager profiles, self edits, students, unknown IDs and privilege fields are refused',()=>scenario(async({db,list,save})=>{
 for(const id of ['M-QA','S-QA','missing'])await assert.rejects(save('update',id,{name:'Denied'},'anything'),/school_access_denied/);
 const p=(await list()).find(p=>p.id==='P-QA');
 for(const input of [{role_type:'同工'},{role_type:'學生'},{auth_user_id:randomUUID()},{points:999},{is_active:true},{role_type:null}])await assert.rejects(save('update',p.id,input,p.version),/invalid_staff/);
 await db.exec("update mschool.staff_access set role_type='同工' where user_id='P-QA'");
 assert.equal((await list()).find(p=>p.id==='P-QA').editable,false);
 await assert.rejects(save('delete','P-QA',{},p.version),/school_access_denied/);
}));
test('delete is reversible, preserves schedules and check-ins, revokes school login only; restore never reactivates login',()=>scenario(async({db,list,save,resolve})=>{
 await db.exec("create table mschool.schedules(worker_id text,date date);create table mschool.check_in_logs(target_id text,role text);insert into mschool.schedules values('P-QA','2026-10-26');insert into mschool.check_in_logs values('P-QA','工讀生')");
 const grantsBefore=(await db.query('select * from church_auth.grants order by user_id')).rows;
 const p=(await list()).find(p=>p.id==='P-QA'),request=randomUUID();
 const result=await save('delete',p.id,{},p.version,request);assert.deepEqual(await save('delete',p.id,{},p.version,request),result);
 assert.equal(result.person.status,'離職');assert.equal(await resolve('3'.repeat(64)),null);
 assert.equal((await db.query('select count(*) n from mschool.schedules')).rows[0].n,1);assert.equal((await db.query('select count(*) n from mschool.check_in_logs')).rows[0].n,1);
 assert.deepEqual((await db.query('select * from church_auth.grants order by user_id')).rows,grantsBefore);
 await save('update',p.id,{status:'在職'},result.person.version);
 assert.equal((await db.query("select is_active from mschool.staff_access where user_id='P-QA'")).rows[0].is_active,false);
}));
test('invalid input and missing request IDs fail without creating a person',()=>scenario(async({db,save})=>{
 const before=(await db.query('select count(*) n from mschool.users')).rows[0].n;
 for(const input of [{name:'',role_type:'老師'},{name:'A',role_type:'同工'},{name:'A',role_type:'老師',status:'畢業'},{name:'A',role_type:'工讀生',phone:'x'.repeat(81)}])await assert.rejects(save('create',null,input),/invalid_staff/);
 await assert.rejects(save('create',null,{name:'A',role_type:'工讀生'},null,null),/request_id_required/);
 assert.equal((await db.query('select count(*) n from mschool.users')).rows[0].n,before);
}));
