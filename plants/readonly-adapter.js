/* Read-only plant adapter. No old-cloud migration or local save is performed. */
(function(root){
  'use strict';
  const isDrive=v=>/^gdrive:[\w-]+:[a-f0-9]{64}$/.test(String(v||''));
  let stats={cards:0,assigned:0,drive:0,files:0},urls=new Map(),sequence=0;
  const statusEl=document.createElement('p');statusEl.setAttribute('role','status');statusEl.style.cssText='width:100%;font-size:13px;line-height:1.7;white-space:pre-wrap';
  document.querySelector('.toolbar').appendChild(statusEl);
  function prune(){const visible=new Set([...document.querySelectorAll('img')].map(x=>x.src));for(const [ref,url] of urls){if(urls.size<=6)break;if(!visible.has(url)){URL.revokeObjectURL(url);urls.delete(ref);}}}
  function detail(){return '植物 '+stats.cards+'件 ／ 写真割当 '+stats.assigned+'枠 ／ Drive画像参照 '+stats.drive+'枠 ／ Drive内画像ファイル '+stats.files+'個\n'+
    (!stats.assigned?(stats.files?'Driveに画像ファイルはありますが、植物との割当がありません。自動で推測して貼り付けません。':'このDrive保存領域には植物写真の割当・画像ファイルがありません。写真の残るPCから送信する必要があります。'):'写真はカードを開くと取得します。取得エラーは写真欄に表示します。');}
  const api=root.DriveReadOnly.install({namespace:'plant-flashcards',toolbar:'.toolbar',ready:plantBootReady,
    onStatus:(s,m)=>{imageSyncStatus.textContent='画像Drive閲覧：'+s;statusEl.textContent=detail()+'\n'+m;},
    apply:async result=>{
      const list=[];let assigned=0,drive=0;
      for(const [key,c] of Object.entries(result.view.data)){
        if(!key.startsWith('card:'))continue;
        if(!validCard(c)||typeof c.id!=='string'||key!=='card:'+c.id)throw Error('植物カードの形式を確認できません。元データは変更していません。');
        const images=[0,1,2].map(i=>{
          const value=result.view.data['image:'+c.id+':'+i]||'';
          if(typeof value!=='string')throw Error('植物写真の形式を確認できません。');
          if(value){assigned++;if(isDrive(value))drive++;}return value;
        });
        list.push(withImages({...c},images));
      }
      list.sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||a.id.localeCompare(b.id));
      cards=list;sequence++;stats={cards:list.length,assigned,drive,files:result.imageFiles.length};
      updateCounts();if(!currentGroup&&cards.length)openGroup(cards[0].group);else if(currentGroup){rebuildOrder();render();}
      statusEl.textContent=detail();
      if(!list.length)throw Error('Driveから受信できた植物は0件です。カードの復旧は完了していません。');
    },summary:()=>detail()+'\n閲覧専用です。端末保存・Driveへの書込みは行いません。'
  });
  root.PlantDriveSync=api;
  const oldResolve=resolveImageValue;
  resolveImageValue=async function(value){
    if(!isDrive(value)){
      if(String(value).startsWith('idb:'))throw Error('PC内にだけ保存された写真です。PCからDriveへ送信する必要があります。');
      return oldResolve(value);
    }
    if(urls.has(value))return urls.get(value);
    const blob=await api.getBlob(value),url=URL.createObjectURL(blob);urls.set(value,url);return url;
  };
  resolveCardImage=async function(item,index,value){return value?resolveImageValue(value):'';};
  const oldRender=render;
  render=function(){const out=oldRender.apply(this,arguments);prune();return out;};
  imageSyncStatus.onclick=()=>api.open();
})(window);
