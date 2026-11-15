/* Novel paragraph segmentation. Original Japanese text is never rewritten.
   Only top-level spoken 「 opens a new visual paragraph/vertical column.
   Explicit quoteMode:"inline" can protect quoted terms that are not dialogue. */
(function(root,factory){
 'use strict';
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.NovelDialogue=api;
})(typeof window!=='undefined'?window:null,function(){
 'use strict';
 function expandOne(block,index){
  if(!block||typeof block.text!=='string')throw Error('NOVEL_INVALID_TEXT_BLOCK '+index);
  const type=block.type==='heading'?'heading':block.type==='dialogue'?'dialogue':'body';
  const text=block.text,scan=Number(block.scan);
  if(!Number.isInteger(scan)||scan<1)throw Error('NOVEL_INVALID_SCAN '+index);
  if(!text.length)return [];
  const base={scan,sourceBlockIndex:index};
  if(type==='heading'||block.quoteMode==='inline'||block.splitDialogue===false){
   return [{...base,type,text,sourceStart:0,sourceEnd:text.length}];
  }
  const output=[];
  let start=0,depth=0,segmentType=type;
  function push(end){
   if(end>start)output.push({...base,type:segmentType,
    text:text.slice(start,end),sourceStart:start,sourceEnd:end});
  }
  for(let i=0;i<text.length;i++){
   if(text[i]==='「'){
    if(depth===0){
     push(i);start=i;segmentType='dialogue';
    }
    depth++;
   }else if(text[i]==='」'){
    if(depth>0)depth--;
   }
  }
  push(text.length);
  if(output.map(x=>x.text).join('')!==text)throw Error('NOVEL_SOURCE_TEXT_CHANGED '+index);
  return output;
 }
 function expandBlocks(source){
  if(!Array.isArray(source))throw Error('NOVEL_BLOCK_ARRAY_REQUIRED');
  const parts=source.flatMap((block,index)=>expandOne(block,index));
  for(let i=0;i<source.length;i++){
   const expected=source[i]?.text||'';
   if(parts.filter(x=>x.sourceBlockIndex===i).map(x=>x.text).join('')!==expected)
    throw Error('NOVEL_ROUNDTRIP_FAILED '+i);
  }
  return parts;
 }
 return Object.freeze({expandOne,expandBlocks,version:'1.0'});
});
