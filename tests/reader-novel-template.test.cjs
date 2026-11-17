'use strict';
// Synthetic/original demo text only. These tests do not certify an actual novel's OCR or iPhone display.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../templates/reader/v2');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const novel=require('../templates/reader/v2/novel-dialogue.js');
const {checkPublicNovel,files:publicDemoFiles}=require('../tools/verify-novel-template-pages.cjs');
const demo=read('novel.html'),css=read('novel.css'),js=read('novel.js');
const data=JSON.parse(demo.match(/<script>window\.READER_BOOK=({[\s\S]*?});<\/script>/)?.[1]||'null');

test('novel-specific entry retains standard WH1 geometry and all controls',()=>{
 assert.equal(data.kind,'text');
 assert.equal(data.status,'小説用・架空の短編');
 assert.match(demo,/class="novel-reading"/);
 for(const token of ['standard.css','novel.css','novel-dialogue.js','novel.js'])assert.ok(demo.includes('./'+token),token);
 for(const id of ['sheet','measure-sheet','text-flow','measure-text','original','first','all','smaller','larger','prev','next','page-major','page-minor','progress-fill'])
  assert.ok(demo.includes('id="'+id+'"'),'Missing '+id);
 assert.match(read('standard.css'),/--size:20px;--lh:1\.50;--one-column:30px/);
 assert.match(read('standard.css'),/writing-mode:vertical-rl/);
 assert.match(css,/\.text-flow \.novel-paragraph\s*\{\s*display:block!important/);
 assert.match(css,/\.novel-dialogue:not\(\.continued\)::before\s*\{\s*content:none!important/);
 assert.match(css,/source-indented/);
 assert.match(read('index.html'),/href="\.\/novel\.html"/);
});

test('a dialogue opening quote within narration begins a new paragraph without losing a character',()=>{
 const original='彼は言った。「待って」彼女は振り返った。「何？」';
 const parts=novel.expandBlocks([{type:'body',scan:41,text:original}]);
 assert.deepEqual(parts.map(x=>x.text),['彼は言った。','「待って」彼女は振り返った。','「何？」']);
 assert.deepEqual(parts.map(x=>x.type),['body','dialogue','dialogue']);
 assert.equal(parts.map(x=>x.text).join(''),original);
 assert.ok(parts.filter(x=>x.type==='dialogue').every(x=>x.text.startsWith('「')));
 assert.ok(parts.every(x=>x.scan===41));
});

test('every consecutive speaker opening mark gets a separate column',()=>{
 const text='「はい」「いいえ」「では、また」';
 const parts=novel.expandBlocks([{type:'body',scan:42,text}]);
 assert.deepEqual(parts.map(x=>x.text),['「はい」','「いいえ」','「では、また」']);
 assert.ok(parts.every(x=>x.type==='dialogue'));
});

test('inner quotes stay nested inside one spoken paragraph',()=>{
 const text='「彼が「まだ」と答えたのを覚えている？」';
 const parts=novel.expandBlocks([{type:'body',scan:43,text,inlineQuoteOffsets:[text.indexOf('「',1)]}]);
 assert.equal(parts.length,1);
 assert.equal(parts[0].text,text);
 assert.equal(parts[0].type,'dialogue');
});

test('an explicitly confirmed non-dialogue quotation remains inline',()=>{
 const text='看板に「入口」と書いてあった。';
 const parts=novel.expandBlocks([{type:'body',scan:43,text,quoteMode:'inline'}]);
 assert.equal(parts.length,1);
 assert.equal(parts[0].type,'body');
 assert.equal(parts[0].text,text);
});

test('source bytes remain round-trip stable even with headings and page transitions',()=>{
 const original=[
  {type:'heading',scan:41,text:'第１章'},
  {type:'body',scan:41,text:'夜だった。「寒いね」'},
  {type:'body',scan:42,text:'「そうだね」'},
  {type:'body',scan:42,text:'文字の「引用」。',splitDialogue:false},
 ];
 const parts=novel.expandBlocks(original);
 for(const [i,b] of original.entries())assert.equal(parts.filter(x=>x.sourceBlockIndex===i).map(x=>x.text).join(''),b.text);
 assert.equal(parts.map(x=>x.text).join(''),original.map(x=>x.text).join(''));
 assert.equal(parts[0].type,'heading');
 assert.equal(parts[parts.length-1].scan,42);
});

test('strict input: malformed scan or block is not silently converted',()=>{
 assert.throws(()=>novel.expandBlocks([{type:'body',text:'「はい」',scan:0}]),/NOVEL_INVALID_SCAN/);
 assert.throws(()=>novel.expandBlocks([{type:'body',scan:1,text:42}]),/NOVEL_INVALID_TEXT_BLOCK/);
 assert.throws(()=>novel.expandBlocks(null),/NOVEL_BLOCK_ARRAY_REQUIRED/);
});

test('novel engine has independent paragraph layout without changing common standard engine',()=>{
 new vm.Script(js,{filename:'novel.js'});
 new vm.Script(read('novel-dialogue.js'),{filename:'novel-dialogue.js'});
 assert.match(js,/NovelDialogue\.expandBlocks/);
 assert.match(js,/novel-reader-v1:/);
 assert.match(js,/novel-dialogue/);
 assert.match(js,/window\.NovelReader/);
 assert.match(js,/function paginateBlocks\(/);
 assert.match(js,/range\.getClientRects\(\)/);
 assert.match(js,/function protectedPageBoundary\(/);
 assert.match(js,/localStorage\.setItem\(key/);
 assert.match(js,/reader-viewport-v8/);
 assert.match(js,/touchstart/);
 assert.match(js,/touchcancel/);
 assert.doesNotMatch(js,/new OffscreenCanvas|canvas\.toDataURL|canvas\.toBlob/);
 assert.doesNotMatch(demo+js,/data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]{40}/);
 assert.equal(data.blocks.length,10);
});

test('the public sample demonstrates automatic dialogue and a deliberately inline quoted term',()=>{
 const parts=novel.expandBlocks(data.blocks);
 assert.ok(parts.filter(x=>x.type==='dialogue').length>=4);
 const inline=data.blocks.find(x=>x.quoteMode==='inline');
 assert.ok(inline);
 assert.deepEqual(novel.expandOne(inline,1).map(x=>x.text),[inline.text]);
 assert.equal(parts.map(x=>x.text).join(''),data.blocks.map(x=>x.text).join(''));
});

test('post-deploy novel URL evidence requires HTTP 200 and identical actual bytes',async()=>{
 const repo=path.resolve(root,'../../..');
 assert.equal(publicDemoFiles.length,6);
 assert.ok(publicDemoFiles.includes('templates/reader/v2/standard.js'),'WH1 standard reader must be byte-pinned on public deployment');
 const okFetch=async url=>{
  const location=new URL(url);
  return new Response(fs.readFileSync(path.join(repo,location.pathname.slice('/flashcards/'.length))),{
   status:200,headers:{'content-type':'text/html'}
  });
 };
 const okay=await checkPublicNovel(repo,okFetch,{attempts:1,wait:async()=>{}});
 assert.equal(okay.eligible,true);
 assert.equal(okay.checks.length,6);
 assert.ok(okay.checks.every(x=>x.status==='verified'&&x.httpStatus===200&&x.expectedSha256===x.observedSha256));
 assert.equal(okay.contentCertified,false);
 assert.equal(okay.iphoneVerified,false);
 const badFetch=async url=>{
  if(url.includes('novel.html'))return new Response('404',{status:404});
  return okFetch(url);
 };
 const blocked=await checkPublicNovel(repo,badFetch,{attempts:1,wait:async()=>{}});
 assert.equal(blocked.eligible,false);
 assert.equal(blocked.checks.find(x=>x.entry.endsWith('/novel.html')).error,'HTTP_404');
 const wrongBytes=async url=>{
  if(url.includes('novel.js'))return new Response('stale bytes',{status:200});
  return okFetch(url);
 };
 const stale=await checkPublicNovel(repo,wrongBytes,{attempts:1,wait:async()=>{}});
 assert.equal(stale.eligible,false);
 assert.equal(stale.checks.find(x=>x.entry.endsWith('/novel.js')).error,'DEPLOYED_BYTES_DIFFER');
 const brokenStandard=await checkPublicNovel(repo,async url=>{
  if(url.includes('/standard.js'))return new Response('mismatching standard reader bytes',{status:200});
  return okFetch(url);
 },{attempts:1,wait:async()=>{}});
 assert.equal(brokenStandard.eligible,false);
 assert.equal(brokenStandard.checks.find(x=>x.entry.endsWith('/standard.js')).error,'DEPLOYED_BYTES_DIFFER');
});

test('novel chapter and section headings are truly black without recoloring history templates',()=>{
 const common=read('standard.css');
 assert.match(common,/\.text-flow \.section-heading\{[^\n]*color:var\(--accent\)/);
 assert.match(css,/body\.novel-reading \.text-flow \.section-heading\s*\{\s*color:#000\s*;/);
 const standardPosition=demo.indexOf('href="./standard.css"');
 const novelPosition=demo.indexOf('href="./novel.css"');
 assert.ok(standardPosition>=0&&novelPosition>standardPosition,'novel override must load after standard');
 assert.match(demo,/<body class="novel-reading">/);
 assert.ok(data.blocks.some(x=>x.type==='heading'),'sample must actually show a heading');
});

test('missing OCR closing quotes cannot suppress later speech-column starts',()=>{
 const original='「最初のセリフが閉じていない「次のセリフ」「三つ目」';
 const parsed=novel.expandBlocks([{type:'body',scan:21,text:original}]);
 assert.deepEqual(parsed.map(x=>x.text),[
  '「最初のセリフが閉じていない','「次のセリフ」','「三つ目」'
 ]);
 assert.equal(parsed.length,(original.match(/「/g)||[]).length);
 assert.equal(parsed.map(x=>x.text).join(''),original);
 assert.ok(parsed.every(x=>x.type==='dialogue'&&x.text.startsWith('「')));
});
test('a source block tagged continuation cannot erase a new spoken opening',()=>{
 const t='「今から話すよ」';
 const p=novel.expandBlocks([{scan:22,type:'body',text:t,joinPrevious:true}]);
 assert.equal(p.length,1);
 assert.equal(p[0].text[0],'「');
 assert.equal(p[0].type,'dialogue');
 assert.equal(p[0].sourceStart,0);
});
test('source-reviewed nested quote exceptions are validated by exact offsets',()=>{
 const text='「長い話の「一節」を説明する」';
 const nested=text.indexOf('「',1);
 const parsed=novel.expandBlocks([{scan:1,text,inlineQuoteOffsets:[nested]}]);
 assert.equal(parsed.length,1);assert.equal(parsed[0].text,text);
 assert.throws(()=>novel.expandBlocks([{scan:1,text,inlineQuoteOffsets:[999]}]),/NOVEL_INLINE_QUOTE_OFFSET_INVALID/);
 assert.throws(()=>novel.expandBlocks([{scan:1,text,inlineQuoteOffsets:[nested,nested]}]),/NOVEL_INLINE_QUOTE_OFFSET_INVALID/);
});
