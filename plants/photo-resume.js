/* Viewer presentation repair only. Reads through the existing authenticated,
 * hash-verified local-first resolver. Never uploads, deletes or changes a card. */
(function(root){
  'use strict';
  const pending=new WeakMap();
  const good=box=>{const img=box.querySelector('img');return !!(img&&img.complete&&img.naturalWidth>0);};
  function decode(url,label,makeImage=()=>new root.Image()){
    return new Promise((resolve,reject)=>{
      const img=makeImage();let finished=false;
      const done=(error)=>{if(finished)return;finished=true;clearTimeout(timer);img.onload=img.onerror=null;error?reject(error):resolve(img);};
      const timer=setTimeout(()=>done(Error('写真の表示処理が完了しません。次の同期で再試行します。')),20000);
      img.alt=label;
      img.onload=()=>img.naturalWidth>0?done():done(Error('写真のサイズを確認できません。'));
      img.onerror=()=>done(Error('画像データを取得しましたが、このブラウザで表示できません。元画像は保持しています。'));
      img.src=url;
      if(img.complete&&img.naturalWidth>0)done();
    });
  }
  async function retry({stage,getCard,getImages,resolve,isEditing=()=>false,makeImage}){
    if(!stage||isEditing())return;
    const item=getCard();if(!item)return;
    const values=getImages(item),jobs=[];
    for(const [index,box] of [...stage.querySelectorAll('.image-box')].entries()){
      if(good(box))continue;
      const value=values[index];
      if(!value){
        box.dataset.photoState='unassigned';
        // Zero registered slots is not a successful image transfer.
        if(!box.querySelector('img'))box.textContent='画像'+(index+1)+'：写真の登録情報がまだ届いていません。';
        continue;
      }
      const key=item.id+'\u0000'+index+'\u0000'+value;
      const task=pending.get(box);if(task?.key===key){jobs.push(task.work);continue;}
      const current=()=>box.isConnected&&!isEditing()&&getCard()?.id===item.id&&getImages(getCard())[index]===value;
      const ticket={key};
      ticket.work=Promise.resolve().then(async()=>{
        try{
          const url=await resolve(item,index,value);
          if(!current()||pending.get(box)!==ticket||good(box))return;
          if(!url)throw Error('写真の保存先から画像を取得できません。元のPCの写真は削除しないでください。');
          const img=await decode(url,item.name+' 画像'+(index+1),makeImage);
          if(!current()||pending.get(box)!==ticket||good(box))return;
          const x=root.scrollX,y=root.scrollY;
          box.replaceChildren(img);box.dataset.photoState='ready';delete box.dataset.photoError;
          if(root.scrollTo&&(root.scrollX!==x||root.scrollY!==y))root.scrollTo(x,y);
        }catch(e){
          if(current()&&pending.get(box)===ticket&&!good(box)){
            box.dataset.photoState='failed';box.dataset.photoError=String(e.message||e).slice(0,400);
            box.textContent=box.dataset.photoError;
          }
        }finally{if(pending.get(box)===ticket)pending.delete(box);}
      });
      pending.set(box,ticket);jobs.push(ticket.work);
    }
    await Promise.all(jobs);
  }
  const api=Object.freeze({retry,decode});root.PlantPhotoResume=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
