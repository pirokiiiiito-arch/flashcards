// Executed in the painted reading frame. Pagination metadata selects original
// regions; strings, ruby bases/readings and image bytes come from visible DOM.
async scan => {
  const rows = new Map(), seen = new Set(), unknown = new Set(), pageIndexes = [];
  const captions = new Map(), figureNumbers = new Map();
  const codepoints = text => [...text].length;
  function visible(e) {
    if (!e || !e.getClientRects().length || e.closest('[hidden]')) throw Error('表示領域がありません');
  }
  function readText(element) {
    visible(element);
    let text = ''; const rubies = [];
    function walk(el) {
      if (el.nodeType === Node.TEXT_NODE) { text += el.data; return; }
      if (['RT','RP'].includes(el.tagName)) return;
      const at = codepoints(text);
      for (const child of el.childNodes) walk(child);
      if (el.tagName === 'RUBY') {
        const rt = el.querySelector('rt');
        visible(rt);
        rubies.push({ start:at, end:codepoints(text), base:[...text].slice(at).join(''), reading:rt.textContent });
      }
    }
    walk(element);
    return {text,rubies};
  }
  function add(key, scope, value, page, more={}) {
    if (!rows.has(key)) rows.set(key,{key,scope,value,pageIndexes:[],...more});
    const row=rows.get(key);
    if (!row.pageIndexes.includes(page)) row.pageIndexes.push(page);
    return row;
  }
  function textAt(key, scope, field, page, offset, startsPage) {
    const row=add(key,scope,{text:''},page,{rubies:[],fragments:[]});
    if (row.value.text.length!==offset) throw Error('非連続の表示本文 '+key);
    const previous=codepoints(row.value.text);
    row.fragments.push({page,start:previous,end:previous+codepoints(field.text)});
    row.value.text+=field.text;
    if (scope==='heading' && !offset) row.value.startsPage=startsPage;
    for(const r of field.rubies) row.rubies.push({...r,start:r.start+previous,end:r.end+previous,page});
  }
  async function digestImage(element) {
    visible(element); await element.decode();
    if(!element.naturalWidth) throw Error('図版の読込みに失敗しました');
    const data=await (await fetch(element.currentSrc)).arrayBuffer();
    const hash=await crypto.subtle.digest('SHA-256',data);
    return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  const manifest=WH1BookReader.pageManifest();
  for(let i=0;i<pages.length;i++){
    const p=pages[i],meta=manifest[i];
    if(!(meta.sourceScans||[]).includes(scan)&&p.scan!==scan&&p.sourcePage!==scan) continue;
    WH1BookReader.gotoPage(i);
    for(let j=0;j<120;j++){
      const state=WH1BookReader.inspect();
      if(state.index===i&&!state.paintPending)break;
      await new Promise(requestAnimationFrame);
    }
    if(WH1BookReader.inspect().index!==i||WH1BookReader.inspect().paintPending)throw Error('描画が完了しません');
    const box=document.querySelector('#reader-page'); visible(box);pageIndexes.push(i);
    if(p.type==='text'){
      const flow=box.querySelector('.text-flow');visible(flow);
      if(flow.children.length!==p.parts.length)throw Error('段落数が一致しません');
      p.parts.forEach((part,j)=>{
        const b=blocks[part.block],el=flow.children[j],field=readText(el);
        const spans=b.sourceSpans||[{scan:b.scan,start:0,end:b.text.length,sourceRef:b.sourceRef}];
        if(field.text.length!==part.text.length || spans[0]?.start!==0 || spans.at(-1)?.end!==b.text.length ||
           spans.some((s,k)=>k>0&&s.start!==spans[k-1].end)) throw Error('表示列と出典範囲に未観測の文字があります');
        for(const s of spans){
          if(s.scan!==scan)continue;
          if (!s.sourceRef) {unknown.add('other');continue;}
          const left=Math.max(s.start,part.offset),right=Math.min(s.end,part.offset+field.text.length);
          if(left>=right)continue;
          const from=left-part.offset,to=right-part.offset;
          const cpFrom=codepoints(field.text.slice(0,from)), cpTo=codepoints(field.text.slice(0,to));
          const fragment={text:field.text.slice(from,to),rubies:field.rubies.filter(r=>cpFrom<=r.start&&r.end<=cpTo).map(r=>({...r,start:r.start-cpFrom,end:r.end-cpFrom}))};
          const scope=el.tagName==='H2'?'heading':el.matches('.note-text')?'note':el.matches('.signature,.separator')?'other':'body';
          textAt('block-'+s.sourceRef[1],scope,fragment,i,left-s.start,j===0);
        }
      });
    }else if(p.type==='illustration'){
      const section=box.querySelector('.figure-bundle');visible(section);
      if(!captions.has(p.group))captions.set(p.group,captions.size);
      const ordinal=captions.get(p.group);
      if(!seen.has(p.group)){
        const title=section.querySelector('.figure-bundle-title');
        if(title)textAt('figure-title-'+ordinal,'other',readText(title),i,0,false);
        const tabs=section.querySelectorAll('.figure-bundle-tabs button');
        for(let k=0;k<p.figures.length;k++){
          if(tabs.length)tabs[k].click();
          const element=section.querySelector('img');
          add('figure-'+ordinal+'-'+k,'figure',{sha256:await digestImage(element)},i);
          const label=section.querySelector('.figure-bundle-figlabel');
          if(label)textAt('figure-label-'+ordinal+'-'+k,'caption',readText(label),i,0,false);
        }
        if(tabs.length)tabs[0].click();seen.add(p.group);
      }
      const cap=section.querySelector('.figure-bundle-caption-content');
      if(cap)textAt('caption-'+ordinal,'caption',readText(cap),i,p.partOffset||0,false);
    }else if(p.type==='figure'||p.type==='image'){
      const ordinal=figureNumbers.size;figureNumbers.set(i,ordinal);
      add('image-'+ordinal,'figure',{sha256:await digestImage(box.querySelector('img'))},i);
      const caption=box.querySelector('figcaption');
      if(caption)textAt('image-caption-'+ordinal,'caption',readText(caption),i,0,false);
    }else if(p.type==='toc'){
      const items=box.querySelectorAll('.toc-row');if(!items.length){unknown.add('toc');continue;}
      for(const item of items){const key='toc-'+i+'-'+Array.prototype.indexOf.call(items,item);textAt(key,'toc',readText(item),i,0,false);}
    }else for(const scope of ['body','heading','figure','caption','note','ruby','toc','other'])unknown.add(scope);
  }
  return {rows:[...rows.values()],pageIndexes,unknown:[...unknown]};
}
