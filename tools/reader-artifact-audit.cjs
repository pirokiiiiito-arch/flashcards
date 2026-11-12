#!/usr/bin/env node
'use strict';
// Local verification of an actual private book HTML. Never uploads source data.
const fs=require('node:fs');
const crypto=require('node:crypto');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function audit(html,start,end) {
 const errors=[],warnings=[],pages=[];
 const source=Buffer.isBuffer(html)?html:Buffer.from(html);
 const result={schema:'reader-artifact-audit-v1',sourceSha256:digest(source),
  structuralStatus:'failed',originals:0,OCRTextPages:0,wholePageProofed:0,scanCount:0,errors,warnings};
 const m=source.toString('utf8').match(/<script\b[^>]*id=["'](?:embedded-data|bookdata)["'][^>]*>([\s\S]*?)<\/script>/i);
 if(!m){errors.push('UNSUPPORTED_FORMAT: no structured embedded-data/bookdata JSON, not approved');return result;}
 let book;
 try{book=JSON.parse(m[1]);}catch(e){errors.push('BAD_BOOK_JSON: '+e.message);return result;}
 if(Array.isArray(book))book={pages:book};
 if(!book||!Array.isArray(book.pages)){errors.push('NO_STRUCTURED_PAGES');return result;}
 result.bookId=typeof book.bookId==='string'?book.bookId:'unverified';
 result.scanCount=book.pages.length;
 const first=Number.isInteger(start)?start:Number(book.range?.[0]??book.pages[0]?.scan);
 const last=Number.isInteger(end)?end:Number(book.range?.[1]??book.pages.at(-1)?.scan);
 if(!Number.isInteger(first)||!Number.isInteger(last)||last<first||last-first+1!==book.pages.length)
  errors.push('RANGE_OR_PAGE_COUNT_MISMATCH');
 const seen=new Set();
 for(let i=0;i<book.pages.length;i++){
  const p=book.pages[i]||{},scan=Number(p.scan),plain=[p.reading_text??p.ocr,...(p.blocks||[]).map(b=>b.text),...(p.boxed_articles||[]).map(b=>b.text),...(p.figures||[]).map(b=>b.caption)].some(t=>typeof t==='string'&&t.trim().length>0);
  const image=p.dataUrl??p.original,width=p.width??p.source_image_width,height=p.height??p.source_image_height;
  if(seen.has(scan)||scan!==first+i)errors.push('DUPLICATE_OR_OUT_OF_ORDER_SCAN '+String(scan));
  seen.add(scan);
  if(plain)result.OCRTextPages++;
  if(p.proofStatus==='passed')result.wholePageProofed++;
  if((p.pageType==='prose'||p.hasReadableProse==='yes'||p.has_readable_prose===true)&&!plain)
   errors.push('READABLE_PROSE_WITHOUT_TEXT '+String(scan));
  if(typeof image!=='string'||!/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/i.test(image)){
   errors.push('SOURCE_IMAGE_MISSING_OR_INVALID '+String(scan));continue;
  }
  const encoded=image.slice(image.indexOf(',')+1);
  const bytes=Buffer.from(encoded,'base64');
  if(!bytes.length||bytes.toString('base64')!==encoded){
   errors.push('INVALID_SOURCE_IMAGE_BASE64 '+String(scan));continue;
  }
  if(!/^[0-9a-f]{64}$/.test(p.sha256||'')||digest(bytes)!==p.sha256){
   errors.push('SOURCE_SHA256_MISMATCH '+String(scan));continue;
  }
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)
   errors.push('SOURCE_IMAGE_DIMENSIONS_MISSING '+String(scan));
  else result.originals++;
 }
 if(result.OCRTextPages===0){
  const allConfirmedNoText=book.pages.every(p=>p.hasReadableProse==='no'&&p.proofStatus==='passed');
  if(!allConfirmedNoText)errors.push('ZERO_OCR_TEXT: do not deliver an empty reader as a reading edition');
 }
 if(/読書用完成|全字校正済み|iPhone実機確認済み/.test(String(book.state||''))&&
    result.wholePageProofed!==result.scanCount)errors.push('FALSE_COMPLETION_LABEL');
 warnings.push('This does not verify Japanese OCR accuracy, figure layout, swipe, 24 device sizes, or real iPhone operation.');
 if(!errors.length)result.structuralStatus='passed';
 return result;
}
if(require.main===module){
 const [file,s,e]=process.argv.slice(2);
 if(!file){console.error('Usage: node tools/reader-artifact-audit.cjs <private-book.html> [start-scan] [end-scan]');process.exitCode=2;}
 else{
  try{
   const r=audit(fs.readFileSync(file),s?Number(s):undefined,e?Number(e):undefined);
   console.log(JSON.stringify(r,null,2));
   if(r.errors.length)process.exitCode=1;
  }catch(error){console.error('BLOCK: '+error.message);process.exitCode=1;}
 }
}
module.exports={audit};
