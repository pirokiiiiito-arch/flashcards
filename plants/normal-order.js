/* Order only: never changes card IDs, text, images or deletion records. */
(function(root){
  'use strict';
  const KEY='order:normal',SCHEMA='plant-pc-normal-order-v1';
  function validate(value){
    if(value==null)return null;
    if(value.schema!==SCHEMA||!Array.isArray(value.ids)||value.ids.length>100000||
       value.ids.some(id=>typeof id!=='string'||!id||id.length>250)||new Set(value.ids).size!==value.ids.length||
       typeof value.revision!=='string'||!value.revision||typeof value.updated_at!=='string')
      throw Error('PCの並び順データを確認できません。名前・写真は変更していません。');
    return {schema:SCHEMA,ids:value.ids.slice(),revision:value.revision,updated_at:value.updated_at};
  }
  function createRecord(cards,revision,updated_at){
    return validate({schema:SCHEMA,ids:cards.map(c=>c.id),revision,updated_at});
  }
  function ordered(list,record=null,options={}){
    if(!Array.isArray(list)||list.some(c=>!c||typeof c.id!=='string')||new Set(list.map(c=>c.id)).size!==list.length)
      throw Error('植物の並び順を確認できません。元データは保持しています。');
    const spec=validate(record),source=options.sourceIds||root.PLANT_SOURCE_ORDER||[];
    const sourceRank=new Map(source.map((id,i)=>[id,i]));
    const selected=spec?spec.ids:(options.preferredIds||[]),rank=new Map(selected.map((id,i)=>[id,i]));
    const numeric=c=>c.sort_order!==null&&c.sort_order!==''&&c.sort_order!==undefined&&Number.isFinite(Number(c.sort_order))?Number(c.sort_order):Infinity;
    const distinct=new Set(list.map(numeric).filter(Number.isFinite));
    const meaningfulNumeric=distinct.size>1;
    const code=(a,b)=>a<b?-1:a>b?1:0;
    const fallback=(a,b)=>{
      if(meaningfulNumeric){const x=numeric(a),y=numeric(b);if(x!==y)return x<y?-1:1;}
      const x=sourceRank.get(a.id),y=sourceRank.get(b.id);
      if(x!==undefined||y!==undefined){if(x===undefined)return 1;if(y===undefined)return -1;if(x!==y)return x-y;}
      // Unknown additions not yet present in a PC order record follow the known
      // sequence. Their IDs are only a stable tie-breaker, never a seed ordering.
      return code(a.id,b.id);
    };
    return list.slice().sort((a,b)=>{
      const x=rank.get(a.id),y=rank.get(b.id);
      if(x!==undefined||y!==undefined){if(x===undefined)return 1;if(y===undefined)return -1;return x-y;}
      return fallback(a,b);
    });
  }
  function describe(record){return record?'通常順：PCから共有した順番':'通常順：PCの元データの登録順';}
  const api=Object.freeze({KEY,SCHEMA,validate,createRecord,ordered,describe});
  root.PlantNormalOrder=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
