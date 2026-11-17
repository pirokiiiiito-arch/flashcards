#!/usr/bin/env node
'use strict';
// Private book handoff guard: NEVER prints or uploads source images/OCR.
// A structural PASS is not a source proofreading, published-URL check, or iPhone certification.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const isHash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);

function validateDateTime(name) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})_/.exec(name);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === mo &&
    dt.getUTCDate() === d && dt.getUTCHours() === h && dt.getUTCMinutes() === mi;
}
function extract(html) {
  const m = html.match(/<script\b(?=[^>]*\bid=["']embedded-data["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!m) throw Error('EMBEDDED_DATA_MISSING');
  try { return JSON.parse(m[1]); } catch (_) { throw Error('EMBEDDED_DATA_INVALID_JSON'); }
}
function inspect(file, options = {}) {
  const errors = [], warnings = [];
  const fail = (condition, msg) => { if (!condition) errors.push(msg); };
  const filename = path.basename(file), mode = options.mode || 'preview';
  const start = Number(options.start), end = Number(options.end);
  fail(validateDateTime(filename), 'FILENAME_MISSING_VALID_YYYYMMDD_HHMM');
  fail(/^\d{8}_\d{4}_/.test(filename) &&
    filename.includes(String(start).padStart(3,'0')+'-'+String(end).padStart(3,'0')), 'FILENAME_RANGE_MISMATCH');
  fail(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 &&
    end >= start && end - start < 200, 'INVALID_EXPECTED_RANGE');
  fail(typeof options.bookId === 'string' && options.bookId.length > 2, 'EXPECTED_BOOK_ID_REQUIRED');
  fail(['preview','production'].includes(mode), 'INVALID_MODE');
  let bytes, html, d;
  try { bytes=fs.readFileSync(file); html=bytes.toString('utf8'); }
  catch(e) { errors.push('FILE_UNREADABLE_'+e.code); }
  const artifactSha256 = bytes ? hash(bytes) : null;
  if (options.expectedSha) fail(isHash(options.expectedSha) &&
    artifactSha256===options.expectedSha, 'ARTIFACT_SHA256_MISMATCH');
  else warnings.push('EXPECTED_ARTIFACT_SHA_NOT_PINNED');
  if (html) {
    try { d=extract(html); } catch(e) { errors.push(e.message); }
    fail(/<meta\s+name=["']viewport["']/i.test(html), 'VIEWPORT_META_MISSING');
    fail(/<meta\s+name=["']template-profile["']\s+content=["']novel["']/i.test(html) ||
      options.profile!=='novel', 'NOVEL_TEMPLATE_PROFILE_MISMATCH');
    fail(/reader-ready-v8/.test(html) && /reader-position-v1/.test(html), 'CHROME_HOST_PROTOCOL_MISSING');
    fail(/novel-reading/.test(html), 'NOVEL_READER_STYLE_MISSING');
  }
  let sourceImageBytes=0;
  if (d) {
    fail(d.bookId===options.bookId, 'BOOK_ID_MISMATCH');
    fail(d.title===options.title || !options.title, 'BOOK_TITLE_MISMATCH');
    fail(Array.isArray(d.range) && d.range[0]===start && d.range[1]===end, 'EMBEDDED_RANGE_MISMATCH');
    fail(d.imageCount===end-start+1, 'IMAGE_COUNT_MISMATCH');
    fail(Array.isArray(d.pages) && d.pages.length===end-start+1, 'PAGE_COUNT_MISMATCH');
    const seen=new Set(), pages=Array.isArray(d.pages) ? d.pages : [];
    pages.forEach((page,i)=>{
      const idx = start+i;
      fail(page && page.scan===idx, 'SCAN_SEQUENCE_MISMATCH_'+idx);
      if(!page || typeof page.dataUrl!=='string') {
        errors.push('ORIGINAL_IMAGE_MISSING_'+idx);return;
      }
      const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(page.dataUrl);
      if(!m) { errors.push('ORIGINAL_IMAGE_DATA_INVALID_'+idx);return; }
      const raw=Buffer.from(m[2], 'base64');sourceImageBytes+=raw.length;
      fail(raw.toString('base64')===m[2], 'ORIGINAL_IMAGE_BAD_BASE64_'+idx);
      fail(page.mimeType===m[1], 'ORIGINAL_IMAGE_MIME_MISMATCH_'+idx);
      fail(isHash(page.sha256) && page.sha256===hash(raw), 'ORIGINAL_IMAGE_SHA_MISMATCH_'+idx);
      fail(Number.isInteger(page.width)&&page.width>0&&Number.isInteger(page.height)&&page.height>0,
        'ORIGINAL_IMAGE_DIMENSIONS_MISSING_'+idx);
      if(seen.has(page.sha256))errors.push('DUPLICATE_ORIGINAL_IMAGE_'+idx);
      seen.add(page.sha256);
    });
    const second=d.proofreading?.independentSecondPass || 'not_run';
    const device=d.proofreading?.iphoneDevice || 'not_run';
    if(mode==='production') fail(second==='passed', 'PRODUCTION_SECOND_PROOFREADING_NOT_PASSED');
    if(second!=='passed') warnings.push('SECOND_PROOFREADING_NOT_PASSED');
    if(device!=='passed') warnings.push('IPHONE_REAL_DEVICE_NOT_VERIFIED');
    if(/完成版|全文字照合済/.test(d.state||'') && second!=='passed')errors.push('UNSUPPORTED_COMPLETION_CLAIM');
  }
  const chromeUrl=options.chromeUrl||null;
  if(chromeUrl) {
    try {
      const u=new URL(chromeUrl);
      fail(u.origin==='https://pirokiiiiito-arch.github.io' &&
        u.pathname==='/flashcards/reader/nine-stories/021-040/' &&
        u.searchParams.get('import')==='1', 'WRONG_CHROME_IMPORT_URL');
    } catch(_) { errors.push('BAD_CHROME_IMPORT_URL'); }
  }
  const status=errors.length?'blocked':'structural_pass_only';
  return {schema:'reader-handoff-check-v1', status, bookId:d?.bookId||null, range:d?.range||null,
    artifactFile:filename, artifactBytes:bytes?.length||null, artifactSha256,
    originalImageCount:d?.pages?.length||0, originalImageBytes:sourceImageBytes,
    expectedShaMatched:!!options.expectedSha && artifactSha256===options.expectedSha,
    profile:options.profile||null, mode, chromeUrl,
    chromeImport:'not_run', publicHTTP:'not_run',
    independentProofreading:d?.proofreading?.independentSecondPass||'not_run',
    iphoneDevice:d?.proofreading?.iphoneDevice||'not_run',
    deliveredAndVerified:false, contentCertified:false, releaseEligible:false,
    errors, warnings};
}
function main(args){
  const opts={};let file=null;
  for(let i=0;i<args.length;i++) {
    const a=args[i]; if(a==='--file')file=args[++i];
    else if(a==='--book')opts.bookId=args[++i];
    else if(a==='--title')opts.title=args[++i];
    else if(a==='--range'){
      let m=/^(\d+)-(\d+)$/.exec(args[++i]||'');
      if(!m)throw Error('INVALID_RANGE');
      opts.start=Number(m[1]);opts.end=Number(m[2]);
    }
    else if(a==='--mode')opts.mode=args[++i];
    else if(a==='--profile')opts.profile=args[++i];
    else if(a==='--expected-sha')opts.expectedSha=args[++i];
    else if(a==='--chrome-url')opts.chromeUrl=args[++i];
    else if(a==='--report')opts.report=args[++i];
    else throw Error('UNKNOWN_OPTION '+a);
  }
  if(!file)throw Error('Usage: reader-handoff-check.cjs --file HTML --book BOOK_ID --range START-END [--title TITLE] [--profile novel] [--mode preview|production] [--expected-sha SHA256] [--chrome-url HTTPS] [--report FILE]');
  const result=inspect(file,opts);const body=JSON.stringify(result,null,2)+'\n';
  if(opts.report) {
    fs.mkdirSync(path.dirname(path.resolve(opts.report)),{recursive:true});
    fs.writeFileSync(opts.report,body);
  }
  process.stdout.write(body);if(result.errors.length)process.exitCode=1;
}
if(require.main===module){
  try{main(process.argv.slice(2));}
  catch(e){console.error('HANDOFF_BLOCKED '+e.message);process.exitCode=2;}
}
module.exports={inspect,extract,validateDateTime};
