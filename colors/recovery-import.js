/* User-initiated restoration of locally saved private photo edits.
   Photos are NEVER committed to this public repository. */
(function(){
  'use strict';
  const editor=window.ColorOriginEditor,drive=window.ColorDriveSync;
  if(!editor||!drive)return;
  const toolbar=document.querySelector('.toolbar .controls')||document.body;
  const button=document.createElement('button');
  button.type='button';button.className='btn';button.textContent='以前追加した写真・由来を復元';
  button.title='旧PCから救出したJSONまたはJSON.gzを選びます（非公開）';
  const picker=document.createElement('input');
  picker.type='file';picker.accept='.json,.gz,.json.gz,application/json,application/gzip';picker.multiple=true;picker.hidden=true;
  const notice=document.createElement('p');
  notice.setAttribute('role','status');notice.style.cssText='font-size:12px;line-height:1.6;margin:8px 0';
  toolbar.append(button,picker,notice);
  const snapshot=()=>{
    const envelope={schema:'colors1000-before-manual-recovery-v1',saved_at:new Date().toISOString(),
      manual_photo_edits:manualEdits,manual_origin_edits:editor.getRecords(),study_progress:progress};
    const link=document.createElement('a');
    const url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'}));
    link.href=url;link.download='colors1000_before_recovery_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
    link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
  };
  const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
  button.onclick=()=>picker.click();
  picker.onchange=async()=>{
    const files=Array.from(picker.files||[]);picker.value='';if(!files.length)return;
    button.disabled=true;window.__COLOR_RESTORE_IMPORT_ACTIVE=true;
    try{
      notice.textContent='救出ファイルを検証しています…';
      const combined={schema:'colors1000-manual-recovery-v1',dataset_signature:editor.datasetSignature,
        manual_photo_edits:{},manual_origin_edits:{},study_progress:{}};
      let kind=null, expectedParts=null;
      const seen=new Set();
      for(let i=0;i<files.length;i++){
        const file=files[i];
        notice.textContent='復元ファイルの確認 '+(i+1)+'／'+files.length+': '+file.name;
        if(file.size>350*1024*1024)throw Error('ファイルが大きすぎます: '+file.name);
        let content;
        if(file.name.endsWith('.gz')){
          if(typeof DecompressionStream!=='function')throw Error('gzipを読み込めません。ブラウザを更新してください。');
          content=await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
        }else content=await file.text();
        const part=JSON.parse(content);
        const partKind=part.schema==='colors1000-manual-recovery-chunk-v1'?'chunk':'full';
        if(!['colors1000-manual-recovery-v1','colors1000-browser-recovery-v1','colors1000-manual-recovery-chunk-v1'].includes(part.schema))
          throw Error('1000色カード用ではない復元ファイルです: '+file.name);
        if(kind&&kind!==partKind)throw Error('一括ファイルと分割ファイルを混ぜないでください。');
        kind=partKind;
        const signature=part.dataset_signature||part.origin_envelope?.dataset_signature;
        if(signature!==editor.datasetSignature)throw Error('色ID・色名・HEXが現在の1000色と一致しません。');
        if(partKind==='chunk'){
          const n=Number(part.part_index),all=Number(part.part_count);
          if(!Number.isInteger(n)||!Number.isInteger(all)||n<1||all<1||n>all)
            throw Error('分割ファイルの番号が正しくありません。');
          if(expectedParts!==null&&expectedParts!==all)throw Error('異なる分割セットが混ざっています。');
          if(seen.has(n))throw Error('同じ番号の分割ファイルが重複しています。');
          expectedParts=all;seen.add(n);
        }else if(files.length!==1)throw Error('大きな一括JSONは1個だけ選んでください。');
        for(const [k,v] of Object.entries(part.manual_photo_edits||{})){
          if(Object.prototype.hasOwnProperty.call(combined.manual_photo_edits,k))throw Error('画像の欄が重複しています: '+k);
          combined.manual_photo_edits[k]=v;
        }
        for(const [k,v] of Object.entries(part.manual_origin_edits||{})){
          if(Object.prototype.hasOwnProperty.call(combined.manual_origin_edits,k))throw Error('由来の編集が重複しています: '+k);
          combined.manual_origin_edits[k]=v;
        }
        Object.assign(combined.study_progress,part.study_progress||{});
      }
      if(kind==='chunk'){
        if(seen.size!==expectedParts||files.length!==expectedParts)
          throw Error('分割ファイルが不足しています。'+expectedParts+'個全部を同時に選んでください（現在'+seen.size+'個）。');
        if(Object.keys(combined.manual_photo_edits).length!==129||
           Object.values(combined.manual_photo_edits).filter(v=>!v.deleted).length!==126||
           Object.keys(combined.manual_origin_edits).length!==12)
          throw Error('復元セットの写真・由来件数が一致しません。');
      }
      const backup=combined;
      notice.textContent='手動写真の保存形式を確認しています…';
      const incoming=normalizeEdits(backup.manual_photo_edits||{});
      if(Object.keys(incoming).length!==Object.keys(backup.manual_photo_edits||{}).length)
        throw Error('手動写真の形式が正しくありません。');
      const origins=editor.validateRecords(backup.manual_origin_edits||{});
      const active=Object.values(incoming).filter(v=>!v.deleted).length;
      const deletions=Object.values(incoming).filter(v=>v.deleted).length;
      if(active===0&&Object.keys(origins).length===0)throw Error('復元できる写真と由来がありません。');
      const ok=window.confirm('手動写真'+active+'枚・由来'+Object.keys(origins).length+'件を復元します。現在の記録は先にJSONへ退避します。続けますか？');
      if(!ok){notice.textContent='復元を取り消しました。';return;}
      snapshot();
      // Preserve current live edits on different revisions. A previously tombstoned
      // slot may be explicitly revived by this user-selected recovery.
      const next={...manualEdits};let restored=0,existing=0;
      for(const [key,value] of Object.entries(incoming)){
        const current=next[key];
        if(!current||(current.deleted&&!value.deleted)){
          next[key]=value;restored++;
        }else existing++;
      }
      manualEdits=next;
      await persistEdits();
      // The user explicitly selected a recovery snapshot: listed origin entries
      // are restored as the chosen revisions, others remain in place.
      await editor.applyCloudRecords(origins);
      render();
      notice.textContent='端末に手動写真'+restored+'枠・由来'+Object.keys(origins).length+
        '件を復元しました。Driveとの同期を確認しています…';
      window.__COLOR_RESTORE_IMPORT_ACTIVE=false;
      drive.changed();
      if(drive.valid()){
        await drive.sync();
        notice.textContent='復元とDrive同期が完了しました。写真'+restored+'枠復元・既存保持'+existing+
          '枠・由来'+Object.keys(origins).length+'件。スマホでもGoogle Drive同期を実行してください。';
      }else{
        notice.textContent='端末への復元は完了しました（写真'+restored+'枠、由来'+Object.keys(origins).length+
          '件）。Google Drive同期を開き、「接続して同期」を押してください。';
        drive.open();
      }
    }catch(e){notice.textContent='復元エラー：'+(e?.message||String(e));}
    finally{button.disabled=false;window.__COLOR_RESTORE_IMPORT_ACTIVE=false;}
  };
})();
