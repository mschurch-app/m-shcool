import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../supabase/functions/mschool-api/index.ts',import.meta.url),'utf8');
const js=stripTypeScriptTypes(source.replace(/^import .*;\n/m,''),{mode:'strip'});
function harness({role='同工',active=true,verify=true,mutationError=null,upstreamStatus=200,stationRpc=null,faceUsers=[]}={}){
 let handler; const calls=[],upstream=[]; const token='a'.repeat(64);
 const db={from(table){const query={select(){return this},not(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve({data:table==='users'?faceUsers:[],error:null}).then(resolve)}};return query;},schema(){return this;},auth:{getUser:async()=>({data:{user:verify?{id:'11111111-1111-4111-8111-111111111111'}:null},error:verify?null:{message:'invalid'}})},
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
 const request=(path='/',method='GET',body,proxy='/counseling_logs',headers={})=>handler(new Request('https://isolated.invalid/mschool-api'+path,{method,headers:{'content-type':'application/json','x-mschool-session':token,'x-proxy-path':proxy,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
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

test('empty successful generic REST deletes retain HTTP 204 without throwing',async()=>{assert.equal((await harness({upstreamStatus:204}).request('/','DELETE',undefined,'/counseling_logs?id=eq.1')).status,204)});

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

test('atomic daily endpoints validate method/request and stay behind a current school session',async()=>{
 const request_id=webcrypto.randomUUID();
 for(const [path,body,name] of [
 ['/rollcalls',{day:'2026-10-12',rows:[],revision:'0'},'school_save_rollcall'],
 ['/points/adjust',{id:'S-QA',delta:1,reason:'Synthetic'},'school_adjust_points'],
 ['/schedules/save',{method:'POST',rows:[]},'school_mutate_schedules'],
 ['/imports',{rows:[]},'school_import_rows']]){
  assert.equal((await harness({active:false}).request(path,'POST',{...body,request_id})).status,401);
  assert.equal((await harness().request(path,'POST',body)).status,400);
  const h=harness();assert.equal((await h.request(path,'POST',{...body,request_id})).status,200);assert.equal(h.calls.at(-1).name,name);assert.equal(h.calls.at(-1).payload.p_request,request_id);assert.equal(h.upstream.length,0);
 }
 const h=harness();assert.equal((await h.request('/rollcalls?month=2028-02')).status,200);assert.equal(h.calls.at(-1).payload.p_end,'2028-02-29');
 assert.equal((await h.request('/rollcalls?day=bad')).status,400);
});
test('old schedule and rollcall clients use RPCs, while ledger writes and ambiguous filters are denied',async()=>{
 const h=harness();assert.equal((await h.request('/','POST',[{date:'2026-10-12',worker_id:'P-QA',shift:'16:00-18:00'}],'/schedules')).status,200);assert.equal(h.calls.at(-1).name,'school_mutate_schedules');
 assert.equal((await h.request('/','POST',[{created_at:'2026-10-12T16:00Z',course_name:'課後輔導',student_id:'S-QA'}],'/roll_calls')).status,200);assert.equal(h.calls.at(-1).name,'school_save_rollcall');assert.equal(h.calls.at(-1).payload.p_revision,null);
 for(const table of ['points_logs','check_in_logs'])assert.equal((await h.request('/','POST',{},'/'+table)).status,403);
 assert.equal((await h.request('/','DELETE',undefined,'/schedules')).status,400);assert.equal(h.upstream.length,0);
});
test('kiosk punch retries carry a UUID and device gate never authorizes management',async()=>{
 const h=harness({active:false}),request_id=webcrypto.randomUUID();const response=await h.request('/kiosk/check-in','POST',{id:'S-QA',request_id},undefined,{'x-kiosk-device':'b'.repeat(64)});assert.equal(response.status,200);
 assert.ok(h.calls.some(c=>c.name==='school_kiosk_gate'));assert.equal(h.calls.at(-1).name,'school_kiosk_punch');assert.equal(h.calls.at(-1).payload.p_request,request_id);assert.match(h.calls.at(-1).payload.p_scope,/^[a-f0-9]{64}$/);
 assert.equal((await h.request('/','GET',undefined,'/users',{'x-kiosk-device':'b'.repeat(64)})).status,401);
 assert.equal((await harness({role:'老師'}).request('/kiosk/devices','POST',{action:'register',label:'Synthetic'})).status,403);
});

test('public face matching skips withdrawn/graduated/unknown people and never returns templates',async()=>{
 const faceUsers=[{id:'S-GRAD',name:'Graduated',role_type:'學生',status:'畢業',face_descriptor:Array(128).fill(0)},
 {id:'S-LEFT',name:'Withdrawn',role_type:'學生',status:'退班',face_descriptor:Array(128).fill(0)},
 {id:'UNKNOWN',name:'Unknown',role_type:'unknown',status:'在班',face_descriptor:Array(128).fill(0)},
 {id:'S-ACTIVE',name:'Synthetic Active',role_type:'學生',status:'在班',face_descriptor:Array(128).fill(.01)}];
 const h=harness({active:false,faceUsers});let r=await h.request('/kiosk/face-match','POST',{descriptor:Array(128).fill(0)});assert.equal(r.status,200);const data=await r.json();assert.equal(data.match.id,'S-ACTIVE');assert.equal(data.match.face_descriptor,undefined);
 r=await h.request('/kiosk/face-match','POST',{descriptor:Array(128).fill(1)});assert.equal((await r.json()).match,null);
});
test('face probes reject null, string, invalid length and out-of-range data before matching',async()=>{
 for(const descriptor of [Array(127).fill(0),Array(128).fill(null),Array(128).fill('0'),Array(128).fill(11)])assert.equal((await harness({active:false}).request('/kiosk/face-match','POST',{descriptor})).status,400);
 assert.equal((await harness().request('/kiosk/face-match')).status,405);
 assert.equal((await harness().request('/kiosk/logs','POST',{})).status,405);
});
