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
test('first-page control is on the public host and stays visible after reader repaint',()=>{
 assert.match(loader,/<button type="button" id="firstPageButton" aria-label="本の先頭へ戻る" hidden>最初へ<\/button>/);
 assert.match(loader,/#firstPageButton\[hidden\]\{display:none!important\}/);
 assert.match(loader,/#firstPageButton\{[\s\S]*?position:fixed!important;z-index:2147483000!important/);
 assert.match(loader,/readerReady=true;placeFirstPageButton\(\);notifyBrowserZoom\(\)/);
 assert.match(loader,/if\(opening\)\{opening=false;unbusy\(\);\$\('setup'\)\.hidden=true;\}[\s\S]*?placeFirstPageButton\(\);/);
 const fn=extract(/ function placeFirstPageButton\(\)\{[\s\S]*?\n \}/,'placement function');
 let appended=0;
 const body={append(b){appended++;b.parentElement=body;}};
 const button={parentElement:null,hidden:true};
 const sandbox={document:{body},firstPageButton:button,readerReady:true,book:{}};
 vm.createContext(sandbox);
 vm.runInContext(fn+'\nplaceFirstPageButton();placeFirstPageButton();',sandbox);
 assert.equal(appended,1,'button stays attached to host body, not volatile private engine');
 assert.equal(button.hidden,false);
 const absent={document:{body},firstPageButton:{parentElement:null,hidden:true},readerReady:false,book:{}};
 vm.createContext(absent);vm.runInContext(fn+'\nplaceFirstPageButton();',absent);
 assert.equal(absent.firstPageButton.hidden,true,'button cannot appear before reader is ready');
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
