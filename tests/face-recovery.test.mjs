import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('../'+(process.env.MSCHOOL_FRONTEND_FILE||'index.html'),import.meta.url),'utf8');
const start=html.indexOf('    // A successful camera observation'),end=html.indexOf('    // End face liveness recovery.')+'    // End face liveness recovery.'.length;
const source=html.slice(start,end);
function harness({storage=new Map(),startTime=1000000,writeFails=false}={}){
 let now=startTime,poll=null,reloads=0,stops=0,canReload=true;const status={textContent:''};
 const c={Date:{now:()=>now},Map,Set,JSON,Number,String,Array,Math,isFaceDetecting:true,faceVideoEl:{currentTime:0},pendingFlowOperations:new Map(),taipeiDateKey:()=> '2026-10-20',document:{hidden:false,getElementById:()=>status},window:{SchoolUI:{canAutoReload:()=>canReload}},sessionStorage:{getItem:k=>storage.get(k)??null,setItem(k,v){if(writeFails)throw Error('unavailable');storage.set(k,String(v));},removeItem:k=>storage.delete(k)},location:{reload(){reloads++;}},setInterval:fn=>(poll=fn,1),clearInterval:()=>poll=null,stopFaceRecognition(){stops++;c.isFaceDetecting=false;c.stopFaceWatchdog();}};
 vm.createContext(c);vm.runInContext(source,c);
 return{c,storage,status,run:s=>vm.runInContext(s,c),advance(ms){now+=ms;poll?.();},setSafe:v=>canReload=v,get reloads(){return reloads;},get now(){return now;},get stops(){return stops;},get monitoring(){return Boolean(poll);}};
}
test('completed advancing camera frames prevent periodic reload during long healthy use',()=>{const h=harness();h.c.startFaceWatchdog();for(let i=0;i<120;i++){h.advance(1000);h.c.faceVideoEl.currentTime++;h.c.markFaceWatchdogProgress();}assert.equal(h.reloads,0);assert(h.monitoring);});
test('stuck inference/no completed frames reload once after 30 seconds, stopping camera first',()=>{const h=harness();h.c.startFaceWatchdog();h.advance(29999);assert.equal(h.reloads,0);h.advance(1);assert.equal(h.reloads,1);assert.equal(h.stops,1);assert(!h.monitoring);assert(h.storage.has('mplus_face_resume'));});
test('frozen camera frames do not pretend to be healthy',()=>{const h=harness();h.c.startFaceWatchdog();h.c.markFaceWatchdogProgress();for(let i=0;i<3;i++){h.advance(10000);h.c.markFaceWatchdogProgress();}assert.equal(h.reloads,1);});
test('active or uncertain attendance writes block reload, and no operation is replayed',()=>{const h=harness();h.c.startFaceWatchdog();h.run('activePunchRequests=1');h.advance(45000);assert.equal(h.reloads,0);h.run('activePunchRequests=0');h.c.pendingFlowOperations.set('punch:QA',{id:'uncertain'});h.advance(2000);assert.equal(h.reloads,0);assert.match(h.status.textContent,/尚待確認/);h.c.pendingFlowOperations.clear();h.advance(2000);assert.equal(h.reloads,1);});
test('unsaved forms/dialogs delay recovery until UI says it is safe',()=>{const h=harness();h.setSafe(false);h.c.startFaceWatchdog();h.advance(35000);assert.equal(h.reloads,0);assert.match(h.status.textContent,/編輯/);h.setSafe(true);h.advance(2000);assert.equal(h.reloads,1);});
test('unknown/cached UI readiness is fail-closed',()=>{const h=harness();delete h.c.window.SchoolUI.canAutoReload;h.c.startFaceWatchdog();h.advance(40000);assert.equal(h.reloads,0);});
test('auto recovery preserves anti-repeat state and consumes its resume marker exactly once',()=>{const h=harness();assert(h.run("claimFacePunch('M-QA')"));h.c.startFaceWatchdog();h.advance(30000);const restored=harness({storage:h.storage,startTime:h.now+100});assert(restored.c.restoreFaceAutoResume());assert.equal(restored.run("claimFacePunch('M-QA')"),false);assert.equal(restored.c.restoreFaceAutoResume(),false);restored.run('updateFacePresence([],2000000);updateFacePresence([],2005001)');assert.equal(restored.run("claimFacePunch('M-QA')"),true);const saved=h.storage.get('mplus_face_resume');assert.equal(saved,undefined);});
test('repeated stall within ten minutes stops automatic reload loop',()=>{const h=harness();h.c.startFaceWatchdog();h.advance(30000);const next=harness({storage:h.storage,startTime:h.now+100});next.c.restoreFaceAutoResume();next.c.startFaceWatchdog();next.advance(30000);assert.equal(next.reloads,0);assert(!next.monitoring);assert.match(next.status.textContent,/已自動重讀一次/);});
test('storage failure prevents unsafe reload; stale or malformed resume cannot start camera',()=>{const h=harness({writeFails:true});h.c.startFaceWatchdog();h.advance(30000);assert.equal(h.reloads,0);assert.match(h.status.textContent,/保留復原狀態/);for(const raw of ['bad',JSON.stringify({at:1,day:'2026-10-20',ids:[]}),JSON.stringify({at:1000000,day:'2026-10-19',ids:[]})]){const s=harness({storage:new Map([['mplus_face_resume',raw]])});assert.equal(s.c.restoreFaceAutoResume(),false);}});
test('hidden or deliberately stopped cameras never reload',()=>{const h=harness();h.c.startFaceWatchdog();h.c.document.hidden=true;h.advance(60000);assert.equal(h.reloads,0);h.c.stopFaceRecognition();h.c.document.hidden=false;h.advance(60000);assert.equal(h.reloads,0);});
test('an actual unresolved face-api inference cannot hold the page forever',async()=>{
 const h=harness();let loopTick,attempts=0;
 h.c.faceCanvasEl={};h.c.faceStream={};h.c.faceMatchRequestPending=false;
 h.c.faceapi={matchDimensions(){},TinyFaceDetectorOptions:class{},detectAllFaces(){attempts++;return{withFaceLandmarks:()=>({withFaceDescriptors:()=>new Promise(()=>{})})};}};
 h.c.startFaceWatchdog();h.c.setInterval=fn=>(loopTick=fn,2);
 const a=html.indexOf('    async function startFaceDetectionLoop()'),b=html.indexOf('\n    // ===',a);
 vm.runInContext(html.slice(a,b),h.c);await h.c.startFaceDetectionLoop();loopTick();await Promise.resolve();for(let i=0;i<10;i++)await loopTick();assert.equal(attempts,1);assert(h.c.faceMatchRequestPending);h.advance(30000);assert.equal(h.reloads,1);
});
test('real UI readiness predicate blocks dirty drafts, active writes and open dialogs',()=>{
 const ui=fs.readFileSync(new URL('../school-ui.js',import.meta.url),'utf8');
 const expression=ui.match(/canAutoReload:(\(\)=>[^,]+),confirm:/)?.[1];assert(expression);
 const c={drafts:new Set(),busy:()=>false,stack:[]};vm.createContext(c);const ready=vm.runInContext(expression,c);
 assert(ready());c.drafts.add('tab-rollcall');assert(!ready());c.drafts.clear();c.stack.push({});assert(!ready());c.stack.length=0;c.busy=()=>true;assert(!ready());
});
