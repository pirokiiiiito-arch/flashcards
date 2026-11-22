'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const v=require('../tools/reader-release-control.cjs');
const pipe=require('../tools/reader-private-pipeline.cjs');
const audit=require('../tools/reader-source-pages.cjs');
const stages=require('../tools/reader-evidence-gate.cjs');
const pixel='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
const imageHash=v.hash(Buffer.from(pixel,'base64'));

function book(t,id,pageData){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'source-pages-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const pages=pageData.map((row,i)=>({scan:i+1,original:'data:image/png;base64,'+pixel,sha256:imageHash,...row}));
 const range=[1,pages.length],artifact=path.join(tmp,'input.html'),index=path.join(tmp,'index.json');
 fs.writeFileSync(artifact,'<script id="bookdata" type="application/json">'+JSON.stringify({bookId:id,range,pages})+'</script>');
 fs.writeFileSync(index,JSON.stringify(Object.fromEntries(pages.map(p=>[p.scan,p.sha256]))));
 const root=path.join(tmp,'private'),manifest=path.join(root,'manifest.json');
 const m=pipe.init(artifact,root,id,artifact,index);
 const fields=v.textFields(pages);
 const maps=pages.map(p=>({
  scan:p.scan,sourceSha256:p.sha256,firstPassId:'first',secondPassId:'blind',reviewedBy:'reader A',
  secondReviewer:'reader B',secondViewedFirst:false,edgesChecked:true,width:1,height:1,
  regions:Object.keys(v.textFields([p])).map(k=>({id:'r-'+k,kind:k.includes('/figures/')?'caption':'body',box:[0,0,1,1],fields:[k]}))
 }));
 const records={inventory:{pages:maps},second:{runId:'second-reading',method:'read original separately',reviewedBy:'reader B',viewedFirst:false,
   sourceIndexSha256:m.originalIndex.sha256,fields:{...fields}},resolutions:{openIssues:[],differences:[],numbers:[],alerts:[]}};
 function update(k,o){const rel='review/'+k+'-synthetic.json',data=JSON.stringify(o);fs.writeFileSync(path.join(root,rel),data);m[k]={path:rel,sha256:v.hash(data)};}
 function save(){for(const[k,obj] of Object.entries(records))update(k,obj);fs.writeFileSync(manifest,JSON.stringify(m));}
 save();
 return {m,pages,records,manifest,root,fields,save,update,work:()=>audit.fromManifest(manifest)};
}
const correction=(field,first,second,reading,region='r-'+field)=>({field,firstSha256:v.hash(first),secondSha256:v.hash(second),
 canonicalSha256:v.hash(reading),sourceSha256:imageHash,sourceReading:reading,regionId:region,reviewedBy:'reader C',reason:'Original reread at this text region',resolved:true});

