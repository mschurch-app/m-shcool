import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../supabase/functions/mschool-api/index.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(source.replace(/^import .*;\n/m,''),{mode:'strip'});
function harness({role='同工',active=true,verify=true,mutationError=null,upstreamStatus=200,stationRpc=null}={}){
 let handler; const calls=[],upstream=[]; const token='a'.repeat(64);
 const db={schema(){return this;},auth:{getUser:async()=>({data:{user:verify?{id:'11111111-1111-4111-8111-111111111111'}:null},error:verify?null:{message:'invalid'}})},
  rpc:async(name,payload)=>{calls.push({name,payload});if(stationRpc&&name.startsWith('school_station_'))return {data:await stationRpc(name,payload),error:null};
   if(name==='school_resolve_session')return {data:active?{id:'M-QA',role_type:role,status:'在班'}:null,error:null};
   if(name==='school_issue_session')return {data:active?{id:'M-QA',role_type:role}:null,error:null};
   if(name==='school_mutate_users')return {data:[{id:'S-QA',name:'Synthetic Student'}],error:mutationError};
   return {data:{ok:true},error:null};
  }};
 vm.runInNewContext(js,{Deno:{serve(fn){handler=fn},env:{get(k){return k==='SUPABASE_URL'?'https://isolated.invalid':'SYNTHETIC_ONLY'}}},createClient:()=>db,
  TextEncoder,Response,Request,URL,Headers,Uint8Array,crypto:webcrypto,atob,console,
  fetch:async(url,init)=>{assert.equal(new URL(url).hostname,'isolated.invalid');upstream.push({url:String(url),...init});return new Response(upstreamStatus===204?null:'[]',{status:upstreamStatus,headers:{'content-type':'application/json'}})}
 });
 const request=(path='/',method='GET',body,proxy='/schedules',headers={})=>handler(new Request('https://isolated.invalid/mschool-api'+path,{method,headers:{'content-type':'application/json','x-mschool-session':token,'x-proxy-path':proxy,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
 return {request,calls,upstream};
}
for(const [role,methods] of [['同工',['GET','POST','PATCH','DELETE']],['老師',['GET','POST','PATCH']],['工讀生',['GET']]]){
 test(`${role} server capability matrix`,async()=>{for(const method of ['GET','POST','PATCH','DELETE'])assert.equal((await harness({role}).request('/',method,method==='GET'?undefined:{name:'Synthetic'})).status,methods.includes(method)?200:403)});
}
test('unknown, student and inactive sessions receive no administrative access',async()=>{for(const role of ['學生','unknown',''])assert.equal((await harness({role}).request()).status,401);assert.equal((await harness({active:false}).request()).status,401)});
test('phone login is retired and never queries personnel or issues tokens',async()=>{
 const h=harness();assert.equal((await h.request('/manual-login','POST',{identity:'Synthetic',password:'00000000'})).status,410);
 assert.equal((await h.request('/manual-login','PUT',{})).status,405);assert.equal(h.calls.length,0);
});
test('Church OS bearer is verified before session claims or mapping are used',async()=>{
 const bearer='e30.'+Buffer.from(JSON.stringify({session_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})).toString('base64url')+'.SYNTHETIC';
 const h=harness();const r=await h.request('/church-login','POST',{},undefined,{authorization:'Bearer '+bearer});assert.equal(r.status,200);assert.match((await r.json()).session,/^[a-f0-9]{64}$/);
 assert.equal(h.calls[0].name,'school_issue_session');assert.equal(h.calls[0].payload.p_auth_session,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 const denied=harness({verify:false});assert.equal((await denied.request('/church-login','POST',{},undefined,{authorization:'Bearer '+bearer})).status,401);assert.equal(denied.calls.length,0);
 assert.equal((await h.request('/church-login','POST',{},undefined,{authorization:'Bearer invalid'})).status,401);
 assert.equal((await harness({active:false}).request('/church-login','POST',{},undefined,{authorization:'Bearer '+bearer})).status,403);
});
test('logout is idempotent and revokes the hashed server session',async()=>{
 const h=harness();assert.equal((await h.request('/logout','POST')).status,200);assert.equal(h.calls[0].name,'school_revoke_session');assert.match(h.calls[0].payload.p_hash,/^[a-f0-9]{64}$/);assert.notEqual(h.calls[0].payload.p_hash,'a'.repeat(64));
 assert.equal((await h.request('/logout','GET')).status,405);
});
test('personnel edits and upserts use the atomic RPC, never raw REST mutations',async()=>{
 const h=harness();assert.equal((await h.request('/','PATCH',{name:'Synthetic'},'/users?id=eq.S-QA&select=id')).status,200);
 assert.equal(h.calls.at(-1).name,'school_mutate_users');assert.equal(h.upstream.length,0);
 assert.equal((await h.request('/','POST',[{id:'S-QA',role_type:'學生'}],'/users?on_conflict=id',{prefer:'resolution=merge-duplicates,return=representation'})).status,200);
 assert.equal(h.calls.at(-1).payload.p_upsert,true);
 assert.equal((await harness({mutationError:{code:'42501'}}).request('/','PATCH',{role_type:'同工'},'/users?id=eq.T-QA')).status,403);
 assert.equal((await harness({mutationError:{code:'23505'}}).request('/','POST',[{id:'S-QA'}],'/users')).status,409);
});
test('bulk filters, ambiguous identities, invalid methods and private auth resources are denied',async()=>{
 for(const proxy of ['/users','/users?or=(id.eq.M-QA,id.eq.T-QA)','/users?id=eq.M-QA&id=eq.T-QA','/users?id=in.(M-QA,T-QA)'])assert.equal((await harness().request('/','PATCH',{name:'Synthetic'},proxy)).status,400);
 assert.equal((await harness().request('/','PUT',{},'/schedules')).status,405);
 for(const table of ['api_sessions','staff_access','rpc/school_set_staff_access'])assert.equal((await harness().request('/','GET',undefined,'/'+table)).status,403);
});
test('dedicated access administration is limited to managers and validates payloads',async()=>{
 assert.equal((await harness({role:'老師'}).request('/staff-access','POST',{})).status,403);
 assert.equal((await harness().request('/staff-access','POST',{user_id:'T-QA'})).status,400);
 const h=harness();assert.equal((await h.request('/staff-access','POST',{user_id:'T-QA',auth_user_id:'22222222-2222-4222-8222-222222222222',role_type:'老師',is_active:true})).status,200);
 assert.equal(h.calls.at(-1).name,'school_set_staff_access');
});
test('public kiosk distance threshold remains the production value',()=>assert.match(source,/FACE_MATCH_MAX_DISTANCE=0\.25/));

test('flat selects cannot embed private authentication relationships',async()=>{for(const select of ['*,staff_access(*)','*,api_sessions(*)','x:staff_access(*)'])assert.equal((await harness().request('/','GET',undefined,'/users?select='+encodeURIComponent(select))).status,400)});
test('single-row mutation responses preserve Supabase maybeSingle behavior',async()=>{const r=await harness().request('/','PATCH',{name:'Synthetic'},'/users?id=eq.S-QA&select=id',{accept:'application/vnd.pgrst.object+json'});assert.equal(r.status,200);assert.equal((await r.json()).id,'S-QA')});

test('empty successful REST deletes retain HTTP 204 without throwing',async()=>{assert.equal((await harness({upstreamStatus:204}).request('/','DELETE',undefined,'/schedules?id=eq.1')).status,204)});

 test('station tokens never authorize general school management or provisioning',async()=>{
 const h=harness({active:false});assert.equal((await h.request('/','GET',undefined,'/users',{'x-mschool-session':'','x-enrollment-session':'b'.repeat(64)})).status,401);
 assert.equal((await h.request('/workstation/devices','POST',{label:'Synthetic',is_active:true,password:'SyntheticPass12'})).status,403);
 assert.equal((await harness({role:'老師'}).request('/workstation/devices','POST',{label:'Synthetic',is_active:true,password:'SyntheticPass12'})).status,403);
 for(const table of ['enrollment_devices','enrollment_sessions','enrollment_audit'])assert.equal((await harness().request('/','GET',undefined,'/'+table)).status,403);
 });
 test('station login verifies PBKDF2 password before issuing a token and honors rate limits',async()=>{
 const salt='c'.repeat(32),password='SyntheticPass12';const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const hash=Buffer.from(await webcrypto.subtle.deriveBits({name:'PBKDF2',salt:Buffer.from(salt,'hex'),iterations:600000,hash:'SHA-256'},key,256)).toString('hex');
 const stationRpc=async name=>name==='school_station_login_prepare'?{version:1,credential:{salt,hash,iterations:600000}}:{device_id:'Synthetic',label:'Station'};
 const h=harness({stationRpc});const body={device_token:'c'.repeat(64),password};assert.equal((await h.request('/workstation/login','POST',body)).status,200);assert.ok(h.calls.some(c=>c.name==='school_station_login_finish'));
 const wrong=harness({stationRpc});assert.equal((await wrong.request('/workstation/login','POST',{...body,password:'incorrect'})).status,401);assert.ok(!wrong.calls.some(c=>c.name==='school_station_login_finish'));
 const blocked=harness({stationRpc:async()=>({blocked:true})});assert.equal((await blocked.request('/workstation/login','POST',body)).status,429);
 });
 test('station session must be current for uploads and student requests',async()=>{const h=harness({stationRpc:async()=>null});assert.equal((await h.request('/workstation/students','GET',undefined,undefined,{'x-enrollment-session':'b'.repeat(64)})).status,401);assert.equal((await h.request('/workstation/students','GET')).status,401);});

test('workhours endpoint requires manager, validates month and calls a bounded server report',async()=>{
 assert.equal((await harness({active:false}).request('/attendance/workhours?month=2026-09')).status,401);
 for(const role of ['老師','工讀生'])assert.equal((await harness({role}).request('/attendance/workhours?month=2026-09')).status,403);
 for(const month of ['','2026-00','2026-13','0000-09','invalid'])assert.equal((await harness().request('/attendance/workhours?month='+month)).status,400);
 assert.equal((await harness().request('/attendance/workhours?month=2026-09','POST',{})).status,405);
 const h=harness();assert.equal((await h.request('/attendance/workhours?month=2028-02')).status,200);assert.equal(h.calls.at(-1).name,'school_workhours_report');assert.equal(h.calls.at(-1).payload.p_month,'2028-02-01');assert.equal(h.upstream.length,0);
});
