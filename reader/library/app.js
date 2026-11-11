'use strict';
(() => {
  const ROOT_ID = '1WPpY1os7llCyFaDa9C7Bf7vDQb0ee31j';
  const SCOPES = 'https://www.googleapis.com/auth/drive.readonly';
  const CLIENT_KEY = 'PRIVATE_BOOKSHELF_GOOGLE_CLIENT_ID';
  // Use the public OAuth client already configured for the three flashcard apps.
  // The bookshelf asks for drive.readonly separately; appdata permission alone is insufficient.
  const SHARED_CLIENT_ID = String(window.FLASHCARDS_DRIVE_CONFIG?.clientId || '').trim();
  const PREVIEW = {id:'wh1',title:'世界の歴史1',subtitle:'全274枚・縦書き読書版',scans:274,
    status:'OCR全字校正継続中',totalBytes:400389725,parts:[]};
  // Integrated UK Interiors reading edition: 82 continuous scans, OCR verification ongoing.
  // This preview stores no book bytes; images and text are downloaded privately from Drive.
  const UK_PREVIEW = {id:'uk-interiors',title:'図説 英国のインテリア史',subtitle:'全82枚・通し番号で一冊読書',scans:82,
    status:'読書版統合済み／独立全文字校正は継続中',totalBytes:126889183,parts:[]};
  const $ = id => document.getElementById(id);
  let books=[PREVIEW,UK_PREVIEW], savedIds=new Set(), selected=null, accessToken=null, expiry=0, pendingDownload=null;
  let tokenClient=null, connected=false, isRefreshing=false;
  const num = new Intl.NumberFormat('ja-JP');
  const say = (message) => {const t=$('toast');t.textContent=message;t.hidden=false;clearTimeout(say.timer);say.timer=setTimeout(()=>t.hidden=true,4500);};
  const setCloud = (title,detail,live=false) => {$('cloudTitle').textContent=title;$('cloudMessage').textContent=detail;connected=live;$('connectButton').textContent=live?'接続済み':'接続する';};
  const nice = value => Number.isFinite(Number(value)) ? `${Math.round(Number(value)/1024/1024)} MB` : '容量不明';
  const clientIdPattern=/^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
  function openSheet(prefix) {$(prefix+'Backdrop').hidden=false;$(prefix+'Panel').hidden=false;document.body.style.overflow='hidden';}
  function closeSheet(prefix) {$(prefix+'Backdrop').hidden=true;$(prefix+'Panel').hidden=true;document.body.style.overflow='';}
  function openSettings() { $('clientId').value=localStorage.getItem(CLIENT_KEY)||SHARED_CLIENT_ID||''; openSheet('settings'); }
  function closeSettings() {closeSheet('settings');}
  function normalizeTitle(filename) {
    let base=filename.replace(/\.zip$/i,'').replace(/\.part\d+$/i,'');
    base=base.replace(/[_ ]?(?:全\d+枚)?[_ ]?(?:統合書籍データ|一冊統合(?:完成)?版)$/,'');
    return base.replace(/_/g,' ').trim()||filename;
  }
  function safeBook(b) {
    if(!b||typeof b.id!=='string'||!/^[a-zA-Z0-9_-]{1,90}$/.test(b.id))return null;
    if(typeof b.title!=='string'||!b.title.trim()||!Array.isArray(b.parts))return null;
    const parts=b.parts.filter(p=>p&&/^[A-Za-z0-9_-]{12,128}$/.test(p.id||'')&&Number(p.size)>0)
      .map(p=>({id:p.id,name:String(p.name||''),size:Number(p.size)}));
    if(parts.length!==b.parts.length)return null;
    return {id:b.id,title:b.title.slice(0,140),subtitle:String(b.subtitle||'').slice(0,170),
      status:String(b.status||''),scans:Number(b.scans)||null,totalBytes:Number(b.totalBytes)||parts.reduce((s,p)=>s+p.size,0),parts,coverFileId:/^[A-Za-z0-9_-]{12,128}$/.test(b.coverFileId||'')?b.coverFileId:null,format:'unified-zip-v1'};
  }
  async function refreshSaved() {
    const meta=await LibraryDB.listMeta().catch(()=>[]);
    savedIds=new Set(meta.map(m=>m.id));
    if(!savedIds.has('wh1') && await LibraryDB.hasBook('wh1')) savedIds.add('wh1');
    const temp=meta.filter(m=>!books.some(b=>b.id===m.id)).map(m=>({id:m.id,title:m.title||m.id,
      subtitle:m.subtitle||'端末に保存済み',scans:m.scans,totalBytes:m.size,parts:[],status:'端末保存済み'}));
    for(const b of temp)books.push(b);
    renderShelf();
  }
  function card(book,index) {
    const button=document.createElement('button');button.type='button';button.className='book-card';
    button.setAttribute('aria-label',`${book.title}を開く`);
    const wrap=document.createElement('span');wrap.className='cover-wrap';
    const cover=document.createElement('span');cover.className='cover';
    const txt=document.createElement('span');txt.textContent=book.title;cover.append(txt);
    if(book.scans){const n=document.createElement('small');n.textContent=`全${num.format(book.scans)}枚`;cover.append(n);}
    // The real cover is loaded privately from Drive or an on-device book ZIP.
    // Text remains visible as a fallback, and the title below is always readable.
    const photo=document.createElement('img');photo.className='book-cover-photo';
    photo.alt=`${book.title}の表紙`;photo.loading='lazy';photo.decoding='async';photo.hidden=true;
    photo.onload=()=>cover.classList.add('photo-ready');
    photo.onerror=()=>{photo.hidden=true;cover.classList.remove('photo-ready');};
    cover.append(photo);
    window.BookCovers?.attach(photo,book,tokenValid()?fetchPrivateCover:null);
    wrap.append(cover);
    if(savedIds.has(book.id)){const s=document.createElement('span');s.className='cover-state';s.textContent='端末に保存済み';wrap.append(s);}
    const info=document.createElement('span');const title=document.createElement('span');title.className='book-name';title.textContent=book.title;
    const sub=document.createElement('span');sub.className='book-sub';sub.textContent=book.subtitle||((book.totalBytes)?nice(book.totalBytes):'統合読書版');info.append(title,sub);
    button.append(wrap,info);button.onclick=()=>showBook(book);
    return button;
  }
  function renderShelf(){const q=$('searchInput').value.trim().toLowerCase();const target=$('shelf');target.replaceChildren();
    const matching=books.filter(b=>b.title.toLowerCase().includes(q));
    matching.forEach((b,i)=>target.append(card(b,i)));
    $('bookCount').textContent=String(books.length);$('emptyState').hidden=matching.length!==0;
  }
  async function showBook(book){selected=book; $('detailTitle').textContent=book.title;
    $('detailSub').textContent=[book.subtitle||'',book.totalBytes?nice(book.totalBytes):'',book.status||''].filter(Boolean).join(' ／ ');
    const local=savedIds.has(book.id);
    $('detailStatus').textContent=local?'この端末に保存されています。通信なしで開けます。':book.parts.length?'Google Driveから初回だけ書籍データを保存します。':'Google Drive連携後に読み込めます。';
    $('primaryBookAction').textContent=local?'続きを読む':book.parts.length?'Google Driveから保存して読む':'Google Driveを接続する';
    $('removeBook').hidden=!local || book.id==='wh1' && !(await LibraryDB.getMeta('wh1'));
    $('downloadProgress').hidden=true; $('primaryBookAction').disabled=false;openSheet('book');
  }
  async function primaryAction(){if(!selected)return;
    if(savedIds.has(selected.id)){location.href=readerHref(selected);return;}
    if(!selected.parts.length){closeSheet('book');openSettings();say('Googleアカウントへの接続が必要です');return;}
    if(!tokenValid()){closeSheet('book');openSettings();say('先にGoogle Driveと接続してください');return;}
    await download(selected);
  }
  function readerHref(book){if(book.id==='uk-interiors')return `../british-interiors/full/?id=${encodeURIComponent(book.id)}`;return window.WH1ReaderRouting?.href(book)||`./read.html?id=${encodeURIComponent(book.id)}`;}
  async function deleteLocal(){if(!selected)return;
    if(!confirm(`${selected.title}の端末保存データを削除しますか？Google Driveの原本は消えません。`))return;
    try{await LibraryDB.removeBook(selected.id);savedIds.delete(selected.id);closeSheet('book');renderShelf();say('端末保存データを削除しました');}
    catch(e){say('削除できません: '+e.message);}
  }
  const tokenValid=()=>!!accessToken&&Date.now()<expiry;
  async function fetchPrivateCover(id){
    // No publicly accessible cover URL and no book bytes are sent to GitHub.
    if(!tokenValid() || !/^[A-Za-z0-9_-]{12,128}$/.test(id))return null;
    const res=await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
    const contentLength=Number(res.headers.get('content-length'));
    if(contentLength>15000000)throw Error('表紙の画像サイズが大きすぎます');
    const image=await res.blob();
    if(image.size>15000000)throw Error('表紙の画像サイズが大きすぎます');
    return image;
  }
  async function loadGoogleScript(){if(window.google?.accounts?.oauth2)return;
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;s.defer=true;
      s.onload=()=>window.google?.accounts?.oauth2?resolve():reject(new Error('Google認証が読み込まれません'));
      s.onerror=()=>reject(new Error('Google認証に接続できません。通信状態を確認してください'));
      document.head.append(s);
    });
  }
  async function googleSignIn(){const id=($('clientId').value||localStorage.getItem(CLIENT_KEY)||SHARED_CLIENT_ID||'').trim();
    if(!clientIdPattern.test(id)){openSettings();say('Googleのウェブ用OAuthクライアントIDを設定してください');return;}
    localStorage.setItem(CLIENT_KEY,id);
    if(!window.google?.accounts?.oauth2){
      setCloud('Google認証を準備中','読み込み完了後にもう一度接続してください');
      try{await loadGoogleScript();say('Google認証の準備ができました。もう一度「接続」を押してください。');}
      catch(e){say('Google認証の準備に失敗：'+(e.message||e));}
      return;
    }
    try{setCloud('Googleに接続中','許可画面が表示される場合があります');
      // Must request an OAuth popup in the original user activation, not after an awaited script load.
      const result=await new Promise((resolve,reject)=>{
        tokenClient=google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPES,
          callback:r=>r?.access_token?resolve(r):reject(new Error(r?.error_description||r?.error||'認証がキャンセルされました')),
          error_callback:e=>reject(new Error(e?.message||e?.type||'認証画面を開けません'))});
        tokenClient.requestAccessToken({prompt:accessToken?'':'consent'});
      });
      accessToken=result.access_token;expiry=Date.now()+Math.max(30,Number(result.expires_in||3600)-60)*1000;
      closeSettings();setCloud('Google Driveに接続済み','書籍データは非公開のままです',true);
      await refreshCloud();
    }catch(e){setCloud('Google Driveと未接続',e.message||'接続できません');say('Google連携: '+(e.message||String(e)));}
  }
  async function driveRequest(url,signal=null){if(!tokenValid())throw new Error('Google Driveに再接続してください');
    const r=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`},signal,cache:'no-store'});
    if(r.status===401){accessToken=null;throw new Error('Googleの認証期限が切れました。再接続してください');}
    if(!r.ok){let detail='';try{const j=await r.json();detail=j.error?.message||'';}catch(_){}
      throw new Error(`Google Drive API エラー ${r.status}${detail?'：'+detail:''}`);}
    return r;
  }
  function escapeQ(s){return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
  async function listFolder(){let token='',all=[];
    do{const p=new URLSearchParams({q:`'${escapeQ(ROOT_ID)}' in parents and trashed=false`,pageSize:'1000',fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime)',orderBy:'name',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
      if(token)p.set('pageToken',token);
      const res=await driveRequest('https://www.googleapis.com/drive/v3/files?'+p);
      const j=await res.json();all=all.concat(j.files||[]);token=j.nextPageToken||'';
    }while(token&&all.length<25000);
    return all;
  }
  function discoveredBooks(files) {
    const singles=[],groups=new Map();
    for(const f of files){
      if(/\.zip$/i.test(f.name||'')){
        const b=safeBook({id:`g_${f.id}`,title:normalizeTitle(f.name),subtitle:'Google Driveの統合ZIP',totalBytes:Number(f.size),parts:[{id:f.id,name:f.name,size:Number(f.size)}]});
        if(b)singles.push(b);
      }else{
        const m=String(f.name||'').match(/^(.*)\.part(\d{2,3})$/i);
        if(m){const key=m[1],g=groups.get(key)||[];g.push({index:Number(m[2]),id:f.id,name:f.name,size:Number(f.size)});groups.set(key,g);}
      }
    }
    for(const [base,group] of groups){group.sort((a,b)=>a.index-b.index);
      if(group.length<2||group.some((p,i)=>p.index!==i+1)||group.some(p=>!Number.isFinite(p.size)||p.size<=0))continue;
      const uk=base.includes('英国のインテリア史')&&base.includes('一冊統合読書版')&&group.length===4;
      const b=uk?safeBook({id:'uk-interiors',title:'図説 英国のインテリア史',subtitle:'全82枚・通し番号で一冊読書',
        status:'読書版統合済み／独立全文字校正は継続中',scans:82,parts:group,
        totalBytes:group.reduce((sum,p)=>sum+p.size,0)}):
        safeBook({id:`g_${group[0].id}`,title:normalizeTitle(base),subtitle:`Google Drive／${group.length}分割`,parts:group,
        totalBytes:group.reduce((sum,p)=>sum+p.size,0)});if(b)singles.push(b);
    }
    return singles;
  }
  async function refreshCloud(){if(isRefreshing)return;
    if(!tokenValid()){openSettings();say('Google Driveへの接続が必要です');return;}
    isRefreshing=true;$('refreshButton').disabled=true;setCloud('本棚を同期中','Google Drive内の書籍を確認しています',true);
    try{
      const files=await listFolder();const indexFile=files.find(f=>f.name==='bookshelf.json');
      let catalog=[];
      if(indexFile){const res=await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(indexFile.id)}?alt=media`);
        const json=await res.json();if(json?.schema===1&&Array.isArray(json.books))catalog=json.books.map(safeBook).filter(Boolean);
      }
      const found=discoveredBooks(files);
      const seen=new Set();books=[];
      for(const b of [...catalog,...found]){if(seen.has(b.id))continue;seen.add(b.id);books.push(b);}
      if(!books.some(x=>x.id==='wh1'))books.unshift(PREVIEW);
      if(!books.some(x=>x.id===UK_PREVIEW.id))books.push(UK_PREVIEW);
      books.sort((a,b)=>a.id==='wh1'?-1:b.id==='wh1'?1:a.title.localeCompare(b.title,'ja'));
      await refreshSaved();setCloud('Google Driveに接続済み',`${books.length}冊の書籍を同期しました`,true);
    }catch(e){setCloud('同期できませんでした',e.message||'再接続をお試しください');say('同期エラー: '+(e.message||String(e)));}
    finally{isRefreshing=false;$('refreshButton').disabled=false;}
  }
  async function assertZip(blob){
    if(blob.size<22)throw new Error('統合ZIPのサイズが小さすぎます');
    const first=new DataView(await blob.slice(0,4).arrayBuffer());
    if(first.getUint32(0,true)!==0x04034b50)throw new Error('ZIP先頭のデータが正しくありません');
    const tail=new DataView(await blob.slice(Math.max(0,blob.size-70000)).arrayBuffer());
    let valid=false;for(let i=tail.byteLength-22;i>=0;i--){if(tail.getUint32(i,true)===0x06054b50){valid=true;break;}}
    if(!valid)throw new Error('ZIPの終端が見つかりません。分割ファイルを確認してください');
  }
  async function download(book){const ctrl=new AbortController();pendingDownload=ctrl;
    $('primaryBookAction').disabled=true;$('downloadProgress').hidden=false;$('cancelDownload').disabled=false;
    let writer;try{writer=await LibraryDB.newWriter(book);}catch(e){pendingDownload=null;$('primaryBookAction').disabled=false;say('端末保存を開始できません：'+(e.message||e));return;}
    const total=book.parts.reduce((s,p)=>s+p.size,0);let done=0;
    const update=(i,partDone=0)=>{const current=done+partDone;const ratio=Math.max(0,Math.min(100,Math.round(current/total*100)));
      $('progressBar').style.width=ratio+'%';$('progressLabel').textContent=`Google Driveから保存中：${i}/${book.parts.length}　${nice(current)} / ${nice(total)}（${ratio}%）`;
    };
    let committed=false;
    try{
      for(let i=0;i<book.parts.length;i++){
        if(ctrl.signal.aborted)throw new DOMException('中止しました','AbortError');
        const p=book.parts[i];update(i+1,0);
        const res=await driveRequest(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.id)}?alt=media`,ctrl.signal);
        let partDone=0,buf=new Uint8Array(LibraryDB.CHUNK),used=0;
        async function absorb(bytes){let offset=0;
          while(offset<bytes.byteLength){const n=Math.min(LibraryDB.CHUNK-used,bytes.byteLength-offset);
            buf.set(bytes.subarray(offset,offset+n),used);used+=n;offset+=n;partDone+=n;
            if(used===LibraryDB.CHUNK){await writer.write(new Blob([buf]));buf=new Uint8Array(LibraryDB.CHUNK);used=0;}
            if(partDone%1048576<bytes.byteLength)update(i+1,partDone);
          }
        }
        if(res.body?.getReader){const reader=res.body.getReader();
          while(true){const {value,done:end}=await reader.read();if(end)break;if(ctrl.signal.aborted)throw new DOMException('中止しました','AbortError');await absorb(value);}
        }else await absorb(new Uint8Array(await res.arrayBuffer()));
        if(used)await writer.write(new Blob([buf.subarray(0,used)]));
        if(partDone!==p.size)throw new Error(`分割ファイル ${i+1} のデータ量が一致しません（${partDone} / ${p.size}）`);
        done+=partDone;update(i+1,0);
      }
      if(book.totalBytes&&book.totalBytes!==done)throw new Error('統合書籍の合計サイズが一致しません');
      await writer.commit(done);committed=true;
      // Check local readback and ZIP envelope before claiming success.
      const verify=await LibraryDB.readBlob(book.id);if(!verify||verify.blob.size!==done)throw new Error('保存後のデータ確認に失敗しました');
      await assertZip(verify.blob);
      savedIds.add(book.id);renderShelf();$('detailStatus').textContent='端末に保存しました。次回から自動で開けます。';
      $('progressLabel').textContent='保存完了。読書画面を開きます。';
      location.href=readerHref(book);
    }catch(e){if(committed)await LibraryDB.removeBook(book.id).catch(()=>{});else await writer.abort();$('primaryBookAction').disabled=false;
      if(e.name==='AbortError'){$('detailStatus').textContent='ダウンロードを中止しました。';say('ダウンロードを中止しました');}
      else{$('detailStatus').textContent='保存できませんでした：'+(e.message||e);say('保存エラー：'+(e.message||e));}
      $('downloadProgress').hidden=true;
    }finally{pendingDownload=null;}
  }
  function registerSW(){if('serviceWorker' in navigator&&location.protocol==='https:')
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});
  }
  $('settingsButton').onclick=openSettings;$('connectButton').onclick=()=>tokenValid()?refreshCloud():openSettings();
  $('settingsClose').onclick=closeSettings;$('settingsBackdrop').onclick=closeSettings;
  $('saveClientId').onclick=googleSignIn;
  $('refreshButton').onclick=()=>tokenValid()?refreshCloud():openSettings();
  $('searchInput').addEventListener('input',renderShelf);
  $('bookClose').onclick=()=>{if(pendingDownload){say('保存を中止してから閉じてください');return;}closeSheet('book');};
  $('bookBackdrop').onclick=()=>{if(!pendingDownload)closeSheet('book');};
  $('primaryBookAction').onclick=primaryAction;
  $('cancelDownload').onclick=()=>pendingDownload?.abort();
  $('removeBook').onclick=deleteLocal;
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&!pendingDownload){closeSettings();closeSheet('book');}});
  renderShelf();refreshSaved().catch(()=>{});registerSW();
  if(localStorage.getItem(CLIENT_KEY)||SHARED_CLIENT_ID)setCloud('フラッシュカードのGoogle設定を利用','「接続する」で書籍フォルダの読み取り権限を許可してください');
  if(!navigator.onLine)setCloud('オフライン','端末に保存済みの本は読めます');
})();

