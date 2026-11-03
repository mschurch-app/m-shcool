import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../supabase/functions/mschool-api/index.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
const js=stripTypeScriptTypes(source,{mode:'strip'});
function make({allowed=true,error=null,rows=[]}={}){
 let handler;const calls=[];
 const query={select(v){calls.push(['select',v]);return this},or(v){calls.push(['filter',v]);return this},order(...v){calls.push(['order',...v]);return this},limit(v){calls.push(['limit',v]);return this},then(resolve){return Promise.resolve({data:rows,error}).then(resolve)}};
 const db={schema(){return this},from(v){calls.push(['from',v]);return query},rpc:async(n,p)=>{calls.push(['rpc',n,p]);return {data:n==='school_kiosk_gate'?{ok:allowed,code:allowed?null:'device_required'}:null,error:null}}};
 vm.runInNewContext(js,{Deno:{serve(v){handler=v},env:{get(){return 'test'}}},createClient:()=>db,payrollRequest:()=>{},TextEncoder,Headers,Request,Response,URL,Uint8Array,crypto:webcrypto,atob,console});
 return {calls,request:method=>handler(new Request('https://isolated.invalid/mschool-api/kiosk/leaderboard',{method:method||'GET'}))};
}
test('leaderboard reuses device gate and blocks data access on rejection',async()=>{const h=make({allowed:false});assert.equal((await h.request()).status,403);assert(!h.calls.some(c=>c[0]==='from'));});
test('minimal read-only projection, active students only, stable top20 with ties',async()=>{const h=make({rows:[{name:'測試甲',points:10},{name:'測試乙',points:10},{name:'測試丙',points:4}]});const r=await h.request();assert.equal(r.status,200);assert.deepEqual(await r.json(),[{rank:1,name:'測試甲',points:10},{rank:1,name:'測試乙',points:10},{rank:3,name:'測試丙',points:4}]);assert.equal(h.calls.find(c=>c[0]==='select')[1],'name,points');assert.equal(h.calls.find(c=>c[0]==='rpc')[2].p_route,'logs');assert(h.calls.find(c=>c[0]==='filter')[1].includes('status.eq.在班'));assert.equal(h.calls.find(c=>c[0]==='limit')[1],20);});
test('empty results, database errors and write method rejection',async()=>{assert.deepEqual(await (await make().request()).json(),[]);assert.equal((await make({error:{message:'synthetic'}}).request()).status,500);const h=make();assert.equal((await h.request('POST')).status,405);assert(!h.calls.some(c=>c[0]==='from'));});