test('all source numbers survive a new status, an early missing sentence and a later open issue',t=>{
 const x=book(t,'new-novel',Array.from({length:82},()=>({reading_text:'扉を閉じた。',proofStatus:'imported-state'})));
 delete x.records.second.fields['1/body'];
 x.records.second.fields['49/body']='鳥が鳴いた。扉を閉じた。';
 x.records.inventory.pages.splice(79,1);
 x.records.resolutions.openIssues.push({scan:82,status:'new-review-state'});x.save();
 const a=x.work();assert.equal(a.totalScans,82);assert.equal(a.matchedScans,78);
 assert.deepEqual(a.queue.map(q=>q.scan),[1,49,80,82]);
 const stage=stages.inspect(x.manifest,'prepare').stages[0];assert.equal(stage.decision,'blocked');assert.deepEqual(stage.sourceReview,a);
 x.update('previewAuthorization',{explicit:true,requestedBy:'synthetic',requestText:'preview of unfinished synthetic book',at:'2026-01-01T00:00:00Z',artifactSha256:x.m.artifact.sha256});x.save();
 const preview=v.validateBundle(x.manifest,{phase:'preview'});assert.equal(preview.eligible,true);assert.equal(preview.contentCertified,false);assert.deepEqual(preview.sourceReview,a);
});
test('a shorter blind reading cannot remove genuine text or borrow evidence from a sibling field or scan',t=>{
 const original='時計の針が止まった。窓を開けた。',shorter='窓を開けた。';
 const x=book(t,'another-novel',[{reading_text:original,title:'時計'},{reading_text:'空は晴れた。'}]);
 const key='1/body',diff=x.records.resolutions.differences;
 x.records.second.fields[key]=shorter;
 for(const invalid of [correction(key,original,shorter,original,'r-2/body'),correction(key,original,shorter,original,'r-1/title'),
  {...correction(key,original,shorter,original),sourceSha256:v.hash('other image')},{...correction(key,original,shorter,original),sourceReading:shorter}]){
  diff.splice(0,diff.length,invalid);x.save();assert.deepEqual(x.work().queue.map(q=>q.scan),[1]);
 }
 diff.splice(0,diff.length,correction(key,original,shorter,original));x.save();assert.equal(x.work().matchedScans,2);
 assert.equal(v.extract(v.bytes(x.root,x.m.artifact)).pages[0].reading_text,original);
});
test('copying the shorter second pass into the actual book still requires a source decision against the frozen first pass',t=>{
 const original='霧が消えた。鳥が鳴いた。',shorter='鳥が鳴いた。',key='1/body';
 const x=book(t,'revised-novel',[{reading_text:original}]);
 x.records.second.fields[key]=shorter;x.save();
 const file=path.join(x.root,'event.json');
 fs.writeFileSync(file,JSON.stringify({scan:1,expectedCanonicalSha256:x.m.canonical.sha256,before:original,after:shorter,pointer:'reading_text',
  reason:'Synthetic disagreement',actor:'reader A',at:'2026-01-01T00:00:00Z',sourceRegion:'r-1/body'}));
 pipe.correct(x.manifest,file);pipe.build(x.manifest);
 Object.assign(x.m,JSON.parse(fs.readFileSync(x.manifest)));
 assert.equal(x.work().queue[0].issues[0].reason,'UNRESOLVED_SECOND_PASS');
 x.records.resolutions.differences=[correction(key,shorter,shorter,shorter)];x.save();assert.equal(x.work().pendingScans,1);
 x.records.resolutions.differences=[correction(key,original,shorter,shorter)];x.save();assert.equal(x.work().pendingScans,0);
});
test('illustrated pages keep caption readings distinct from photographs and true blank pages',t=>{
 const x=book(t,'new-illustrated-history',[{reading_text:'地図を開く。',figures:[{caption:'青い橋'}]},{},{}]);
 const [map,blank,photo]=x.records.inventory.pages;
 photo.regions=[{id:'photo',kind:'photo',box:[0,0,1,1],reason:'An uncaptioned photograph'}];
 x.records.second.fields['1/figures/0/caption']='赤い橋';
 x.records.resolutions.differences=[correction('1/figures/0/caption','青い橋','赤い橋','青い橋',map.regions[0].id)];
 x.save();assert.deepEqual(x.work().queue.map(q=>q.scan),[1,2]);
 blank.blankPage=true;blank.hasReadableText=false;
 x.records.resolutions.differences[0].regionId='r-1/figures/0/caption';x.save();assert.equal(x.work().matchedScans,3);
 photo.blankPage=true;x.save();assert.deepEqual(x.work().queue.map(q=>q.scan),[3]);
});
test('numerals, alerts, edits and extra fields are tied to the owning scan and textual field',t=>{
 const x=book(t,'reference-history',[{reading_text:'三枚。',title:'地図'},{reading_text:'AB'}]);
 x.records.resolutions.numbers=[{field:'1/body',offset:0,text:'三',reviewedBy:'reader',regionId:'r-1/title'}];
 x.records.resolutions.alerts=v.anomalies(x.fields).map(a=>({id:a.id,decision:'source_confirmed',reviewedBy:'reader',reason:'A label on the scan',regionId:'r-1/body'}));
 x.records.second.fields['2/omitted']='欄外に文字';x.save();assert.deepEqual(x.work().queue.map(q=>q.scan),[1,2]);
 x.records.resolutions.numbers[0].regionId='r-1/body';x.records.resolutions.alerts[0].regionId='r-2/body';delete x.records.second.fields['2/omitted'];
 x.save();assert.equal(x.work().pendingScans,0);
});
test('scope, source bytes and duplicate inventories cannot validate another version',t=>{
 const x=book(t,'identity-check',[{reading_text:'春。'},{reading_text:'秋。'}]);
 x.records.inventory.pages.push({...x.records.inventory.pages[0],regions:[]});x.save();assert.deepEqual(x.work().queue.map(q=>q.scan),[1]);
 assert.throws(()=>audit.fromManifest(x.manifest,{bookId:'identity-check',scanRange:[1,82]}),/REQUESTED_RANGE_MISMATCH|REQUESTED_SCAN_RANGE_MISMATCH/);
 x.m.bookId='other-book';x.save();assert.throws(x.work,/IDENTITY_MISMATCH/);
 x.m.bookId='identity-check';x.m.originalIndex.sha256=v.hash('wrong');x.save();assert.throws(x.work,/FILE_CHANGED/);
});

