/* Local Chrome, synthetic Google only. Exercise failures omitted by normal boot tests. */
'use strict';
const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');
let suite=fs.readFileSync('tests/browser-auth-only-ui.cjs','utf8');
function once(text,a,b){if(text.split(a).length!==2)throw Error('Auth-entry test anchor changed: '+a.slice(0,120));return text.replace(a,b);}
const extension=String.raw`
// Preserve all original login/photo/cache tests but correct the old offline UI expectation.
s=replace(s,",true,'offline viewing does not nag for auth'",",false,'offline hint preserves authentication entry'");
// A stale quiet-sync module does not invoke the new authentication UI at all.
// The reconnect button must still appear through the independent bootstrap.
s=replace(s,"fs.createReadStream(file).pipe(res);",String.raw\`if(file.endsWith(path.sep+'study-quiet-sync.js')){
 let body=fs.readFileSync(file,'utf8');
 body=body.replace('root.AuthOnlySync.attach(api,{app,readonly:!!options.readonly});','/* simulate old UI: no attach callback */');
 body=body.replace('root.AuthOnlySync?.refresh(api);','/* simulate old UI: no status callback */');
 res.end(body);return;
}fs.createReadStream(file).pipe(res);\`);
s=replace(s,"  if(!legacy){",String.raw\`  await until(()=>evaluate("!!document.getElementById('"+app+"AuthRequired')"),'independent reconnect control');
  assert.equal(await evaluate("document.getElementById('authStartupFallback').hidden"),true,'fallback hands off without duplicates');
  if(!legacy){\`);
run('viewers-independent-entry',s);
// Complete loss of the UI script and viewer adapter still leaves a static usable control.
let broken=fs.readFileSync('tests/browser-name-retention.cjs','utf8');
broken=replace(broken,"origin+'/flashcards/'+app+'/saved-view.html'","origin+'/flashcards/'+app+'/photo-view.html'");
broken=replace(broken,"'.html':'text/html; charset=utf-8'","'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8'");
broken=replace(broken,"fs.createReadStream(file).pipe(res);","if(file.endsWith(path.sep+'auth-only-ui.js')||file.endsWith(path.sep+'local-adapter.js')){res.end('/* simulate unavailable script */');return;}fs.createReadStream(file).pipe(res);");
broken=replace(broken,"  const api=app==='plants'?'PlantDriveSync':'ColorDriveSync';",String.raw\`  const fallback=await evaluate("(()=>{const n=document.getElementById('authStartupFallback'),b=n?.querySelector('button');return {present:!!b,hidden:n?.hidden,display:n?getComputedStyle(n).display:'none',disabled:b?.disabled};})()");
  assert.equal(fallback.present,true);assert.equal(fallback.hidden,false);assert.notEqual(fallback.display,'none');assert.equal(fallback.disabled,false);
  assert.deepEqual(await evaluate('__driveRequests'),[],'no automatic authentication or network request');
  console.log('PASS missing-script recovery control:',app);return;
  const api=app==='plants'?'PlantDriveSync':'ColorDriveSync';\`);
broken=replace(broken,"(async()=>{await scenario('plants');await scenario('colors');await scenario('plants',{cacheOnly:true});await scenario('plants',{legacy:true});await scenario('colors',{legacy:true});})()","(async()=>{await scenario('plants');await scenario('colors');})()");
run('missing-scripts',broken);
`;
// Construct the nested template literals without relying on global lexical bindings.
suite=once(suite,"run('viewers',s);",extension.replaceAll('\\`','`'));
const m=new Module(path.resolve('tests/.auth-entry-generated.cjs'),module);m.filename=path.resolve('tests/.auth-entry-generated.cjs');m.paths=module.paths;m._compile(suite,m.filename);
