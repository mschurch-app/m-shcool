
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type,x-mschool-session,x-kiosk-device,x-request-id,x-enrollment-session,x-proxy-path,x-file-name,prefer,range,x-client-info,accept-profile,content-profile","access-control-allow-methods":"GET,HEAD,POST,PATCH,DELETE,OPTIONS","access-control-expose-headers":"content-range,range-unit,preference-applied","cache-control":"no-store","content-type":"application/json; charset=utf-8"};
const allowed=new Set(["users","students","system_settings","staff_members","courses","student_course_enrollments","rollcall_logs","counseling_records","elective_courses","check_in_logs","schedules","points_logs","roll_calls","counseling_logs","parent_messages","line_bindings"]);
const encoder=new TextEncoder();
const FACE_MATCH_MAX_DISTANCE=0.25; // Existing production distance threshold.
function json(v:any,status=200,extra={}){return new Response(JSON.stringify(v),{status,headers:{...cors,...extra}})}
async function sha256(v:string){const d=await crypto.subtle.digest("SHA-256",encoder.encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")}
function token(){const b=new Uint8Array(32);crypto.getRandomValues(b);return Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("")}
const staffRoles = new Set(["同工", "老師", "工讀生"]);
function personCanCheckin(role:string|null,status:string|null){return (!role||role==="學生")?(!status||status==="在班"):staffRoles.has(role)&&(!status||["在班","在職"].includes(status));}
function authSessionId(bearer:string) {
 try {
  const encoded=bearer.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
  const value=JSON.parse(atob(encoded)).session_id;
  return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:null;
 } catch { return null; }
}
async function stationPassword(password:string,salt:string) {
 const material=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
 const bytes=Uint8Array.from(salt.match(/../g)!.map(v=>parseInt(v,16)));
 const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:bytes,iterations:600000,hash:"SHA-256"},material,256);
 return Array.from(new Uint8Array(bits)).map(v=>v.toString(16).padStart(2,"0")).join("");
}
function sameHash(a:string,b:string){let difference=a.length^b.length;for(let i=0;i<64;i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return difference===0;}
async function workstationRequest(req:Request,db:any,u:URL):Promise<Response|null>{
 const route=u.pathname.split("/workstation/")[1];if(!route)return null;
 const rpc=async(name:string,args:any)=>{const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;};
 const hashToken=async(value:string|null)=>value&&/^[a-f0-9]{64}$/.test(value)?await sha256(value):null;
 if(route==="devices"){
  const actor=await hashToken(req.headers.get("x-mschool-session"));
  if(!actor)return json({error:"請先由教會 OS 登入管理同工帳號"},401);
  try{
   if(req.method==="GET")return json(await rpc("school_station_devices",{p_actor:actor}));
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const manager=await rpc("school_resolve_session",{p_hash:actor});
   if(manager?.role_type!=="同工")return json({error:"此功能限管理同工使用"},403);
   const b=await req.json();
   if(typeof b.label!=="string"||typeof b.is_active!=="boolean")return json({error:"請填寫設備名稱"},400);
   let credential=null;
   if(b.password!==undefined){
    if(typeof b.password!=="string"||b.password.length<12||b.password.length>128)return json({error:"專用密碼請設定 12 至 128 個字元，不使用手機號碼。"},400);
    const salt=token().slice(0,32);credential={salt,iterations:600000,hash:await stationPassword(b.password,salt)};
   }
   const pairing=b.id?null:token();
   const device=await rpc("school_station_manage",{p_actor:actor,p_id:b.id||null,p_label:b.label,p_enabled:b.is_active,p_pair_hash:pairing?await sha256(pairing):null,p_credential:credential});
   return json({device,...(pairing?{device_token:pairing}:{})});
  }catch(error){return json({error:"無法設定設備，請確認管理權限與密碼。"},(error as any)?.code==="42501"?403:400);}
 }
 if(route==="login"){
  if(req.method!=="POST")return json({error:"method not allowed"},405);
  const b=await req.json(),pairHash=await hashToken(b.device_token);
  if(!pairHash||typeof b.password!=="string"||b.password.length>128)return json({error:"設備未啟用或密碼不正確"},401);
  const challenge=await rpc("school_station_login_prepare",{p_pair_hash:pairHash});
  if(challenge?.blocked)return json({error:"密碼嘗試次數過多，請 15 分鐘後再試，或請管理員重設。"},429);
  if(!challenge?.credential)return json({error:"設備未啟用或已停用，請聯絡管理同工。"},401);
  const actual=await stationPassword(b.password,challenge.credential.salt);
  if(!sameHash(actual,challenge.credential.hash))return json({error:"設備未啟用或密碼不正確"},401);
  const session=token();
  const station=await rpc("school_station_login_finish",{p_pair_hash:pairHash,p_version:challenge.version,p_session_hash:await sha256(session)});
  if(!station)return json({error:"設備已停用，請聯絡管理同工。"},401);
  return json({station,session});
 }
 const hash=await hashToken(req.headers.get("x-enrollment-session"));
 if(route==="logout"){
  if(req.method!=="POST")return json({error:"method not allowed"},405);
  if(hash)await rpc("school_station_logout",{p_hash:hash});return json({ok:true});
 }
 if(!hash)return json({error:"請輸入建檔密碼"},401);
 const station=await rpc("school_station_session",{p_hash:hash});
 if(!station)return json({error:"建檔已鎖定，請重新輸入密碼"},401);
 if(route==="session"&&req.method==="POST")return json({station});
 if(route==="students"&&req.method==="GET"){
  const students=await rpc("school_station_students",{p_hash:hash,p_search:u.searchParams.get("search")||""});
  for(const row of students){if(row.avatar_url?.startsWith("mschool-avatar://")){const r=await db.storage.from("mschool-avatars").createSignedUrl(row.avatar_url.slice(17),900);row.avatar_url=r.data?.signedUrl||null;}}
  return json(students);
 }
 if(route==="upload"&&req.method==="POST"){
  const mime=req.headers.get("content-type")||"",ext=({"image/jpeg":"jpg","image/png":"png","image/webp":"webp"} as any)[mime];
  if(!ext)return json({error:"請使用 JPEG、PNG 或 WebP 照片"},400);
  const bytes=new Uint8Array(await req.arrayBuffer());if(!bytes.length||bytes.length>4*1024*1024)return json({error:"照片不可超過 4MB"},400);
  const path=`enrollment/${station.device_id}/${token()}.${ext}`;
  const r=await db.storage.from("mschool-avatars").upload(path,bytes,{contentType:mime,upsert:false});if(r.error)throw r.error;
  return json({storageRef:"mschool-avatar://"+path});
 }
 if(route==="students"&&req.method==="POST"){
  const body=await req.json();
  try{return json(await rpc("school_station_save",{p_hash:hash,p_payload:body}));}
  catch(error){return json({error:"建檔未儲存。請確認學生姓名、照片與人臉資料，再試一次。"},(error as any)?.code==="42501"?403:400);}
 }
 return json({error:"此建檔帳號沒有這項功能"},403);
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 const base=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const db=createClient(base,key,{auth:{persistSession:false}}),school=db.schema("mschool"),u=new URL(req.url);
 try{
  const workstation=await workstationRequest(req,db,u);if(workstation)return workstation;
  if(u.pathname.endsWith("/church-login")){
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
   const verified=await db.auth.getUser(bearer);
   if(verified.error||!verified.data.user)return json({error:"教會 OS 登入已失效"},401);
   // JWT claims are decoded only after getUser verified the bearer. The DB
   // checks that its auth.sessions row still exists on every school request.
   const authSession=authSessionId(bearer);
   if(!authSession)return json({error:"請重新登入教會 OS"},401);
   const session=token();
   const identity=await db.rpc("school_issue_session",{p_auth:verified.data.user.id,p_auth_session:authSession,p_hash:await sha256(session)});
   if(identity.error)throw identity.error;
   if(!identity.data)return json({error:"此教會帳號尚未取得課輔登入權限，請聯絡管理同工。"},403);
   return json({user:identity.data,session,loginMode:"church-os"});
  }

  if(u.pathname.endsWith("/manual-login")){
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   return json({error:"請使用教會 OS 的 LINE 或 Email 帳號登入課輔系統。",code:"church_login_required"},410);
  }

  const session=req.headers.get("x-mschool-session")||"";
  const sessionHash=/^[a-f0-9]{64}$/.test(session)?await sha256(session):null;
  if(u.pathname.endsWith("/logout")){
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   if(sessionHash){const result=await db.rpc("school_revoke_session",{p_hash:sessionHash});if(result.error)throw result.error;}
   return json({ok:true});
  }
  let caller:any=null;
  if(sessionHash){
   const result=await db.rpc("school_resolve_session",{p_hash:sessionHash});
   if(result.error)throw result.error;
   if(result.data&&staffRoles.has(result.data.role_type))caller=result.data;
  }

  if(u.pathname.endsWith("/staff-access")){
   if(!caller)return json({error:"請先登入同工帳號"},401);
   if(caller.role_type!=="同工")return json({error:"只有管理同工可以調整登入權限"},403);
   if(req.method==="GET"){
    const result=await db.rpc("school_access_options",{p_actor_hash:sessionHash});
    if(result.error)throw result.error;
    return json(result.data);
   }
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const b=await req.json();
   if(typeof b.user_id!=="string"||typeof b.auth_user_id!=="string"||!staffRoles.has(b.role_type)||typeof b.is_active!=="boolean")return json({error:"登入權限資料不完整"},400);
   const result=await db.rpc("school_set_staff_access",{p_actor_hash:sessionHash,p_user:b.user_id,p_auth:b.auth_user_id,p_role:b.role_type,p_active:b.is_active});
   if(result.error)return json({error:"無法調整登入權限，請確認對應帳號及管理資格。"},result.error.code==="42501"?403:400);
   return json(result.data);
  }

  if(u.pathname.endsWith("/attendance/workhours")){
   if(!caller)return json({error:"請先由教會 OS 登入"},401);
   if(caller.role_type!=="同工")return json({error:"只有管理同工可以查看工時報表"},403);
   if(req.method!=="GET")return json({error:"method not allowed"},405);
   const month=u.searchParams.get("month")||"";
   if(!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)||month.startsWith("0000"))return json({error:"請選擇有效月份"},400);
   const report=await db.rpc("school_workhours_report",{p_actor:sessionHash,p_month:month+"-01"});
   if(report.error)throw report.error;return json(report.data);
  }

  const route=u.pathname.split("/mschool-api")[1]||"";
  const uuid=(value:any)=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:null;
  const flowRpc=async(name:string,args:any)=>{
   const r=await db.rpc(name,args);if(!r.error)return json(r.data);
   const denied=r.error.code==="42501",conflict=r.error.code==="40001"||r.error.code==="23505";
   const messages:any={rollcall_conflict:"這天的點名已由另一位同工更新。輸入已保留，請重新載入核對後再儲存。",schedule_conflict:"時段有重疊，請重新預覽並調整。",use_points_ledger:"點數已變動，請使用點數增減功能。",invalid_points_balance:"點數不足或超出範圍。",request_payload_changed:"重試內容已變更，請重新確認。"};
   const message=denied?"目前帳號沒有這項操作權限。":messages[r.error.message]||"資料未儲存，請確認欄位或重新載入後再試。";
   return json({error:message,message,code:r.error.code},denied?403:conflict?409:400);
  };
  if(["/rollcalls","/points/adjust","/points/history","/schedules/preview","/schedules/save","/imports","/imports/history","/kiosk/devices","/students/face"].includes(route)){
   if(!caller)return json({error:"請先由教會 OS 登入"},401);
   if(route==="/rollcalls"&&req.method==="GET"){
    const day=u.searchParams.get("day"),month=u.searchParams.get("month");let start="",end="",course=null;
    if(day&&/^\d{4}-\d{2}-\d{2}$/.test(day)){start=end=day;course="課後輔導";}
    else if(month&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)){start=month+"-01";end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);}
    else return json({error:"請選擇有效日期或月份"},400);
    return flowRpc("school_rollcall_read",{p_actor:sessionHash,p_start:start,p_end:end,p_course:course});
   }
   if(route==="/points/history"&&req.method==="GET")return flowRpc("school_points_history",{p_actor:sessionHash,p_student:u.searchParams.get("student_id")||""});
   if(route==="/imports/history"&&req.method==="GET")return flowRpc("school_import_history",{p_actor:sessionHash});
   if(route==="/kiosk/devices"){
    if(req.method==="GET")return flowRpc("school_kiosk_manage",{p_actor:sessionHash,p_action:"list"});
    if(req.method!=="POST")return json({error:"method not allowed"},405);
    if(caller.role_type!=="同工")return json({error:"此功能限管理同工使用"},403);
    const b=await req.json(),raw=b.action==="register"?token():null;
    const r=await db.rpc("school_kiosk_manage",{p_actor:sessionHash,p_action:b.action,p_label:b.label||null,p_hash:raw?await sha256(raw):null,p_id:b.id||null,p_enforce:b.enforce??null});
    if(r.error)return json({error:"設備設定未儲存，請確認設備名稱與管理權限。"},400);
    return json({...r.data,...(raw?{device_token:raw}:{})});
   }
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const b=await req.json(),request=uuid(b.request_id);
   if(route!=="/schedules/preview"&&!request)return json({error:"請重新確認操作"},400);
   if(route==="/rollcalls")return flowRpc("school_save_rollcall",{p_actor:sessionHash,p_day:b.day,p_course:"課後輔導",p_rows:b.rows,p_revision:b.revision,p_request:request});
   if(route==="/points/adjust")return flowRpc("school_adjust_points",{p_actor:sessionHash,p_student:b.id,p_delta:b.delta,p_reason:b.reason,p_request:request});
   if(route.startsWith("/schedules/"))return flowRpc("school_mutate_schedules",{p_actor:sessionHash,p_method:b.method,p_id:b.id||null,p_rows:b.rows||[],p_request:request,p_preview:route.endsWith("/preview")});
   if(route==="/students/face"){
    let avatar=b.avatar;
    const marker="/storage/v1/object/sign/mschool-avatars/";
    if(typeof avatar==="string"&&avatar.startsWith(base+marker))avatar="mschool-avatar://"+decodeURIComponent(avatar.slice((base+marker).length).split("?")[0]);
    return flowRpc("school_backfill_face",{p_actor:sessionHash,p_id:b.id,p_avatar:avatar,p_status:b.status??null,p_descriptor:b.descriptor});
   }
   if(route==="/imports")return flowRpc("school_import_rows",{p_actor:sessionHash,p_rows:b.rows,p_request:request});
   return json({error:"method not allowed"},405);
  }
  let kioskScope:string|null=null;
  if(route.startsWith("/kiosk/")&&["check-in","face-match","logs"].includes(route.split("/").pop()||"")){
   const device=req.headers.get("x-kiosk-device")||"",hash=/^[a-f0-9]{64}$/.test(device)?await sha256(device):null;
   // Hash the edge-observed connection hint with the service secret; never persist raw IPs.
   // Compatibility mode is rate control only, not proof of a trusted physical device.
   const bucket=await sha256(key+":"+(req.headers.get("cf-connecting-ip")||req.headers.get("x-forwarded-for")||"unknown"));
   const gate=await db.rpc("school_kiosk_gate",{p_hash:hash,p_bucket:bucket,p_route:route.split("/").pop()});
   if(gate.error)throw gate.error;
   kioskScope=gate.data?.trusted?hash:bucket;
   if(!gate.data?.ok)return json({error:gate.data?.code==="device_required"?"這台設備尚未啟用簽到，請聯絡管理同工。":"操作太頻繁，請稍後再試。",code:gate.data?.code},gate.data?.code==="device_required"?403:429);
  }
  if(u.pathname.endsWith("/session")){
   if(req.method!=="GET")return json({error:"method not allowed"},405);
   if(!caller)return json({error:"工作階段已失效"},401);
   const safe={...caller};delete safe.face_descriptor;return json({user:safe});
  }
  if(u.pathname.endsWith("/kiosk/check-in")){
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const b=await req.json(),id=String(b.id||"").trim().toUpperCase();
   if(!/^[A-Z0-9_-]{2,32}$/.test(id))return json({ok:false,code:"invalid"},400);
   const {data,error}=await db.rpc("school_kiosk_punch",{p_scope:kioskScope,p_id:id,p_request:uuid(b.request_id)||crypto.randomUUID()});if(error)throw error;return json(data);
  }
  if(u.pathname.endsWith("/kiosk/logs")){
   if(req.method!=="GET")return json({error:"method not allowed"},405);
   const {data,error}=await school.from("check_in_logs").select("check_time,target_id,target_name,role,action_text").order("check_time",{ascending:false}).limit(10);
   if(error)throw error;return json(data||[]);
  }
  if(u.pathname.endsWith("/kiosk/face-match")){
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const b=await req.json(),probe=Array.isArray(b.descriptor)?b.descriptor:[];
   if(probe.length!==128||probe.some((x:any)=>typeof x!=="number"||!Number.isFinite(x)||Math.abs(x)>10))return json({match:null},400);
   const {data,error}=await school.from("users").select("id,name,role_type,status,face_descriptor").not("face_descriptor","is",null);
   if(error)throw error;let best:any=null,bestDistance=Infinity;
   for(const row of data||[]){if(!personCanCheckin(row.role_type,row.status))continue;let d=row.face_descriptor;if(typeof d==="string"){try{d=JSON.parse(d)}catch{continue}}if(!Array.isArray(d)||d.length!==128||d.some((v:any)=>!Number.isFinite(Number(v))))continue;let sum=0;for(let i=0;i<128;i++){const diff=probe[i]-Number(d[i]);sum+=diff*diff}const distance=Math.sqrt(sum);if(distance<bestDistance){bestDistance=distance;best=row}}
   if(!best||bestDistance>FACE_MATCH_MAX_DISTANCE)return json({match:null});
   return json({match:{id:best.id,name:best.name,distance:bestDistance}});
  }
  if(u.pathname.endsWith("/upload")){
   if(!caller||!["同工","老師"].includes(caller.role_type))return json({error:"權限不足"},403);
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const mime=req.headers.get("content-type")||"";
   if(!["image/jpeg","image/png","image/webp"].includes(mime))return json({error:"不支援的圖片格式"},400);
   const bytes=new Uint8Array(await req.arrayBuffer());if(bytes.length>4*1024*1024)return json({error:"圖片不可超過 4MB"},400);
   const original=(req.headers.get("x-file-name")||"avatar.jpg").replace(/[^a-zA-Z0-9._-]/g,"_");
   const path="avatars/"+caller.id+"/"+Date.now()+"_"+original;
   const {error}=await db.storage.from("mschool-avatars").upload(path,bytes,{contentType:mime,upsert:false});if(error)throw error;
   return json({storageRef:"mschool-avatar://"+path});
  }

  if(!caller)return json({error:"請先登入同工帳號"},401);
  const proxy=req.headers.get("x-proxy-path");if(!proxy?.startsWith("/"))return json({error:"missing proxy path"},400);
  const purl=new URL("https://internal"+proxy),resource=purl.pathname.replace(/^\//,"");
  if(!allowed.has(resource))return json({error:"resource denied"},403);
  // Keep the current flat-column query contract. Embedding relationships must
  // never expose private authentication tables through an allowed parent.
  if(!/^[a-zA-Z0-9_,*]+$/.test(purl.searchParams.get("select")||"*"))return json({error:"不支援此資料讀取方式"},400);
  const role=caller.role_type||"",method=req.method;
  if(!["GET","HEAD","POST","PATCH","DELETE"].includes(method))return json({error:"method not allowed"},405);
  if(!["GET","HEAD"].includes(method)){
   if(role==="工讀生")return json({error:"此帳號只有查看權限"},403);
   if(role==="老師"&&method==="DELETE")return json({error:"老師帳號不可刪除資料"},403);
   if(!["同工","老師"].includes(role))return json({error:"權限不足"},403);
  }

  const upstream=new URL(base+"/rest/v1/"+resource+purl.search),h=new Headers();
  h.set("apikey",key);h.set("authorization","Bearer "+key);h.set("accept-profile","mschool");h.set("content-profile","mschool");
  for(const n of ["prefer","range","accept","content-type"]){const v=req.headers.get(n);if(v)h.set(n,v)}
  let body=["GET","HEAD"].includes(method)?undefined:await req.text();
  if(body&&String(h.get("content-type")||"").includes("json")){
   try{
    const parsed=JSON.parse(body);
    const restore=(v:any):any=>{
     if(Array.isArray(v))return v.map(restore);
     if(v&&typeof v==="object"){
      const out:any={};
      for(const[k,val]of Object.entries(v)){
       if(k==="avatar_url"&&typeof val==="string"&&val.includes("/storage/v1/object/sign/mschool-avatars/")){
        const marker="/storage/v1/object/sign/mschool-avatars/",start=val.indexOf(marker)+marker.length;
        out[k]="mschool-avatar://"+decodeURIComponent(val.slice(start).split("?")[0]);
       }else out[k]=restore(val);
      }
      return out
     }
     return v
    };
    body=JSON.stringify(restore(parsed));
   }catch{}
  }
  // Personnel writes never go directly to PostgREST. SQL revalidates the
  // actor and locks target rows, including POST upserts and multi-row imports.
  if(resource==="users"&&!["GET","HEAD"].includes(method)){
   let payload:any=null;
   try{payload=body?JSON.parse(body):null;}catch{return json({error:"人員資料格式錯誤"},400);}
   const params=[...purl.searchParams.keys()];
   const idFilter=purl.searchParams.get("id");
   if(params.some(k=>!["id","select","on_conflict"].includes(k))||
     ((method==="PATCH"||method==="DELETE")&&(!idFilter?.startsWith("eq.")||purl.searchParams.getAll("id").length!==1))||
     (method==="POST"&&idFilter))return json({error:"請逐一選擇要修改的人員"},400);
   if(purl.searchParams.has("on_conflict")&&purl.searchParams.get("on_conflict")!=="id")return json({error:"不支援此合併方式"},400);
   const result=await db.rpc("school_mutate_users",{p_actor_hash:sessionHash,p_method:method,p_id:idFilter?.slice(3)||null,p_payload:payload,p_upsert:/(?:^|,)\s*resolution=merge-duplicates(?:,|$)/.test(req.headers.get("prefer")||"")});
   if(result.error){
    const conflict=["23505","40001"].includes(result.error.code),denied=result.error.code==="42501";
    return json({code:result.error.code,error:denied?"登入角色與同工停權須由管理同工另行設定，不能透過一般人員資料修改。":conflict?(result.error.code==="40001"?"點數已變動，請重新載入，並由點數增減功能調整。":"人員編號已存在"):"人員資料儲存失敗，請檢查欄位後重試。",message:denied?"沒有這項修改權限":conflict?"人員編號已存在":"人員資料儲存失敗"},denied?403:conflict?409:400);
   }
   // Use the same signed-media response conversion below.
   let data=result.data||[];
   if((req.headers.get("accept")||"").includes("application/vnd.pgrst.object+json")){
    if(data.length!==1)return json({code:"PGRST116",message:"Expected one person",details:`The result contains ${data.length} rows`},406);
    data=data[0];
   }
   const txt=JSON.stringify(data);
   return await proxyResult(new Response(txt,{status:200,headers:{"content-type":"application/json"}}));
  }
  if(!["GET","HEAD"].includes(method)&&["points_logs","check_in_logs"].includes(resource))return json({error:"請使用簽到或點數調整功能；帳本不可直接改寫。"},403);
  if(!["GET","HEAD"].includes(method)&&["roll_calls","schedules"].includes(resource)){
   const idFilter=purl.searchParams.get("id"),params=[...purl.searchParams.keys()];
   if(params.some(k=>!["id","select","on_conflict"].includes(k))||(idFilter&&!/^eq\.[0-9]+$/.test(idFilter)))return json({error:"請逐筆修改"},400);
   let parsed:any;try{parsed=body?JSON.parse(body):null;}catch{return json({error:"資料格式錯誤"},400);}
   let rows=Array.isArray(parsed)?parsed:[parsed];const request=uuid(req.headers.get("x-request-id"))||crypto.randomUUID();
   if(resource==="roll_calls"){
    if(!["POST","PATCH"].includes(method)||!rows.length||rows.some((x:any)=>!x))return json({error:"請使用點名儲存功能"},400);
    if(method==="PATCH"){
     if(!idFilter)return json({error:"請選擇紀錄"},400);
     const old=await school.from("roll_calls").select("*").eq("id",idFilter.slice(3)).single();if(old.error)return json({error:"紀錄不存在"},409);
     rows=[{...old.data,...rows[0]}];
    }
    const day=String(rows[0].class_date||rows[0].created_at||"").slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||rows.some((x:any)=>String(x.class_date||x.created_at||"").slice(0,10)!==day||x.course_name!=="課後輔導"))return json({error:"請一次儲存同一天點名"},400);
    const r=await db.rpc("school_save_rollcall",{p_actor:sessionHash,p_day:day,p_course:"課後輔導",p_rows:rows,p_revision:null,p_request:request});
    if(r.error)return json({error:"點名未儲存，請重新開啟頁面",message:"點名未儲存，請重新開啟頁面"},400);return json([]);
   }
   if(method!=="POST"&&!idFilter)return json({error:"請選擇排班"},400);
   if(purl.searchParams.has("on_conflict"))return json({error:"請逐筆調整排班"},400);
   return flowRpc("school_mutate_schedules",{p_actor:sessionHash,p_method:method,p_id:idFilter?.slice(3)||null,p_rows:method==="DELETE"?[]:rows,p_request:request,p_preview:false});
  }
  const r=await fetch(upstream,{method,headers:h,body});
  return await proxyResult(r);
  async function proxyResult(r:Response){
  const txt=await r.text(),ct=r.headers.get("content-type")||"application/json";
  if(!ct.includes("json")||!txt)return new Response([204,205,304].includes(r.status)||method==="HEAD"?null:txt,{status:r.status,headers:{...cors,"content-type":ct}});
  let result:any;try{result=JSON.parse(txt)}catch{return new Response(txt,{status:r.status,headers:cors})}
  async function safe(v:any):Promise<any>{
   if(typeof v==="string"&&v.startsWith("mschool-avatar://")){const {data}=await db.storage.from("mschool-avatars").createSignedUrl(v.slice(17),3600);return data?.signedUrl||null}
   if(Array.isArray(v))return await Promise.all(v.map(safe));
   if(v&&typeof v==="object"){const out:any={};for(const[k,val]of Object.entries(v))out[k]=await safe(val);return out}return v
  }
  const cleaned=await safe(result),out:any={...cors};for(const n of ["content-range","range-unit","preference-applied"]){const v=r.headers.get(n);if(v)out[n]=v}
  return json(cleaned,r.status,out);
  }
 }catch(error){console.error("mschool-api request failed",(error as any)?.code||"unexpected");return json({error:"系統暫時無法完成操作，請稍後再試。",message:"系統暫時無法完成操作，請稍後再試。"},500)}
});
