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
test('UK controls match WH1: bookshelf strip above the reader, no floating text overlays',()=>{
 const wh1=fs.readFileSync(path.join(__dirname,'../reader/wh1/all/index.html'),'utf8');
 assert.match(wh1,/#bookshelfNav\{[\s\S]*?min-height:calc\(44px \+ env\(safe-area-inset-top\)\)/);
 assert.match(loader,/<nav id="ukBookshelfNav" aria-label="読書ナビゲーション" hidden>/);
 assert.match(loader,/<button type="button" id="backToShelfButton" aria-label="私の本棚に戻る" hidden>◀ 本棚へ<\/button>/);
 assert.match(loader,/<button type="button" id="firstPageButton" aria-label="本の先頭へ戻る" hidden>最初へ<\/button>/);
 assert.match(loader,/#ukBookshelfNav\{[\s\S]*?min-height:calc\(44px \+ env\(safe-area-inset-top\)\)/);
 assert.match(loader,/#reader-main\{[\s\S]*?top:calc\(44px \+ env\(safe-area-inset-top\)\)!important/);
 assert.match(loader,/#firstPageButton\{\s*position:static!important/);
 assert.match(loader,/#firstPageButton\[hidden\]\{display:none!important\}/);
 assert.match(loader,/#backToShelfButton\[hidden\]\{display:none!important\}/);
 assert.match(loader,/#ukBookshelfNav\[hidden\]\{display:none!important\}/);
 assert.doesNotMatch(loader,/top:calc\(58px \+ env\(safe-area-inset-top\)\)!important/);
 assert.match(loader,/readerReady=true;placeFirstPageButton\(\);notifyBrowserZoom\(\)/);
 assert.match(loader,/if\(opening\)\{opening=false;unbusy\(\);\$\('setup'\)\.hidden=true;\}[\s\S]*?placeFirstPageButton\(\);/);
});
test('navigation mounts first page next to the actual menu and shelf above private text',()=>{
 const fn=extract(/ function placeFirstPageButton\(\)\{[\s\S]*?\n \}/,'placement function');
 const mounted=[],marks=[];
 const body={append(el){mounted.push(el);el.parentElement=body;}};
 const nav={parentElement:null,hidden:true,appendChild(el){el.parentElement=nav;}};
 const first={parentElement:null,hidden:true},shelf={hidden:true};
 const header={classList:{add(name){marks.push(name);}}};
 const menu={textContent:'目次',parentElement:null,getAttribute(){return '';}};
 const other={textContent:'原本',getAttribute(){return '';}};
 const actions={
  classList:{add(name){marks.push(name);}},
  querySelectorAll(){return [menu,other];},
  closest(tag){return tag==='header'?header:null;},
  insertBefore(el,ref){assert.equal(ref,menu);el.parentElement=actions;mounted.push(el);}
 };
 menu.parentElement=actions;
 const reader={querySelectorAll(){return [menu,other];}};
 const sandbox={document:{body},$:(id)=>id==='ukBookshelfNav'?nav:reader,
   firstPageButton:first,backToShelfButton:shelf,readerReady:true,book:{}};
 vm.createContext(sandbox);
 vm.runInContext(fn+'\nplaceFirstPageButton();placeFirstPageButton();',sandbox);
 assert.equal(nav.parentElement,body);
 assert.equal(first.parentElement,actions,'first-page button is on the native toolbar');
 assert.deepEqual(marks,['uk-bookshelf-actions','uk-bookshelf-header','uk-bookshelf-actions','uk-bookshelf-header']);
 assert.equal(mounted.length,2,'no duplicates after a redraw');
 assert.equal(nav.hidden,false);assert.equal(first.hidden,false);assert.equal(shelf.hidden,false);
 const missing={document:{body},$:()=>nav,firstPageButton:{hidden:true},backToShelfButton:{hidden:true},
   readerReady:false,book:{}};
 vm.createContext(missing);vm.runInContext(fn+'\nplaceFirstPageButton();',missing);
 assert.equal(missing.firstPageButton.hidden,true,'no early control before book opens');
});
test('an unexpected private toolbar uses a non-overlapping navigation fallback',()=>{
 const fn=extract(/ function placeFirstPageButton\(\)\{[\s\S]*?\n \}/,'placement function');
 const body={append(el){el.parentElement=body;}};
 const nav={parentElement:null,hidden:true,appendChild(el){el.parentElement=nav;}};
 const first={parentElement:null,hidden:true},shelf={hidden:true};
 const reader={querySelectorAll(){return [];}};
 const sandbox={document:{body},$:(id)=>id==='ukBookshelfNav'?nav:reader,
    firstPageButton:first,backToShelfButton:shelf,readerReady:true,book:{}};
 vm.createContext(sandbox);vm.runInContext(fn+'\nplaceFirstPageButton();',sandbox);
 assert.equal(first.parentElement,nav);
 assert.equal(nav.hidden,false);
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
