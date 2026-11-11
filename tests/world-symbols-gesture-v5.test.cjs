'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const gesture=require('../reader/world-symbols/001-020/reader-gesture-v5.js');
const src=fs.readFileSync(path.join(__dirname,'fixtures/world-symbols-synthetic.html'),'utf8');
test('v5 loader is explicit, source remains private and a version marker is visible in the imported reader',()=>{
 const shell=fs.readFileSync(path.join(__dirname,'../reader/world-symbols/001-020/index.html'),'utf8');
 assert.match(shell,/reader-gesture-v5\.js\?v=20261112-v5/);
 assert.match(shell,/WorldSymbolsGestureV5\.wrapHtml\(result\.html\)/);
 assert.match(shell,/操作修正版v5/);
 assert.doesNotMatch(shell,/data:image\/(?:jpeg|png);base64,/);
 const fixed=gesture.wrapHtml(src);
 assert.match(fixed,/<script id="ws-gesture-v5">/);
 assert.match(fixed,/操作修正v5を読込済み/);
 assert.equal(gesture.wrapHtml(fixed),fixed);
 const data=t=>t.match(/<script id="embedded-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
 assert.equal(data(src),data(fixed));
 assert.doesNotThrow(()=>new vm.Script(gesture.source));
});
function setup(){
 const handlers=new Map(),byId=new Map(),updates=[];
 const stage={style:{},addEventListener:(kind,fn,opts)=>{if(!handlers.has(kind))handlers.set(kind,[]);handlers.get(kind).push(fn);}};
 let nav=1;
 const where={textContent:'004 / 020'},sub={textContent:'読書画面 1 / 6'};
 const parent={insertAdjacentElement:(where,elem)=>updates.push(elem)};
 byId.set('readView',stage);byId.set('status',{insertAdjacentElement:parent.insertAdjacentElement});
 byId.set('where',where);byId.set('whereSub',sub);
 const doc={getElementById:id=>byId.get(id),createElement:tag=>({style:{},setAttribute(){},textContent:'',id:''})};
 const win={visualViewport:{scale:1}};
 const ctx={window:win,document:doc,go:dir=>{nav=Math.max(1,Math.min(6,nav+dir));sub.textContent='読書画面 '+nav+' / 6';},Date,console};
 vm.createContext(ctx);vm.runInContext(gesture.source,ctx);
 function emit(kind,one,two,tip){
  const touches=one===null?[]:[{clientX:200,clientY:one},...(two===undefined?[]:[{clientX:210,clientY:two}])];
  const changedTouches=tip==null?touches:[{clientX:200,clientY:tip}];
  const e={touches,changedTouches,cancelable:true,stopImmediatePropagation(){},preventDefault(){}};
  for(const fn of handlers.get(kind)||[])fn(e);
 }
 return {emit,win,updates,nav:()=>nav};
}
test('real iPhone screenshot case 004 1/6: up then immediate down returns to 1/6',()=>{
 const t=setup();
 assert.equal(t.nav(),1);assert.equal(t.updates[0].textContent.includes('操作修正v5'),true);
 t.emit('touchstart',650);
 t.emit('touchmove',590);t.emit('touchmove',480);t.emit('touchmove',300);
 t.emit('touchend',null,undefined,300);
 assert.equal(t.nav(),2,'one gesture must only move one page');
 t.emit('touchstart',280);
 t.emit('touchmove',360);t.emit('touchmove',480);t.emit('touchmove',640);
 t.emit('touchend',null,undefined,640);
 assert.equal(t.nav(),1,'reverse down gesture cannot be throttled');
 assert.match(t.updates[0].textContent,/下→前へ/);
});
test('pinch and browser zoom never page through the private book',()=>{
 const t=setup();
 t.emit('touchstart',250,300);t.emit('touchmove',190,380);t.emit('touchend',null);
 assert.equal(t.nav(),1);
 t.win.visualViewport.scale=2;
 t.emit('touchstart',700);t.emit('touchmove',220);t.emit('touchend',null,undefined,220);
 assert.equal(t.nav(),1);
});
test('a short touch and a double move do not cause duplicate page turns',()=>{
 const t=setup();
 t.emit('touchstart',300);t.emit('touchmove',320);t.emit('touchend',null,undefined,320);
 assert.equal(t.nav(),1);
 t.emit('touchstart',650);t.emit('touchmove',605);t.emit('touchmove',500);
 t.emit('touchmove',420);t.emit('touchend',null,undefined,420);
 assert.equal(t.nav(),2);
});
