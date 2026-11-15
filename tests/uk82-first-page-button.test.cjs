'use strict';
// Synthetic-only checks for the UK 82-scan reader's *public loader*.
// No private ZIP, original JPEG, OCR text, or fabricated device results.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const loader=fs.readFileSync(path.join(__dirname,'../reader/british-interiors/full/index.html'),'utf8');
function extract(re,label){
 const m=loader.match(re);
 assert.ok(m,label+' is present in the exact loader');
 return m[0];
}
test('reader loader remains parseable and source verification is retained',()=>{
 const block=extract(/<script>\s*'use strict';[\s\S]*?<\/script>/,'inline JavaScript');
 new vm.Script(block.replace(/^<script>/,'').replace(/<\/script>$/,''));
 assert.match(loader,/const TRUSTED_ENGINE_SHA256='[a-f0-9]{64}'/);
 assert.match(loader,/if\(hex!==TRUSTED_ENGINE_SHA256\)/);
 assert.match(loader,/m\.total_scans!==TOTAL/);
 assert.match(loader,/d\.kind==='uk82-stream-state'/);
});
test('UK controls match the approved WH1 screenshot with a dedicated toolbar and a separate progress footer',()=>{
 const wh1=fs.readFileSync(path.join(__dirname,'../reader/wh1/all/index.html'),'utf8');
 assert.match(wh1,/#bookshelfNav\{[\s\S]*?min-height:calc\(44px \+ env\(safe-area-inset-top\)\)/);
 assert.match(loader,/<nav id="ukBookshelfNav"[^>]*><button[^>]*id="backToShelfButton"[^>]*>◀ 本棚へ<\/button><span id="ukShelfStatus">OCR独立校正継続中<\/span><\/nav>/);
 assert.match(loader,/<button type="button" id="firstPageButton" aria-label="本の先頭へ戻る" hidden>最初へ<\/button>/);
 assert.match(loader,/#ukBookshelfNav\{[\s\S]*?min-height:calc\(44px \+ env\(safe-area-inset-top\)\)/);
 assert.match(loader,/#reader-main\.reader-main\{[\s\S]*?flex:1 1 0%!important/);
 assert.match(loader,/header\.toolbar\{position:relative!important/);
 assert.match(loader,/#ukFontGroup\{margin-left:auto!important/);
 assert.match(loader,/footer\.reader-footer \.progress-line/);
 assert.match(loader,/#ukPageMajor\{display:block/);
 assert.match(loader,/readerReady=true;placeFirstPageButton\(\);notifyBrowserZoom\(\)/);
 assert.match(loader,/if\(opening\)\{opening=false;unbusy\(\);\$\('setup'\)\.hidden=true;\}[\s\S]*?placeFirstPageButton\(\);/);
 assert.doesNotMatch(loader,/data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]{64,}/,'no private scan is published');
});

test('first-page navigation occupies the native action row without duplicating controls',()=>{
 const fn=extract(/ function placeFirstPageButton\(\)\{[\s\S]*?\n \}/,'placement function');
 const els={},mounted=[];
 const body={append(node){node.parentElement=body;mounted.push(node);}};
 const nav={parentElement:null,hidden:true};
 const first={parentElement:null,hidden:true},shelf={hidden:true};
 const actionRow={children:[],append(...nodes){
   for(const node of nodes){
     if(node.parentElement?.children)node.parentElement.children=node.parentElement.children.filter(x=>x!==node);
     this.children=this.children.filter(x=>x!==node);this.children.push(node);node.parentElement=this;
   }
 }};
 const original={parentElement:actionRow};
 const menu={parentElement:actionRow,textContent:'目次',setAttribute(k,v){this[k]=v;}};
 const smaller={parentElement:actionRow},size={parentElement:actionRow},larger={parentElement:actionRow};
 actionRow.children=[original,menu,smaller,size,larger];
 Object.assign(els,{ukBookshelfNav:nav,'open-original':original,'open-menu':menu,smaller,'current-size':size,larger});
 let footerUpdates=0,group=null;
 const document={body,querySelector:q=>q==='header.toolbar .toolbar-actions'?actionRow:null,createElement:tag=>{
   const el={parentElement:null,children:[],append(...nodes){
     for(const n of nodes){if(n.parentElement?.children)n.parentElement.children=n.parentElement.children.filter(x=>x!==n);this.children.push(n);n.parentElement=this;}
   }};
   Object.defineProperty(el,'id',{set(v){this._id=v;els[v]=this;},get(){return this._id;}});
   if(tag==='span')group=el;
   return el;
 }};
 const sandbox={document,$:id=>els[id]||null,firstPageButton:first,backToShelfButton:shelf,
   readerReady:true,book:{},updateWh1Footer:()=>footerUpdates++};
 vm.createContext(sandbox);vm.runInContext(fn+'\nplaceFirstPageButton();placeFirstPageButton();',sandbox);
 assert.equal(nav.parentElement,body);
 assert.equal(mounted.length,1,'bookshelf strip is mounted just once');
 assert.equal(menu.textContent,'全巻');
 assert.equal(menu['aria-label'],'全巻の目次を開く');
 assert.deepEqual(actionRow.children,[original,first,menu,group]);
 assert.deepEqual(group.children,[smaller,size,larger]);
 assert.equal(footerUpdates,2);
 assert.equal(nav.hidden,false);assert.equal(first.hidden,false);assert.equal(shelf.hidden,false);
 const missing={document:{body},$:()=>null,firstPageButton:{hidden:true},backToShelfButton:{hidden:true},readerReady:false,book:{}};
 vm.createContext(missing);vm.runInContext(fn+'\nplaceFirstPageButton();',missing);
 assert.equal(missing.firstPageButton.hidden,true);
});
test('missing native action row never overlays the original book or moves the first-page control',()=>{
 const fn=extract(/ function placeFirstPageButton\(\)\{[\s\S]*?\n \}/,'placement function');
 const body={append(){throw Error('unexpected overlay');}},nav={hidden:true},first={parentElement:null,hidden:true},shelf={hidden:true};
 const sandbox={document:{body,querySelector:()=>null},$:id=>id==='ukBookshelfNav'?nav:null,firstPageButton:first,backToShelfButton:shelf,readerReady:true,book:{}};
 vm.createContext(sandbox);vm.runInContext(fn+'\nplaceFirstPageButton();',sandbox);
 assert.equal(first.parentElement,null);assert.equal(first.hidden,true);assert.equal(nav.hidden,true);
});

test('tapping first page requests scan 1, paragraph 0 without damaging saved position',async()=>{
 const code=extract(/ firstPageButton\.onclick=\(\)=>\{[\s\S]*?\n \};/,'first-page click handler');
 const calls=[],button={},current={scan:5,itemIndex:4,size:20};
 const sandbox={
  firstPageButton:button,book:{},readerReady:true,current,opening:false,
  sendWindow:(scan,opts)=>{calls.push({scan,opts});return Promise.resolve();},
  unbusy:()=>{throw Error('unexpected navigation failure');},
  say:()=>{throw Error('unexpected error status');}
 };
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 button.onclick();
 await Promise.resolve();
 assert.equal(calls.length,1);
 assert.equal(calls[0].scan,1);
 assert.equal(calls[0].opts.navigate,true);
 assert.equal(calls[0].opts.itemIndex,0);
 assert.equal(calls[0].opts.size,20);
 assert.equal(current.scan,5,'saved reader position must update only upon confirmed stream state');
 sandbox.readerReady=false;button.onclick();
 assert.equal(calls.length,1);
});

test('bookshelf button persists current position before same-tab navigation',()=>{
 const code=extract(/ backToShelfButton\.onclick=\(\)=>\{[^\n]*\};/,'bookshelf click handler');
 const button={},location={href:'book'},calls=[];
 const sandbox={backToShelfButton:button,book:{},readerReady:true,location,flushPosition:()=>calls.push('saved')};
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 button.onclick();
 assert.deepEqual(calls,['saved']);
 assert.equal(location.href,'../../library/');
 sandbox.readerReady=false;location.href='book';button.onclick();assert.equal(location.href,'book');
 assert.deepEqual(calls,['saved']);
});
