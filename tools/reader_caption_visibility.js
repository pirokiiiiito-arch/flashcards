// Observe the actual typeset base text and ruby readings before leaving a page.
// Deliberately keep the proof probe separate from the reader's layout code.
function measureCaptionGlyphs(root) {
  const vv=window.visualViewport;
  const viewport={left:vv?.offsetLeft||0,top:vv?.offsetTop||0};
  viewport.right=viewport.left+(vv?.width||innerWidth);
  viewport.bottom=viewport.top+(vv?.height||innerHeight);
  const boxes=new Map(), segmenter=new Intl.Segmenter('ja',{granularity:'grapheme'});
  const transparent=color=>color==='transparent'||/^rgba\(.+,\s*0(?:\.0+)?\)$/.test(color);
  function clipFor(element) {
    if (!element) return {...viewport,shown:true};
    if(boxes.has(element)) return boxes.get(element);
    const clip={...clipFor(element.parentElement)}, style=getComputedStyle(element);
    const rect=element.getBoundingClientRect();
    if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)!==1||
       style.contentVisibility==='hidden'||(style.clipPath&&style.clipPath!=='none')||
       (style.maskImage&&style.maskImage!=='none')||(style.clip&&style.clip!=='auto')) clip.shown=false;
    const inside=(axis)=>style[axis]!=='visible';
    if(inside('overflowX')){
      const a=rect.left+element.clientLeft;
      clip.left=Math.max(clip.left,a);clip.right=Math.min(clip.right,a+element.clientWidth);
    }
    if(inside('overflowY')){
      const a=rect.top+element.clientTop;
      clip.top=Math.max(clip.top,a);clip.bottom=Math.min(clip.bottom,a+element.clientHeight);
    }
    boxes.set(element,clip);
    return clip;
  }
  let glyphs=0, hidden=0, readings=0;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT), range=document.createRange();
  while(walker.nextNode()) {
    const node=walker.currentNode, parent=node.parentElement;
    if(parent.closest('rp'))continue;
    const clip=clipFor(parent), style=getComputedStyle(parent);
    const traced=!!parent.closest('rt');
    const ink=!transparent(style.webkitTextFillColor||style.color);
    for(const {segment,index} of segmenter.segment(node.data)) {
      if(!segment.trim())continue;
      glyphs++;if(traced)readings++;
      range.setStart(node,index);range.setEnd(node,index+segment.length);
      const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
      if(!clip.shown||!ink||!rects.length||rects.some(r=>
        r.left<clip.left-.5||r.right>clip.right+.5||r.top<clip.top-.5||r.bottom>clip.bottom+.5))hidden++;
    }
  }
  return {fullyVisible:glyphs>0&&hidden===0,glyphs,hidden,readings};
}
