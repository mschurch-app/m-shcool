
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const cors={"access-control-allow-origin":"*","access-control-allow-headers":"authorization,apikey,content-type,x-mschool-session,x-proxy-path,x-file-name,prefer,range,x-client-info,accept-profile,content-profile","access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS","content-type":"application/json; charset=utf-8"};
const allowed=new Set(["users","students","system_settings","staff_members","courses","student_course_enrollments","rollcall_logs","counseling_records","elective_courses","check_in_logs","schedules","points_logs","roll_calls","counseling_logs","parent_messages","line_bindings"]);
const encoder=new TextEncoder();
function json(v:any,status=200,extra={}){return new Response(JSON.stringify(v),{status,headers:{...cors,...extra}})}
async function sha256(v:string){const d=await crypto.subtle.digest("SHA-256",encoder.encode(v));return Array.from(new Uint8Array(d)).map(x=>x.toString(16).padStart(2,"0")).join("")}
function token(){const b=new Uint8Array(32);crypto.getRandomValues(b);return Array.from(b).map(x=>x.toString(16).padStart(2,"0")).join("")}
function phone(v:any){return String(v||"").replace(/\D/g,"")}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 const base=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
 const db=createClient(base,key,{auth:{persistSession:false}}),school=db.schema("mschool"),u=new URL(req.url);
 try{
  if(u.pathname.endsWith("/church-login")){
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const bearer=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
   const verified=await db.auth.getUser(bearer);
   if(verified.error||!verified.data.user)return json({error:"教會 OS 登入已失效"},401);
   const identity=await db.rpc("get_mschool_sso_identity",{p_user:verified.data.user.id});
   if(identity.error||!identity.data)return json({error:"此帳號沒有課輔系統權限"},403);
   const {data,error}=await school.from("users").select("*").eq("name",identity.data).neq("role_type","學生").neq("status","離職").limit(1);
   if(error)throw error;const user=data?.[0];
   if(!user)return json({error:"教會 OS 帳號尚未連結課輔同工資料"},403);
   const session=token(),hash=await sha256(session);
   const {error:e}=await school.from("api_sessions").insert({token_hash:hash,user_id:user.id,expires_at:new Date(Date.now()+12*60*60*1000).toISOString()});if(e)throw e;
   delete user.face_descriptor;return json({user,session,loginMode:"church-os"});
  }

  if(u.pathname.endsWith("/manual-login")){
   const b=await req.json(),identity=String(b.identity||"").trim(),password=phone(b.password);
   const {data,error}=await school.from("users").select("*").or("id.ilike."+identity+",name.eq."+identity).neq("role_type","學生").neq("status","離職").limit(1);
   if(error)throw error;const user=data?.[0];
   if(!user||!password||phone(user.phone)!==password)return json({error:"帳號或手機號碼不正確"},401);
   const session=token(),hash=await sha256(session);
   const {error:e}=await school.from("api_sessions").insert({token_hash:hash,user_id:user.id,expires_at:new Date(Date.now()+12*60*60*1000).toISOString()});if(e)throw e;
   delete user.face_descriptor;return json({user,session});
  }

  let caller:any=null;const session=req.headers.get("x-mschool-session");
  if(session){
   const hash=await sha256(session);
   const {data:s}=await school.from("api_sessions").select("user_id,expires_at").eq("token_hash",hash).gt("expires_at",new Date().toISOString()).maybeSingle();
   if(s){const {data:user}=await school.from("users").select("*").eq("id",s.user_id).maybeSingle();caller=user}
  }

  if(u.pathname.endsWith("/session")){
   if(!caller)return json({error:"工作階段已失效"},401);
   const safe={...caller};delete safe.face_descriptor;return json({user:safe});
  }
  if(u.pathname.endsWith("/kiosk/check-in")){
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const b=await req.json(),id=String(b.id||"").trim().toUpperCase();
   if(!/^[A-Z0-9_-]{2,32}$/.test(id))return json({ok:false,code:"invalid"},400);
   const {data,error}=await school.rpc("kiosk_checkin",{p_user_id:id});if(error)throw error;return json(data);
  }
  if(u.pathname.endsWith("/kiosk/logs")){
   const {data,error}=await school.from("check_in_logs").select("check_time,target_id,target_name,role,action_text").order("check_time",{ascending:false}).limit(10);
   if(error)throw error;return json(data||[]);
  }
  if(u.pathname.endsWith("/kiosk/face-match")){
   if(req.method!=="POST")return json({error:"method not allowed"},405);
   const b=await req.json(),probe=Array.isArray(b.descriptor)?b.descriptor.map(Number):[];
   if(probe.length!==128||probe.some((x:number)=>!Number.isFinite(x)))return json({match:null},400);
   const {data,error}=await school.from("users").select("id,name,face_descriptor").not("face_descriptor","is",null).neq("status","離職");
   if(error)throw error;let best:any=null,bestDistance=Infinity;
   for(const row of data||[]){let d=row.face_descriptor;if(typeof d==="string"){try{d=JSON.parse(d)}catch{continue}}if(!Array.isArray(d)||d.length!==128)continue;let sum=0;for(let i=0;i<128;i++){const diff=probe[i]-Number(d[i]);sum+=diff*diff}const distance=Math.sqrt(sum);if(distance<bestDistance){bestDistance=distance;best=row}}
   if(!best||bestDistance>0.48)return json({match:null});
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
  const role=caller.role_type||"",method=req.method;
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
  const r=await fetch(upstream,{method,headers:h,body}),txt=await r.text(),ct=r.headers.get("content-type")||"application/json";
  if(!ct.includes("json")||!txt)return new Response(txt,{status:r.status,headers:{...cors,"content-type":ct}});
  let result:any;try{result=JSON.parse(txt)}catch{return new Response(txt,{status:r.status,headers:cors})}
  async function safe(v:any):Promise<any>{
   if(typeof v==="string"&&v.startsWith("mschool-avatar://")){const {data}=await db.storage.from("mschool-avatars").createSignedUrl(v.slice(17),3600);return data?.signedUrl||null}
   if(Array.isArray(v))return await Promise.all(v.map(safe));
   if(v&&typeof v==="object"){const out:any={};for(const[k,val]of Object.entries(v))out[k]=await safe(val);return out}return v
  }
  const cleaned=await safe(result),out:any={...cors};for(const n of ["content-range","range-unit","preference-applied"]){const v=r.headers.get(n);if(v)out[n]=v}
  return json(cleaned,r.status,out);
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:String(error)},500)}
});
