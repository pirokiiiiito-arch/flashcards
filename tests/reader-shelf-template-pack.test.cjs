'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const test=require('node:test');
const {spawnSync}=require('node:child_process');

function assemble(input) {
 const python=`
import json,sys
from reader_shelf_template import template_html
m,parts=json.load(sys.stdin)
def read(p):
 v=parts[p]
 if isinstance(v,dict): return json.dumps(v).encode()
 return v.encode()
html=template_html(m,read).decode()
data,_=json.JSONDecoder().raw_decode(html.split('<script>window.READER_BOOK=',1)[1])
print(json.dumps({'book':data,'css':'novel.css' not in html and 'novel-dialogue' in html,
 'shelf':'class="shelf-link" href="./"' in html,'sample':'この短編は見本用' in html,
 'embeddedEngine':'window.NovelReader=' in html,'standardEngine':'window.StandardReader=' in html},ensure_ascii=False))
`;
 return spawnSync('python3',['-c',python],{cwd:path.resolve(__dirname,'../tools'),encoding:'utf8',input:JSON.stringify(input)});
}
function fixture() {
 const m={bookId:'unseen-story-qa',range:[1,22],title:'架空の短編集',template_profile:'novel',originalScans:Object.fromEntries(Array.from({length:22},(_,i)=>[i+1,{path:'s/21.png'}])),
  segments:[{part:'s/first.html',start:1,end:20},{part:'s/next.json',start:21,end:22}]};
 const a={id:m.bookId+'-001-020',kind:'mixed',entries:[{kind:'text',scan:20,blocks:[{type:'heading',text:'駅前'},{type:'dialogue',text:'「新しいエレベー'}]},
 {kind:'image',scan:20,src:'21.png',caption:'架空の図版。'}],
 continuations:[{from:[20,1],to:[21,0]}]};
 const b={bookId:m.bookId,kind:'text',blocks:[{type:'body',scan:21,text:'ターだよ」'},{type:'heading',scan:22,text:'次章'},{type:'body',scan:22,text:'次の朝。'}]};
 return [m,{'s/first.html':'<script>window.READER_BOOK='+JSON.stringify(a)+';</script>','s/next.json':b,'s/21.png':'synthetic asset'}];
}
test('new novel ID composes dialogue through a physical volume and retains a plate, headings and originals exactly once',()=>{
 const res=assemble(fixture());assert.equal(res.status,0,res.stderr);
 const {book,css,shelf,sample,embeddedEngine}=JSON.parse(res.stdout);
 assert.ok(css&&shelf&&embeddedEngine&&!sample);
 assert.equal(book.id,'unseen-story-qa');assert.equal(book.totalScans,22);
 assert.deepEqual(book.entries.map(x=>x.text||x.caption),['駅前','「新しいエレベー','ターだよ」','架空の図版。','次章','次の朝。']);
 assert.equal(book.entries[2].joinPrevious,true);assert.deepEqual(book.entries[2].sourceRef,[21,0]);assert.equal(book.entries[1].type,'dialogue');
 assert.equal(book.originals[0].assetIndex,book.entries[3].assetIndex);
});
test('new novel rejects a missing verified continuation target',()=>{
 const input=fixture();input[0].continuations=[{from:[20,1],to:[22,7]}];
 const res=assemble(input);assert.notEqual(res.status,0);assert.match(res.stderr,/本文接続先/);
});
test('a new short paragraph across archive parts starts independently without a verified edge',()=>{
 const input=fixture();input[1]['s/first.html']=JSON.stringify({bookId:input[0].bookId,kind:'text',blocks:[{type:'body',scan:20,text:'遠くに灯が見えた。'}]});
 input[0].readingFlow={boundaryReviews:[{from:[20,0],to:[21,0],display_boundary:'paragraph',source_review_status:'verified',left_suffix:'見えた。',right_prefix:'ターだよ'}]};
 const res=assemble(input);assert.equal(res.status,0,res.stderr);const {book}=JSON.parse(res.stdout);
 assert.equal(book.kind,'text');assert.ok(!book.blocks[1].joinPrevious);
});

