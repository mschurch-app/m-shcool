import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
const css=await readFile(new URL('../school-homepage.css',import.meta.url),'utf8');
test('both school entries load the shared homepage theme once and allow zoom',async()=>{
 for(const file of ['index.html','index2.html']){
  const html=await readFile(new URL('../'+file,import.meta.url),'utf8');
  assert.equal((html.match(/href="school-homepage\.css\?/g)||[]).length,1);
  assert.match(html,/<body class="school-app /);
  assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
 }
});
test('school design uses the church homepage palette and separate screen styles',()=>{
 for(const value of ['#302823','#685d57','#ad3c2a','#faf8f5','#e9e3dd'])assert.ok(css.includes(value));
 assert.match(css,/@media screen/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/focus-visible/);
 assert.match(css,/#counsel-add-button \{ min-height:44px/);
});
function luminance(hex){const c=hex.replace('#','').match(/../g).map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
test('core text and action token pairs meet 4.5 to 1 contrast',()=>{
 for(const [a,b]of[['#302823','#ffffff'],['#685d57','#ffffff'],['#685d57','#faf8f5'],['#ad3c2a','#ffffff'],['#be123c','#ffffff'],['#0f766e','#ffffff']]){
  const [lo,hi]=[luminance(a),luminance(b)].sort((x,y)=>x-y);assert.ok((hi+.05)/(lo+.05)>=4.5,`${a} / ${b}`);
 }
});
