'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {audit}=require('../tools/reader-ruby-coverage.cjs');
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-ruby-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const image=Buffer.from('a private synthetic image'), hash=sha(image), blank=Buffer.from('blank'), blankHash=sha(blank);
 function ref(name,data){const bytes=Buffer.from(JSON.stringify(data));fs.writeFileSync(path.join(root,name),bytes);return {path:name,sha256:sha(bytes)};}
 const mk=(start,base,reading,box,side='right')=>({start,end:start+Array.from(base).length,base,reading,sourceBox:box,
  side,reviewStatus:'verified',sourceScan:1,sourceImageSha256:hash});
 const a=mk(1,'原','げん',[7,2,9,5]), b=mk(2,'本','ほん',[7,5,9,7]);
 const c=mk(1,'原本','テキスト',[1,2,3,7],'left');
 const page={scan:1,width:20,height:30,sha256:hash,dataUrl:'data:image/png;base64,'+image.toString('base64'),
  blocks:[{id:'para',text:'𠮷原本',ruby:[a,b,c]}]};
 const blankPage={scan:2,width:10,height:10,sha256:blankHash,dataUrl:'data:image/png;base64,'+blank.toString('base64'),blocks:[]};
 const book={bookId:'synthetic',range:[1,2],pages:[page,blankPage]};
 const review={scan:1,sourceSha256:hash,visualReview:'complete',method:'Read both sides of all columns on the original',
  corrections:[{blockId:'para',start:1,end:2,old:'厚',new:'原',sourceBox:[3,2,7,5]}],
  annotations:[a,b,c].map(r=>({...r,blockId:'para'})),
  candidates:[{index:0,status:'ruby',reason:'one OCR box covers the two printed readings on the right'},
   {index:1,status:'non-ruby',reason:'three printed emphasis marks on the next column'}],unresolved:[]};
 const raw={scan:1,source_sha256:hash,width:20,height:30,rows:[
  {kind:'block_rubi',box:[7,2,9,7],text:'10'},{kind:'block_rubi',box:[17,2,19,8],text:'○'}]};
 const original={scan:1,sha256:hash,blocks:[{id:'para',text:'𠮷厚本'}]};
 const blankReview={scan:2,sourceSha256:blankHash,visualReview:'complete',method:'Examined the entire blank leaf',
  corrections:[],annotations:[],candidates:[],unresolved:[]};
 const inv={schema:'reader-ruby-inventory-v1',bookId:book.bookId,range:book.range,pages:[
  {scan:1,baseline:ref('before1',original),ocr:ref('ocr1',raw)},
  {scan:2,baseline:ref('before2',blankPage),ocr:ref('ocr2',{scan:2,width:10,height:10,source_sha256:blankHash,rows:[]})}]};
 function run(){inv.pages[0].review=ref('review1',review);if(inv.pages.length>1)inv.pages[1].review=ref('review2',blankReview);
  const manifest=ref('inv',inv);return audit(book,sha('html'),path.join(root,manifest.path),manifest.sha256);}
 return {run,book,review,blankReview,inv};
}
test('source-first review can add missed manual ruby, opposite-side overlaps, and split one bad OCR box',t=>{
 const r=fixture(t).run();assert.equal(r.status,'complete');assert.equal(r.candidates,2);assert.equal(r.renderedReadings,3);
});
test('zero raw candidates still requires that original page to be inspected',t=>{
 const f=fixture(t);f.blankReview.visualReview='partial';const r=f.run();assert.equal(r.status,'partial');assert.equal(r.incomplete[0].scan,2);
});
test('an unhandled raw box, separate unresolved transcription, or a missing page cannot be marked complete',t=>{
 const f=fixture(t);f.review.candidates.pop();f.review.unresolved.push('uncertain base');f.inv.pages.pop();
 const r=f.run();assert.equal(r.status,'partial');assert.equal(r.unresolvedCandidates,1);assert.equal(r.incomplete.length,2);
});
test('losing a reviewed ruby at merge is detected even where OCR never found it',t=>{
 const f=fixture(t);f.book.pages[0].blocks[0].ruby.pop();assert.match(f.run().errors[0].reason,/readings differ/);
});
test('reject a swapped image, mismatched retained side, and stale parent-text correction',t=>{
 const f=fixture(t);f.book.pages[0].dataUrl='data:image/png;base64,YQ==';assert.match(f.run().errors[0].reason,/original in edition/);
 const g=fixture(t);g.book.pages[0].blocks[0].ruby[0].side='left';assert.match(g.run().errors[0].reason,/readings differ/);
 const h=fixture(t);h.review.corrections[0].old='古';assert.match(h.run().errors[0].reason,/parent-text correction/);
});
test('rereview can refine a crop of the same anchored printed syllable',t=>{
 const f=fixture(t);f.review.annotations.push({...f.review.annotations[0],sourceBox:[7,2,10,6]});
 assert.equal(f.run().status,'complete');
 f.review.annotations.at(-1).sourceBox=[15,15,17,17];assert.equal(f.run().status,'partial');
});
test('count printed readings on an unaltered image-only page separately from typeset ruby',t=>{
 const f=fixture(t);f.book.pages[1].pageType='image';f.blankReview.imageOnly=true;
 f.blankReview.imageOnlyReadings=[{base:'注',reading:'ちゅう',sourceBox:[1,1,6,4],side:'above'}];
 const r=f.run();assert.equal(r.status,'complete');assert.equal(r.facsimileReadings,1);assert.equal(r.renderedReadings,3);
 f.book.pages[1].pageType='prose';assert.match(f.run().errors[0].reason,/image-only reading/);
});
test('a missing paragraph needs its source position and an adjacent existing block',t=>{
 const f=fixture(t);
 const block={id:'recovered',text:'追加した本文。'};f.review.insertBlocks=[{beforeId:'para',sourceBox:[1,8,8,18],block}];
 f.book.pages[0].blocks.unshift(block);
 assert.equal(f.run().status,'complete');
 f.review.insertBlocks[0].sourceBox=[0,0,99,88];assert.match(f.run().errors[0].reason,/new text block/);
});
