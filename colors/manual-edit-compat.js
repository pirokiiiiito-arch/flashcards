/* Compatibility additions: retain the original origin editor and storage format. */
(function(){
  'use strict';
  // Dragging a local image onto a photo field uses the same validation and duplicate guard.
  document.addEventListener('dragover',function(event){const target=event.target?.closest?.('[data-paste-target]');if(!target||!state.flipped||!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='copy';});
  document.addEventListener('drop',function(event){const target=event.target?.closest?.('[data-paste-target]');if(!target||!state.flipped)return;const file=Array.from(event.dataTransfer?.files||[]).find(file=>['image/png','image/jpeg','image/webp','image/gif'].includes(file.type));if(!file)return;event.preventDefault();event.stopPropagation();selectPasteTarget(target.dataset.pasteTarget);setImage(target.dataset.pasteTarget,file).catch(error=>toast(error.message));});
  // A restored old editor can keep its exact identity while downloads use the current generation.
  const editor=window.ColorOriginEditor;if(!editor)return;
  const button=document.getElementById('exportResearch');if(!button)return;
  button.onclick=async function(){try{await editor.ready;await readyImages;const data=makeProgressExport(true),generation=Math.max(data.origin_revision_policy?.head?.generation||0,data.display_color_revision_policy?.head?.generation||0),a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=url;a.download='colors1000_review'+generation+'_with_edits_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}catch(error){toast(error.message||'進捗JSONを保存できません。');}};
})();
