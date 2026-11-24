/* Word boundaries are prepared from the original Japanese at book creation. */
(function (root) {
 'use strict';
 function create(book) {
  const lines=new Map(), contents=new Map(), prefaces=new Set(), separators=new Set(), fittedSizes=new Map();
  let meter, capacity=0, fontSize=20, fontFamily='';
  const rows=book.kind==='text' ? book.blocks : (book.entries||[]).flatMap(e=>e.kind==='text'?(e.blocks||[e]):[]);
  rows.forEach((row,i)=>{
   if(!row.id)row.id='poetry-source-'+i;
   if(row.type==='toc' && row.printedContents)contents.set(row.id,row.printedContents);
   if(row.type==='heading' && row.printedSection){
    contents.set(row.id,{...row.printedSection,section:true});
    prefaces.add(row.id);
   }
   if(row.type==='toc' && row.printedSeparator){separators.add(row.id);prefaces.add(row.id);}
   if(!['body','dialogue'].includes(row.type||'body') || row.lineRole==='prose')return;
   row.quoteMode='inline';
   lines.set(row.id,{ends:row.poetryWordEnds,stanza:row.stanzaBefore||0});
  });

  function boundaries(block) {
   const supplied=block.verse.ends;
   if(!Array.isArray(supplied)||!supplied.length)throw Error('詩行の語境界がありません：'+block.id);
   const result=[];
   let offset=0,cut=0;
   for(let i=0;i<block.units.length;i++){
    offset+=Array.from(block.units[i]).length;
    while(cut<supplied.length&&supplied[cut]<offset)cut++;
    if(supplied[cut]!==offset)continue;
    cut++;
    if(!block.ruby?.some(r=>r.start<i+1&&r.end>i+1))result.push(i+1);
   }
   if(result.at(-1)!==block.units.length||cut!==supplied.length)throw Error('詩行と語境界が一致しません：'+block.id);
   return result;
  }
  function measureColumn(surface) {
   const style=getComputedStyle(surface);
   const size=parseFloat(style.fontSize);
   const height=surface.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom)-2;
   if(height===capacity && size===fontSize && style.fontFamily===fontFamily)return;
   capacity=height;fontSize=size;fontFamily=style.fontFamily;fittedSizes.clear();
   if(!meter){
    meter=document.createElement('span');
    meter.className='poetry-word-meter';
    meter.setAttribute('aria-hidden','true');
    document.body.append(meter);
   }
   Object.assign(meter.style,{fontFamily:fontFamily,fontSize:size+'px',lineHeight:style.lineHeight});
  }
  function fitLongWord(word,text,measureAlways=false,limit=capacity) {
   if(!meter||capacity<=0||(!measureAlways&&text.length*fontSize*2<capacity&&!word.querySelector('ruby')))return;
   // A very long name can exceed even a completely empty vertical column.
   const key=limit+'|'+word.className+'|'+word.innerHTML;
   if(!fittedSizes.has(key)){
    const clone=word.cloneNode(true);
    Object.assign(clone.style,{display:'inline-block',inlineSize:'max-content',whiteSpace:'nowrap'});
    meter.replaceChildren(clone);
    let size=fontSize;
    if(clone.getBoundingClientRect().height>limit){
     // Some vertical glyph advances round to a whole pixel at each character.
     // Measure the fitted size on the same browser instead of scaling by a ratio.
     let low=0,high=fontSize;
     for(let i=0;i<12;i++){
      const trial=(low+high)/2;clone.style.fontSize=trial+'px';
      if(clone.getBoundingClientRect().height<=limit)low=trial;
      else high=trial;
     }
     size=low;
    }
    fittedSizes.set(key,size);
   }
   const size=fittedSizes.get(key);
   if(size<fontSize)word.style.fontSize=size+'px';
  }
  function paint(el,p,split,write,sliceRuby) {
   el.classList.add('poetry-line');
   if(p.verse.stanza&&!p.continued)el.style.setProperty('--stanza-space',p.verse.stanza+'lh');
   const original=split(p.text),display=split(p.displayText??p.text);
   let cursor=0;
   for(const end of p.wordEnds){
    if(end<=p.verseOffset)continue;
    const stop=Math.min(end-p.verseOffset,original.length);
    const word=document.createElement('span');
    word.className='poetry-word';
    word.dataset.start=String(p.verseOffset+cursor);word.dataset.end=String(p.verseOffset+stop);
    const text=original.slice(cursor,stop).join('');
    write(word,text,{displayText:display.slice(cursor,stop).join(''),
     before:(p.before+display.slice(0,cursor).join('')).slice(-3),
     after:(display.slice(stop).join('')+p.after).slice(0,3),
     ruby:p.ruby?sliceRuby(p.ruby,cursor,stop-cursor):undefined});
    fitLongWord(word,text);
    if(cursor)el.append(document.createElement('wbr'));
    el.append(word);cursor=stop;
    if(stop===original.length)break;
   }
   if(cursor!==original.length)throw Error('詩行の末尾を描画できません：'+p.id);
  }
  function paintContents(el,p,write,openEntry) {
   if(separators.has(p.id)){
    el.classList.add('printed-separator');write(el,p.text,p);return true;
   }
   const row=contents.get(p.id);
   if(!row)return false;
   const link=row.section?document.createElement('a'):el;
   if(row.section){
    link.className='printed-section';link.href='#scan-'+row.target;
    write(link,p.text,p);el.append(link);
   }else{
    link.classList.add('printed-contents');link.setAttribute('role','link');link.tabIndex=0;
    link.setAttribute('aria-label',row.label+'　'+row.number+'ページ');
    const label=document.createElement('span'),leader=document.createElement('span'),number=document.createElement('span');
    label.className='printed-label';leader.className='printed-leader';number.className='printed-number';
    leader.setAttribute('aria-hidden','true');number.textContent=row.number;
    write(label,row.label,{ruby:p.ruby});
    fitLongWord(label,row.label,true,Math.max(1,capacity-3*fontSize));
    link.append(label,leader,number);
   }
   link.addEventListener('click',event=>{event.preventDefault();openEntry(row);});
   link.addEventListener('keydown',event=>{
    if(event.key===' '||(!row.section&&event.key==='Enter')){event.preventDefault();openEntry(row);}
   });
   return true;
  }
  function bestPageEnd(ends,offset,fits) {
   let low=0,high=ends.length;
   while(low<high){
    const mid=Math.floor((low+high)/2);
    if(ends[mid]<=offset||fits(ends[mid]-offset))low=mid+1;
    else high=mid;
   }
   return low?Math.max(0,ends[low-1]-offset):0;
  }
  return {lines,contents,prefaces,boundaries,measureColumn,paint,paintContents,bestPageEnd};
 }
 root.PoetryLayout=Object.freeze({create});
})(window);
