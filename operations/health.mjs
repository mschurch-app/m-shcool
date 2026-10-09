import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {sha256} from './archive.mjs';
const origin='https://school.mchurch.online/';
const api='https://aqanuwilmvdtlzuqlrau.supabase.co/functions/v1/mschool-api/';
export async function probe(url,{status=200,hash,marker}={},request=fetch) {
 const response=await request(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(response.status!==status)throw Error(`Unexpected HTTP status ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(hash&&sha256(bytes)!==hash)throw Error('Production asset does not match the release manifest');
 if(marker&&!bytes.toString('utf8').includes(marker))throw Error('Expected response marker missing');
 return {status:response.status,bytes:bytes.length};
}
export async function runHealth(manifest,request=fetch){
 const checks=[];
 for(const asset of manifest.assets){
  if(!/^[a-zA-Z0-9._-]+$/.test(asset.path)||!/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid release manifest');
  try{const result=await probe(origin+asset.path,{hash:asset.sha256},request);checks.push({name:asset.path,ok:true,...result});}
  catch{checks.push({name:asset.path,ok:false,error:'Asset unavailable or release hash mismatch'});}
 }
 // Only GETs. Do not generate attendance, login sessions, points or test people.
 for(const route of ['rollcalls?day=2000-01-01','kiosk/devices','attendance/workhours?month=2000-01']){
  try{const result=await probe(api+route,{status:401,marker:'error'},request);checks.push({name:route.split('?')[0]+' anonymous access denied',ok:true,...result});}
  catch{checks.push({name:route.split('?')[0]+' anonymous access denied',ok:false,error:'Authorization boundary or API unavailable'});}
 }
 return {checkedAt:new Date().toISOString(),baseline:manifest.baseline,ok:checks.every(c=>c.ok),checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const manifest=JSON.parse(await readFile(new URL('./release-manifest.json',import.meta.url),'utf8'));
 const result=await runHealth(manifest);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
