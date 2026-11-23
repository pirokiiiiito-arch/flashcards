// Run inside the mounted, paginated StandardReader or NovelReader document.
async scan => {
  const reader = window.StandardReader || window.NovelReader;
  if (!reader) throw Error('読書テンプレートを特定できません');
  const graphemes = s => [...new Intl.Segmenter('ja', {granularity:'grapheme'}).segment(s)].map(x => x.segment);
  const rows = new Map(), pageIndexes = [], unknown = new Set(), lengths = new Map();
  const source = window.READER_BOOK;
  const sourceBlocks = (source.kind === 'mixed' ? source.entries.filter(e=>e.kind==='text').flatMap(e=>e.blocks||[e]) : source.blocks||[])
    .filter(b=>typeof b?.text === 'string' && b.text.length);
  let novelOrdinal = -1;
  function visible(el) {
    if (!el || !el.getClientRects().length || !el.checkVisibility({visibilityProperty:true,opacityProperty:true})) throw Error('表示要素を取得できません');
  }
  function readNode(root) {
    visible(root);
    let text = '';
    const rubies = [];
    function visit(el) {
      if (el.nodeType === Node.TEXT_NODE) { text += el.data; return; }
      if (el.matches('rp,rt')) return;
      visible(el);
      const start = [...text].length;
      for (const child of el.childNodes) visit(child);
      if (el.tagName !== 'RUBY') return;
      const content = [...text].slice(start).join(''), units = graphemes(content);
      for (const rt of el.querySelectorAll(':scope > rt')) {
        visible(rt);
        const a = rt.hasAttribute('data-ruby-start') ? Number(rt.dataset.rubyStart) : 0;
        const b = rt.hasAttribute('data-ruby-end') ? Number(rt.dataset.rubyEnd) : units.length;
        if (!Number.isInteger(a)||!Number.isInteger(b)||a<0||a>=b||b>units.length) throw Error('ルビ位置が不正です');
        const offset = start+[...units.slice(0,a).join('')].length, base = units.slice(a,b).join('');
        rubies.push({base,reading:rt.textContent,start:offset,end:offset+[...base].length});
      }
    }
    visit(root);
    return {text,rubies};
  }
  function addText(key, scope, field, ix, startsPage) {
    if (!rows.has(key)) rows.set(key,{key,scope,value:{text:''},rubies:[],fragments:[],pageIndexes:[]});
    const r=rows.get(key), offset=[...r.value.text].length;
    if (r.scope!==scope) throw Error('同一本文位置の種別が変化しました');
    if (!offset && scope==='heading') r.value.startsPage=startsPage;
    r.value.text+=field.text;
    r.fragments.push({page:ix,start:offset,end:[...r.value.text].length});
    if(!r.pageIndexes.includes(ix)) r.pageIndexes.push(ix);
    for(const u of field.rubies) r.rubies.push({...u,start:u.start+offset,end:u.end+offset,page:ix});
  }
  function textKind(el,span) {
    if (el.tagName==='H2') return 'heading';
    if (el.classList.contains('novel-toc-entry')) return 'toc';
    const kind=sourceBlocks[span.sourceBlock]?.type;
    if (kind==='toc') return 'toc';
    if (['note','caption','footnote'].includes(kind)) return 'note';
    return 'body';
  }
  const manifest = reader.pageManifest();
  for (const [ix, page] of manifest.entries()) {
    if (page.scan!==scan && !(page.sourceSpans||[]).some(s=>s.scan===scan)) continue;
    reader.gotoPage(ix);
    const deadline=performance.now()+10000;
    while(reader.inspect().index!==ix||reader.inspect().paintPending) {
      if(performance.now()>deadline)throw Error('ページの描画が完了しません');
      await new Promise(requestAnimationFrame);
    }
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    if(reader.inspect().index!==ix||reader.inspect().paintPending)throw Error('ページ表示が検査中に変わりました');
    pageIndexes.push(ix);
    if (page.kind==='image') {
      const figure=document.querySelector('#figure-image'), key='figure-'+page.figure;
      if (!rows.has(key)) {
        visible(figure);await figure.decode();
        if(!figure.naturalWidth)throw Error('図版を取得できません');
        const response=await fetch(figure.currentSrc);if(!response.ok)throw Error('図版の読戻しに失敗しました');
        const sha=await crypto.subtle.digest('SHA-256',await response.arrayBuffer());
        rows.set(key,{key,scope:'figure',value:{sha256:[...new Uint8Array(sha)].map(x=>x.toString(16).padStart(2,'0')).join('')},pageIndexes:[ix]});
        const label=document.querySelector('#figure-caption-label');
        if(label?.textContent&&label.checkVisibility())addText(key+'-title','other',readNode(label),ix,false);
      }
      const cap=document.querySelector('#figure-caption');
      if(cap?.textContent) addText('caption-'+page.figure,'caption',readNode(cap),ix,false);
      continue;
    }
    if(page.kind!=='text'||!page.sourceSpans.length) throw Error('対応する本文範囲がありません');
    const flow=document.querySelector('#text-flow');visible(flow);
    let idx=0;
    for(const [child,el] of [...flow.children].entries()) {
      const field=readNode(el), units=graphemes(field.text);
      let offset=0, cp=0;
      while(offset<units.length) {
        const s=page.sourceSpans[idx++];
        if(!s)throw Error('表示本文が出典範囲を超過しています');
        const n=s.sourceEnd-s.sourceStart;
        if(!Number.isSafeInteger(n)||!Number.isSafeInteger(s.sourceStart)||s.sourceStart<0||n<=0||offset+n>units.length)throw Error('表示本文の境界が一致しません');
        const value=units.slice(offset,offset+n).join(''),end=cp+[...value].length;
        if(s.scan===scan) {
          if (s.sourceBlock==null && s.sourceStart===0) novelOrdinal++;
          const key='block-'+(s.sourceBlock??novelOrdinal);
          if ((lengths.get(key)||0)!==s.sourceStart) throw Error('出典の本文に欠落または重複があります');
          lengths.set(key,s.sourceEnd);
          const rubies=field.rubies.filter(r=>r.start<end&&r.end>cp).map(r=>{
            if(r.start<cp||r.end>end)throw Error('ルビが出典境界をまたいでいます');
            return {...r,start:r.start-cp,end:r.end-cp};
          });
          addText(key,textKind(el,s),{text:value,rubies},ix,child===0&&offset===0);
        }
        offset+=n;cp=end;
      }
    }
    if(idx!==page.sourceSpans.length)throw Error('出典範囲に対応する表示本文がありません');
  }
  // NovelReader does not expose original block IDs for notes; a visually
  // indistinguishable note cannot certify either the note or body census.
  if(window.NovelReader&&sourceBlocks.some(b=>['footnote','note','caption'].includes(b.type))) {
    unknown.add('body');unknown.add('note');
  }
  return {rows:[...rows.values()],pageIndexes,unknown:[...unknown]};
}
