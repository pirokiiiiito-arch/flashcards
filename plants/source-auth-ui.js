/* Presentation decision only. No authentication, storage or photo mutation. */
(function(root){
  'use strict';
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
  function required(state,cards,getImages,view={}){
    if(!state?.authRequired)return false;
    let available=false,removed=false;
    for(const card of cards||[]){
      if(!card||typeof card.id!=='string')continue;
      if(own(view.deleted,'card:'+card.id)){removed=true;continue;}
      const images=getImages(card);
      for(let i=0;i<3;i++){
        const key='image:'+card.id+':'+i;
        if(own(view.deleted,key)){removed=true;continue;}
        // A new local replacement takes precedence until the normal sync applies.
        // An idb reference may still need its original authenticated source.
        const value=images[i]||view.data?.[key]||'';
        if(typeof value!=='string')continue;
        if(value.startsWith('idb:'))return true;
        if(value)available=true;
      }
    }
    // A source rescan is optional when live photos already have usable sources.
    // Keep first-time recovery available when no assignments have arrived; do
    // not turn explicit removal into another demand to restore old pictures.
    return !available&&!removed;
  }
  const api=Object.freeze({required});root.PlantSourceAuthUI=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
