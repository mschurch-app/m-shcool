import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8');
const [ui,css,tokens,icons,...entries]=await Promise.all(['school-ui.js','school-ui.css','app-design-tokens.css','school-icons.js','index.html','index2.html','enrollment.html'].map(read));
const registrySource=ui.slice(ui.indexOf('  const roles'),ui.indexOf('  const $'));
const catalog=vm.runInNewContext(registrySource+'; catalog;');
const context={window:{}};vm.runInNewContext(icons,context);
test('one school feature catalog covers every existing panel and the public workstation',()=>{
 assert.equal(new Set(catalog.map(item=>item.key)).size,10);
 assert.deepEqual([...new Set(catalog.filter(item=>item.route).map(item=>item.route))].sort(),['checkin','counseling','import','messages','print-center','rollcall','schedules','students']);
 for(const item of catalog){for(const field of ['key','title','description','group','symbol'])assert.ok(item[field],`${item.key}: ${field}`);assert.ok(context.window.SCHOOL_ICON_PATHS[item.symbol]);}
 assert.equal(catalog.find(item=>item.key==='enrollment').href,'enrollment.html');
});
test('presentation role catalog preserves M management and T/P basic entrances',()=>{
 for(const role of ['同工','老師','工讀生','public']){
  const available=catalog.filter(item=>item.roles.includes(role));
  assert.equal(available.length,role==='同工'?10:role==='public'?2:8);
  assert.equal(available.some(item=>item.key==='import'),role==='同工');
  assert.equal(available.some(item=>item.key==='print'),role==='同工');
 }
 assert.match(ui,/window\.schoolInterface\.navigate\(item\.route\)/);
});
test('every entry loads the same versioned tokens, SVG icons and UI adapter without blocking zoom',()=>{
 for(const entry of entries){for(const file of ['app-design-tokens.css','school-ui.css','school-icons.js','school-ui.js'])assert.match(entry,new RegExp(file.replaceAll('.','\\.')+'\\?v=20261009-stage3'));
 assert.doesNotMatch(entry,/user-scalable=no|maximum-scale=1/);assert.match(entry,/school-mark\.svg/);}
 assert.match(tokens,/--app-ink:#302823/);assert.match(tokens,/--app-accent:#a83929/);
 assert.match(css,/height:80px!important/);assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});
test('dialog layer handles focus, native cancel, background lock, dirty guards and read-only control preservation',()=>{
 for(const token of ['aria-modal','aria-labelledby','returnFocus','focusables','inertBefore','school-modal-open','beforeunload','pendingQuestion','stopImmediatePropagation','prefers-reduced-motion'])assert.ok((ui+css).includes(token),token);
 assert.match(ui,/event\.key==='Tab'/);assert.match(ui,/event\.key==='Escape'/);assert.match(ui,/questionSheet\.addEventListener\('cancel'/);
 assert.doesNotMatch(ui,/\.disabled\s*=\s*false/);
});
test('real write success clears drafts and history uses a text-only dialog',()=>{
 for(const source of entries.slice(0,2)){
  for(const id of ['modal-user','modal-schedule','modal-counseling-add','tab-rollcall','tab-import'])assert.ok(source.includes(`schoolClearDraft('${id}')`));
  assert.match(source,/schoolRecord\('點數紀錄'/);assert.match(source,/schoolRecord\('匯入紀錄'/);
  assert.match(source,/schoolConfirm\(/);assert.match(source,/schoolPrompt\(/);
 }
 assert.match(ui,/element\.textContent=value/);assert.match(css,/@media print/);
});
test('calendar dates and shifts have named keyboard reachable controls; mobile starts with list',()=>{
 for(const source of entries.slice(0,2)){
  assert.match(source,/activeScheduleView = window\.matchMedia\?\./);
  assert.match(source,/class="school-calendar-date" aria-label="\$\{dStr\} 新增排班"/);
  assert.match(source,/class="school-calendar-shift"/);assert.match(source,/school-calendar-scroll/);
 }
 assert.match(css,/school-calendar-scroll>div\{min-width:560px/);
});
test('shared semantic foreground and surface pairs meet normal text contrast',()=>{
 const color=hex=>hex.replace('#','').match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 for(const [fg,bg] of [['#302823','#ffffff'],['#65574f','#ffffff'],['#65574f','#faf8f6'],['#ffffff','#a83929'],['#245c3b','#eaf5ee'],['#71481c','#fff0d9'],['#96291e','#fff1ee'],['#165b9c','#e9f2ff']]){
  const a=color(fg),b=color(bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,fg+' on '+bg);
 }
});
