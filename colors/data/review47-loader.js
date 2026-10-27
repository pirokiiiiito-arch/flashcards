/* Loads the exact review47 source (1000 cards, all 217 verified origin texts,
 * 1047 photo placements, 107 suppressed duplicates). No private photographs here. */
(async function(){
  'use strict';
  const hint=document.createElement('div');
  hint.id='colorRestoreLoadStatus';
  hint.setAttribute('role','status');
  hint.style.cssText='position:fixed;bottom:12px;left:12px;z-index:99;background:#fff;color:#263344;border:1px solid #ccd3dc;border-radius:8px;padding:8px 12px;font:13px system-ui;max-width:90vw';
  hint.textContent='元の1000色データを読み込んでいます…';
  document.body.appendChild(hint);
  const sha256=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const script=src=>new Promise((resolve,reject)=>{
    const node=document.createElement('script');
    node.src=src;node.async=false;
    node.onload=resolve;
    node.onerror=()=>reject(new Error('読み込み失敗: '+src));
    document.body.appendChild(node);
  });
  try{
    if(typeof DecompressionStream!=='function') throw Error('このブラウザは圧縮データの読み込みに未対応です。ブラウザを更新してください。');
    const resp=await fetch('./data/review47-progress.b64?v=1',{cache:'no-cache'});
    if(!resp.ok)throw Error('元の由来・写真台帳を取得できません（HTTP '+resp.status+'）。');
    const text=(await resp.text()).replace(/\s+/g,'');
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(text))throw Error('元データの符号化が不正です。');
    const bytes=Uint8Array.from(atob(text),c=>c.charCodeAt(0));
    const json=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    if(await sha256(new TextEncoder().encode(json))!=='a7f787d7f68fe6071f4c67d369bb1539d8c28724b3d070f78a5b635d7e14b242')
      throw Error('元データのSHA-256が一致しません。');
    const data=JSON.parse(json);
    if(!Array.isArray(data.cards)||data.cards.length!==1000||data.cards.filter(c=>!!c.research?.origin_display_text).length!==217)
      throw Error('元の色数・由来件数が一致しません。');
    // The original app was written as global scripts. These two globals preserve
    // those bindings without rewriting any source research or card identities.
    window.PROGRESS_BASE=data;
    window.RESEARCH_DATA=Object.fromEntries(data.cards.map(c=>[c.name,c.research]));
    hint.textContent='カードの機能を読み込んでいます…';
    for(const name of ['./app-main.js?v=1','./origin-editor.js?v=2','./manual-edit-compat.js',
      '../drive-config.js?v=3','../drive-core.js?v=6','./asset-migration.js?v=1',
      './drive-sync.js?v=13','./recovery-import.js?v=2','./nav-top.js?v=1']) await script(name);
    hint.remove();
  } catch(error){
    hint.textContent='1000色の復元データを読み込めません: '+(error?.message||String(error));
    hint.style.color='#a52c2c';
    console.error('1000色読み込みエラー',error);
  }
})();