test('an imported open finding stays open when the old label changes and both new texts match',t=>{
 const review={status:'older label',pending:1,extraPending:1};
 const x=book(t,'imported-history',[{reading_text:'星と月。',allScanReview:review,proofStatus:'new label'},{reading_text:'夜明け。'}]);
 assert.equal(x.work().pendingImportedFindings,2);assert.deepEqual(x.work().queue.map(q=>q.scan),[1]);
 const d={scan:1,group:'pending',ordinal:1,priorReviewSha256:v.objHash(review),field:'1/body',regionId:'r-1/body',
  sourceSha256:imageHash,canonicalSha256:v.hash('星と月。'),sourceReading:'月',offset:2,reviewedBy:'reader C',reason:'Character checked at source',resolved:true};
 x.records.resolutions.carriedIssues=[d,{...d}];x.save();assert.equal(x.work().pendingImportedFindings,1);
 x.records.resolutions.carriedIssues.push({...d,group:'extraPending',offset:1});x.save();assert.equal(x.work().pendingImportedFindings,1);
 x.records.resolutions.carriedIssues.push({...d,group:'extraPending',sourceReading:'星',offset:0});x.save();assert.equal(x.work().pendingImportedFindings,0);
});

test('ruby readings and notes have their own source fields in an illustrated book',t=>{
 const x=book(t,'ruby-and-notes',[{reading_text:'星。',ruby:[{base:'星',reading:'ほし'}],notes:[{text:'図の右下。'}]}]);
 x.records.second.fields['1/ruby/0/reading']='ほじ';delete x.records.second.fields['1/notes/0/text'];x.save();
 assert.deepEqual(x.work().queue[0].issues.map(i=>i.field).sort(),['1/notes/0/text','1/ruby/0/reading']);
});

test('two readings of the same base remain separate original-source fields',t=>{
 const x=book(t,'source-ruby',[{blocks:[{text:'空、空。',ruby:[
  {start:0,end:1,base:'空',reading:'そら'},{start:2,end:3,base:'空',reading:'から'}
 ]}]}]);
 assert.equal(x.fields['1/blocks/0'],'空、空。');
 x.records.second.fields['1/blocks/0/ruby/1/reading']='そら';x.save();
 assert.deepEqual(x.work().queue[0].issues.map(i=>i.field),['1/blocks/0/ruby/1/reading']);
});

test('production and preview heading observations detect old prose before a story start at any font size',t=>{
 const x=book(t,'novel-geometry',[{reading_text:'前話。'},{title:'朝の駅',reading_text:'鳥が鳴く。'}]);
 x.records.inventory.pages[1].regions.find(r=>r.fields.includes('2/title')).kind='heading';x.save();
 const scoped=require('../tools/reader-scoped-review.cjs');
 const plan=scoped.conditionPlan(),display={};
 const observations={schema:'reader-heading-dom-observations-v1',collector:'heading-dom-probe-v1',html_sha256:x.m.artifact.sha256,
  conditions:plan.map(c=>({...c,completed:true,page_count:2,visited_pages:[0,1],errors:[],
   fragments:[{source_heading_id:'station',page_index:1,dom_index:0,start:0,end:3,text:'朝の駅',visible:true}],
   body_anchors:[{page_index:0,dom_index:0,visible:true,body_id:'old'},{page_index:1,dom_index:1,visible:true,body_id:'new'}]}))};
 const check=()=>scoped.verifyNovelStarts(x.root,x.m,x.pages,{templateProfile:'novel'},'',display,x.fields);
 const use=()=>{x.update('obs',observations);display.headingObservations=x.m.obs;};
 assert.throws(check,/NOVEL_HEADING_OBSERVATIONS_REQUIRED/);use();assert.doesNotThrow(check);
 observations.conditions[11].fragments[0].dom_index=1;use();assert.throws(check,/NOVEL_HEADING_MUST_START_PAGE/);
 observations.conditions[11].fragments[0].dom_index=0;observations.conditions[0].visited_pages=[1];use();assert.throws(check,/NOVEL_HEADING_CONDITION_INCOMPLETE/);
 assert.doesNotThrow(()=>scoped.verifyNovelStarts(x.root,x.m,x.pages,{templateProfile:'world_history_1'},'',{},x.fields));
});