test('an unreviewed novel seam cannot be silently packaged as a new paragraph',()=>{
 const input=fixture();input[1]['s/first.html']=JSON.stringify({bookId:input[0].bookId,kind:'text',blocks:[{type:'body',scan:20,text:'遠くに灯が見えた。'}]});
 const res=assemble(input);assert.notEqual(res.status,0);
});

test('ordinary mixed history template preserves its reference roles, caption and full cross-volume word',()=>{
 const input=fixture();input[0].template_profile='world_history_1';
 input[1]['s/first.html']={bookId:input[0].bookId,kind:'mixed',entries:[
  {kind:'text',scan:20,blocks:[{type:'note',text:'出典'},{type:'body',text:'エレベー'}]},
  {kind:'image',scan:20,src:'21.png',caption:'図版',deferUntilContinuation:true}
 ],continuations:[{from:[20,1],to:[21,0]}]};
 const res=assemble(input);assert.equal(res.status,0,res.stderr);
 const {book,standardEngine,embeddedEngine}=JSON.parse(res.stdout);
 assert.ok(standardEngine&&!embeddedEngine);
 assert.deepEqual(book.entries.map(e=>[e.type||e.kind,e.joinPrevious||false]),[
  ['note',false],['body',false],['body',true],['image',false],['heading',false],['body',false]
 ]);
 assert.equal(book.entries[3].caption,'図版');assert.equal(book.entries[3].deferUntilContinuation,undefined);
});

test('the selected source editions and every original scan must belong to the manifest',()=>{
 const a=fixture();a[1]['s/first.html']=a[1]['s/first.html'].replace('unseen-story-qa-001-020','other-book');
 assert.match(assemble(a).stderr,/書籍ID/);
 const b=fixture();delete b[0].originalScans[7];assert.match(assemble(b).stderr,/原本画像/);
 const c=fixture();c[1]['s/next.json'].originals=[{scan:21,src:'data:image/png;base64,eA=='}];
 assert.match(assemble(c).stderr,/登録画像と違/);
});

test('custom book styling or ruby cannot be lost in a template conversion',()=>{
 const a=fixture();a[1]['s/first.html']='<style>.custom{font-size:30px}</style>'+a[1]['s/first.html'];
 assert.match(assemble(a).stderr,/個別の読書画面/);
 const b=fixture();b[1]['s/next.json'].blocks[1].glosses=[{base:'章',reading:'しょう'}];
 assert.match(assemble(b).stderr,/ルビ/);
});

test('a continuation cannot reorder a real chapter heading or another paragraph',()=>{
 for(const type of ['heading','body','toc']){
  const input=fixture();
  input[1]['s/next.json'].blocks.unshift({type,scan:21,text:'駅の構内'});
  input[1]['s/first.html']=input[1]['s/first.html'].replace('"to":[21,0]','"to":[21,1]');
  assert.match(assemble(input).stderr,/飛び越え/);
 }
});

test('the complete source presentation of the shipped image-only reader is accepted',()=>{
 const input=fixture(), m=input[0];
 m.template_profile='world_history_1';m.segments=[{part:'s/first.html',start:1,end:22}];
 const data={bookId:m.bookId,kind:'image',figures:[{scan:4,src:'21.png',caption:'駅の原図。'}]};
 const source=require('node:fs').readFileSync(path.resolve(__dirname,'../templates/reader/v2/image.html'),'utf8');
 input[1]['s/first.html']=source.replace(/<script>window\.READER_BOOK=.*?<\/script>/s,'<script>window.READER_BOOK='+JSON.stringify(data)+';</script>');
 const res=assemble(input);assert.equal(res.status,0,res.stderr);
 const {book,standardEngine}=JSON.parse(res.stdout);
 assert.ok(standardEngine);assert.equal(book.kind,'image');
 assert.equal(book.figures[0].caption,'駅の原図。');
});
