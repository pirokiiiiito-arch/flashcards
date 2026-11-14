'use strict';
// Synthetic host-navigation tests only. Do not infer OCR or real-iPhone acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const gate=require('../tools/reader-release-control.cjs');
const root=process.env.READER_AUDIT_ROOT||path.resolve(__dirname,'..');
const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json')));
const registry=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/registry.json')));
const paths=['01-20','21-40','41-60','61-80','81-100','101-120'].map(dir=>'reader/furniture/'+dir+'/index.html');
const blobSHA=text=>{const data=Buffer.from(text);return crypto.createHash('sha1').update('blob '+data.length+String.fromCharCode(0)).update(data).digest('hex');};
test('all six existing furniture host readers expose a persistent native bookshelf link',()=>{
 const approved=gate.admittedBookshelfNavUI(root,policy);
 assert.deepEqual(Object.keys(approved).sort(),paths.slice().sort());
 for(const p of paths){
  const html=fs.readFileSync(path.join(root,p),'utf8');
  assert.match(html,/<nav id="bookshelfNav" aria-label="読書ナビゲーション">/);
  assert.match(html,/<a id="backToBookshelf" href="\.\.\/\.\.\/library\/">◀ 本棚へ<\/a>/);
  assert.match(html,/#reader\{top:calc\(44px \+ env\(safe-area-inset-top\)\);bottom:0;height:auto\}/);
  assert.ok(html.indexOf('id="bookshelfNav"')<html.indexOf('<iframe id="reader"'),'link is outside private reader iframe');
  assert.equal(new URL('../../library/','https://pirokiiiiito-arch.github.io/flashcards/'+p.replace('index.html','')).pathname,'/flashcards/reader/library/');
 }
});
test('the navigation-only edit leaves all original loader bytes intact when removed',()=>{
 for(const p of paths){
  const html=fs.readFileSync(path.join(root,p),'utf8');
  const restored=html.replace(/\n<style id="bookshelf-nav-ui-v1">[\s\S]*?<\/style>\n(?=<\/head>)/,'')
   .replace(/\n<nav id="bookshelfNav"[^>]*>[\s\S]*?<\/nav>(?=\n<iframe)/,'');
  assert.notEqual(restored,html,'UI-only patch is present: '+p);
  assert.equal(blobSHA(restored),registry.legacyFrozenEntries[p],'exact historical loader recovered: '+p);
 }
});
test('unapproved navigation/reader changes fail the byte-level publication admission',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-bookshelf-nav-'));
 try{
  for(const p of paths){
   const target=path.join(tmp,p);fs.mkdirSync(path.dirname(target),{recursive:true});
   fs.copyFileSync(path.join(root,p),target);
  }
  const target=path.join(tmp,paths[0]);
  fs.appendFileSync(target,'\n<!-- unauthorized edit -->');
  assert.throws(()=>gate.admittedBookshelfNavUI(tmp,policy),/BOOKSHELF_NAV_UI_BYTES_NOT_REVIEWED/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
