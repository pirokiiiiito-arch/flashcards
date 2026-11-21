// Only fingerprints and measured evidence are public. Book bytes and catalogues stay private.
const hex = /^[0-9a-f]{64}$/;
export const BLOCK = 4 * 1024 * 1024;
const utf8 = new TextEncoder();
const signatures = new WeakMap();
const ledgerURL = new URL('../quality/shelf-registration.json', import.meta.url);
const legacyFingerprint = 'd290fbd1c219e3028354b8d0e3d8eb9a6c206ee3725028c020cc8917dbf2c2ff';
const denied = () => new Error('この版は本棚の登録前検査を通っていません。現在保存されている版は引き続き読めます。');
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function bytesToHex(bytes) { return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join(''); }
async function digest(bytes) { return bytesToHex(await crypto.subtle.digest('SHA-256', bytes)); }
export const textHash = text => digest(utf8.encode(text));
export function entryIdentity(b) {
  return JSON.stringify(['shelf-entry-v1', b.id, b.title, b.subtitle || '', b.status || '', b.scans || 0, b.parts.map(p => [p.id, p.size])]);
}
export async function blobRoot(blob) {
  if (signatures.has(blob)) return signatures.get(blob);
  const result = (async () => {
    const digests = new Uint8Array(Math.ceil(blob.size / BLOCK) * 32);
    for (let start = 0; start < blob.size; start += BLOCK) {
      const bytes = await blob.slice(start, start + BLOCK).arrayBuffer();
      digests.set(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), start / BLOCK * 32);
    }
    return digest(digests);
  })();
  signatures.set(blob, result);
  try { return await result; } catch (error) { signatures.delete(blob); throw error; }
}
const positive = n => Number.isSafeInteger(n) && n > 0;
function baseRecord(r) {
  return r && ['key','entry','sha256','chunkRoot'].every(k => hex.test(r[k])) && positive(r.bytes);
}
// These editions were signed and admitted before page-turn evidence was introduced.
const previousSignatures = new Set([
  '/BZQATy1RVm29fcrP4wgxgjNNm+k2qKoMLbjjt8H2mpB3AzucWhl1FX2lFc2ln5bSnNsDkNXHPIUocPIiMJQ5w==',
  'SmZuQROqur7JtfESZGVh8n1V6iyedI74wwf/+hIgdriPD3UL/zCUEKOz3NFHh/cxix5E73D3JeByBV22JBjjlQ=='
]);
function validatePageTurns(record) {
  const {pageTurns: t, batches} = record.evidence;
  if (t === undefined && previousSignatures.has(record.signature)) return;
  requireValue(t?.version === 1 && hex.test(t.report) && Array.isArray(t.boundaries) &&
    t.boundaries.length === batches.length - 1, '全分冊境界の描画検査記録が必要です');
  for (const [i, row] of t.boundaries.entries()) {
    requireValue(Array.isArray(row) && row.length === 3 && row[0] === batches[i][1] &&
      row[1] === batches[i+1][0] && ['segment','within-document','shared-page'].includes(row[2]),
      '元分冊境界の往復検査に欠落または重複があります');
  }
  requireValue(positive(t.sectionCount) && Array.isArray(t.sections) &&
    t.sections.length === t.sectionCount - 1 &&
    t.sections.every((row,i) => Array.isArray(row) && row.length === 2 && row[0] === i && row[1] === i+1),
    '表示区間の境界がすべて検査されていません');
}
export function validateEvidence(r) {
  const e = r.evidence;
  requireValue(baseRecord(r) && ['preview','release'].includes(r.channel) && e?.version === 1 &&
    e.archive === r.sha256 && [e.source,e.host,e.report].every(s => hex.test(s)) &&
    positive(e.first) && positive(e.last) && e.last >= e.first && Array.isArray(e.batches) && e.batches.length,
    '書籍と一致する操作検査記録が必要です');
  let first = e.first;
  const modes = new Set();
  for (const batch of e.batches) {
    requireValue(Array.isArray(batch) && batch.length === 3, '分冊の検査記録が不正です');
    const [start,end,cases] = batch;
    requireValue(start===first && positive(end) && end>=start && end-start<20 && Array.isArray(cases) && cases.length, '分冊範囲に未検査・重複があります');
    first=end+1;
    let reading=false;
    for (const c of cases) {
      // [mode, observed source scan, base, peak, panX, panY, return scale, page drift, next step, return step]
      requireValue(Array.isArray(c) && c.length===10 && ['text','figure','contents','original'].includes(c[0]) && Number.isInteger(c[1]) && c[1]>=start && c[1]<=end &&
        c.slice(2).every(Number.isFinite) && Math.abs(c[2]-1)<.05 && c[3]>1.1 && Math.abs(c[4])>1 && Math.abs(c[5])>1 && Math.abs(c[6]-1)<.05 && c[7]===0,
        'ピンチ・拡大中のパン・縮小の実測値が必要です');
      if(c[0]!=='original') {
        requireValue((c[8]===1 && c[9]===-1) || (e.singleScreen===true && e.first===e.last && c[8]===0 && c[9]===0),'上下スワイプの移動数が一致しません'); reading=true;
      }
      modes.add(c[0]);
    }
    requireValue(reading,'分冊の読書画面が未検査です');
  }
  requireValue(first===e.last+1 && Array.isArray(e.modes) && e.modes.length && e.modes.every(m=>modes.has(m)) && modes.size===new Set(e.modes).size,'操作画面または末尾の検査が欠けています');
  const t=e.toc;
  requireValue(t && Number.isInteger(t.rows) && t.rows>=0 && t.rows===t.landed && hex.test(t.reference) && hex.test(t.results) &&
    (t.rows ? t.kind==='source' && modes.has('contents') : t.kind==='source-absent' && !modes.has('contents')), '原本目次と実際の移動先の照合が必要です');
  validatePageTurns(r);
  return r;
}
const publicSPKI = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEIplDryA9HQEYXBj+RKvCmS9F7Plv8h/csCzjJ938ax3Z07ikPuA5+d80bYUAl2MUdh/zVVFRDsqfmVpz17K/YA==';
const unbase64 = value => Uint8Array.from(atob(value), c=>c.charCodeAt(0));
let publicKey;
function ordered(v) {
  if(Array.isArray(v))return v.map(ordered);
  if(v && typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])]));
  return v;
}
export function signingText(record) {
  const {signature,...body}=record;
  return JSON.stringify(['reader-shelf-approval-v1',ordered(body)]);
}
async function signed(record) {
  validateEvidence(record);
  requireValue(typeof record.signature==='string' && /^[A-Za-z0-9+/]{85}[AQgw]==$/.test(record.signature),'登録検査の署名がありません');
  publicKey ||= crypto.subtle.importKey('spki',unbase64(publicSPKI),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  requireValue(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},await publicKey,unbase64(record.signature),utf8.encode(signingText(record))),'登録検査の署名を確認できません');
}
export async function parseLedger(data) {
  requireValue(data?.schema==='shelf-registration-v1' && Array.isArray(data.existing) && Array.isArray(data.editions) && Array.isArray(data.pending), '本棚登録台帳が不正です');
  requireValue(await textHash(JSON.stringify(data.existing))===legacyFingerprint, '引き継ぎ版の内容が違います');
  const active = new Map();
  for (const r of data.existing) {
    requireValue(baseRecord(r) && !active.has(r.key),'引き継ぎ版の記録が不正です');active.set(r.key,[r]);
  }
  const updated=new Set();
  for (const r of data.editions) {
    await signed(r);requireValue(!updated.has(r.key),'同じ本の現行版が重複しています');updated.add(r.key);active.set(r.key,[r]);
  }
  const staged=new Set();
  for (const r of data.pending) {
    await signed(r);requireValue(!staged.has(r.key),'登録候補が重複しています');staged.add(r.key);
    active.set(r.key,[...(active.get(r.key)||[]),r]);
  }
  return active;
}
let loading;
export async function ledger(refresh=false) {
  if (refresh || !loading) loading=fetch(ledgerURL, {cache:'no-cache'}).then(r=>{
    requireValue(r.ok,'本棚登録台帳を取得できません');return r.json();
  }).then(parseLedger).catch(err=>{loading=null;throw err;});
  return loading;
}
export async function admitEntry(book, active) {
  const records=active.get(await textHash(book.id)) || [];
  const identity=await textHash(entryIdentity(book));
  return [...records].reverse().find(r=>r.bytes===book.totalBytes && r.entry===identity) || null;
}
export async function admitBlob(book, blob, active) {
  const options=book.parts?.length ? [await admitEntry(book,active)] : (active.get(await textHash(book.id)) || []);
  const sized=options.filter(r=>r && r.bytes===blob.size);
  if(!sized.length)throw denied();
  const root=await blobRoot(blob),rec=sized.find(r=>r.chunkRoot===root);
  if(!rec)throw denied();
  return rec;
}
