#!/usr/bin/env node
'use strict';
// Synchronize the layout code before building a book, then verify the shipped renderer.
const fs=require('node:fs'),path=require('node:path');
const {count}=require('../templates/reader/v2/vertical-symbols.js');
const source=fs.readFileSync(path.join(__dirname,'../templates/reader/v2/vertical-symbols.js'),'utf8');
const start='// BEGIN reader vertical symbols',end='// END reader vertical symbols';
const region=new RegExp('^'+start+'$[\\s\\S]*?^'+end+'$','gm');
const canonical=source.match(region)[0];
const legacy=/^\/\/ Both forms of the question mark stand upright in Japanese vertical text\.\nfunction setVerticalText\(element, text\)\{[\s\S]*?^\}\n(?=function partNode\(p\)\{)/m;
const partText="text:b.units.slice(off,off+n).join(''),";
const partEdges="before:b.units.slice(Math.max(0,off-3),off).join('').slice(-3),after:b.units.slice(off+n,off+n+3).join('').slice(0,3),";
function syncEngine(engine){
 const matches=engine.match(region)||[];
 if(matches.length>1)throw Error('multiple vertical-symbol implementations');
 if(matches.length===1)engine=engine.replace(region,()=>canonical);
 else if(legacy.test(engine))engine=engine.replace(legacy,()=>canonical+'\n');
 else if(!engine.includes('function setVerticalText(')&&engine.split('function partNode(p){').length===2&&engine.split('el.textContent=p.text;').length===2){
  engine=engine.replace('function partNode(p){',()=>canonical+'\nfunction partNode(p){')
   .replace('el.textContent=p.text;','setVerticalText(el,p.text);')
   .replace(/title\.textContent=(m\[3\](?:\+\(m\[4\]\|\|''\))?);/,'setVerticalText(title,$1);');
 }else throw Error('reader layout source is unrecognized; update the vertical text renderer at its source');
 // Each measurement trial and displayed page may contain only part of a numeral.
 // Carry the original adjacent graphemes into both versions of the standard reader.
 if(!engine.includes(partEdges)){
  if(engine.split(partText).length!==2)throw Error('unrecognized source text fragment; supply its original neighbouring characters');
  engine=engine.replace(partText,partText+'\n  '+partEdges);
 }
 return engine.replace('setVerticalText(el,p.text);','setVerticalText(el,p.text,p);');
}
function checkEngine(engine){
 const blocks=engine.match(region)||[];
 if(blocks.length!==1||blocks[0]!==canonical)throw Error('vertical-symbol rendering code differs from the common rule');
 const part=engine.match(/function partNode\(p\)\{([\s\S]*?)\n\}/)?.[1];
 if(!engine.includes(partEdges)||!part||!part.includes('setVerticalText(el,p.text,p)')||(part.includes('novel-toc-title')&&!part.includes('setVerticalText(title,')))throw Error('vertical paragraph, heading or contents title is not connected');
 if(!/function fitsParts[\s\S]*?fragment\.append\(partNode\(p\)\)/.test(engine)||!/for\(const part of p\.parts\)frag\.append\(partNode\(part\)\)/.test(engine))throw Error('measurement and display do not share the vertical renderer');
}
function checkFile(file){
 const content=fs.readFileSync(file,'utf8');
 if(!/\.html?$/i.test(file)){checkEngine(content);return {renderer:'source'};}
 const scripts=Array.from(content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi));
 const engines=[];
 for(const [,attrs,body] of scripts){
  const type=attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
  if(type&&!['module','text/javascript','application/javascript'].includes(type.toLowerCase()))continue;
  const src=attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  if(src){
   if(!/(?:^|\/)(novel|standard)\.js(?:[?#].*)?$/.test(src))continue;
   if(/^(?:[a-z]+:|\/)/i.test(src))throw Error('verify against local pinned renderer assets');
   engines.push(fs.readFileSync(path.resolve(path.dirname(file),src.split(/[?#]/)[0]),'utf8'));
  }else if(body.includes('function partNode(p){'))engines.push(body);
 }
 if(engines.length!==1)throw Error('expected exactly one active vertical reader');
 checkEngine(engines[0]);
 const embedded=scripts.find(s=>/\bid\s*=\s*["']embedded-data["']/i.test(s[1]));
 if(!embedded)return {renderer:'linked or inline template'};
 const data=JSON.parse(embedded[2]);
 if(!Array.isArray(data.pages))throw Error('embedded pages unavailable');
 let upright=0,native=0,sourceHalfwidthDigits=0,sourceHalfwidthQuestions=0,sourceFullwidthQuestions=0;
 for(const page of data.pages)for(const block of page.blocks||[]){
  if(typeof block.text!=='string')throw Error('missing source text on scan '+page.scan);
  const measured=count(block.text);upright+=measured.upright;native+=measured.native;
  sourceHalfwidthDigits+=(block.text.match(/[0-9]/g)||[]).length;
  sourceHalfwidthQuestions+=(block.text.match(/\?/g)||[]).length;
  sourceFullwidthQuestions+=(block.text.match(/？/g)||[]).length;
 }
 return {renderer:'embedded book',pages:data.pages.length,upright,native,sourceHalfwidthDigits,sourceHalfwidthQuestions,sourceFullwidthQuestions,
  expectedFullwidthQuestions:sourceHalfwidthQuestions+sourceFullwidthQuestions};
}
function main(args){
 const [command,...files]=args;
 if(!['apply','check'].includes(command)||!files.length){
  console.error('Usage: node tools/reader-vertical-symbols.cjs apply <reader.js>... | check <reader.js|book.html>...');return 2;
 }
 let failed=false;
 for(const file of files){
  try{
   if(command==='apply'){
    if(!/\.js$/i.test(file))throw Error('apply to a reader JS source, then rebuild its book');
    const before=fs.readFileSync(file,'utf8'),after=syncEngine(before);checkEngine(after);
    if(after!==before)fs.writeFileSync(file,after);
   }
   console.log(JSON.stringify({file,status:'ok',...checkFile(file)}));
  }catch(e){failed=true;console.error(JSON.stringify({file,status:'error',reason:e.message}));}
 }
 return failed?1:0;
}
if(require.main===module)process.exitCode=main(process.argv.slice(2));
module.exports={checkEngine,checkFile,syncEngine};
