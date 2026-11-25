/* Card image controls. Draft edits stay local until the card's Save action. */
(function (root) {
  'use strict';
  const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
  const PASTE_VERSION = 'paste7';
  const copy = images => root.WordImages.normalizeImages(images).map(image => ({ ...image }));
  const stop = event => event.stopPropagation();
  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function button(text, className = '') {
    const element = make('button', 'word-image-button ' + className, text);
    element.type = 'button';
    return element;
  }
  function mark(element) {
    element.setAttribute('data-image-ui', '');
    element.addEventListener('click', stop);
    return element;
  }
  function showImage(url, image, onClosed) {
    const previousFocus = document.activeElement;
    const dialog = mark(make('dialog', 'word-image-dialog'));
    dialog.setAttribute('aria-label', 'カードの画像');
    const bar = make('div', 'word-image-dialog-bar');
    const title = make('div', 'word-image-dialog-title', image.name || 'カードの画像');
    const close = button('閉じる');
    const picture = make('img', 'word-image-full');
    picture.src = url;
    picture.alt = image.name || 'カードの画像';
    picture.draggable = false;
    bar.append(title, close);
    dialog.append(bar, picture);
    document.body.appendChild(dialog);
    let closed = false;
    function cleanup() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', escape);
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      onClosed?.();
    }
    function dismiss() {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      cleanup();
    }
    function escape(event) { if (event.key === 'Escape') dismiss(); }
    close.onclick = dismiss;
    dialog.addEventListener('close', cleanup);
    dialog.addEventListener('click', event => { if (event.target === dialog) dismiss(); });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); document.addEventListener('keydown', escape); }
    close.focus({ preventScroll: true });
    return dismiss;
  }

  function render(container, images) {
    const list = copy(images);
    const gallery = mark(make('div', 'word-image-gallery'));
    container.appendChild(gallery);
    let alive = true;
    const urls = new Set(), viewers = new Set(), retryTasks = new Set();
    for (const [index, image] of list.entries()) {
      const figure = make('figure', 'word-image-item');
      const open = button('', 'word-image-open');
      open.setAttribute('aria-label', (image.name || '画像 ' + (index + 1)) + 'を拡大');
      const picture = make('img', 'word-image-picture');
      picture.alt = image.name || 'カードの画像 ' + (index + 1);
      picture.draggable = false;
      picture.decoding = 'async';
      const caption = make('span', 'word-image-zoom-hint', 'タップで拡大');
      const status = make('p', 'word-image-load-status', '画像を読み込み中…');
      status.setAttribute('role', 'status');
      const retry = button('画像を再読込');
      retry.hidden = true;
      open.hidden = true;
      open.append(picture, caption);
      figure.append(open, status, retry);
      gallery.appendChild(figure);
      let url = '', loading = false, failed = false;
      function clearURL() {
        if (url) { root.URL.revokeObjectURL(url); urls.delete(url); url = ''; }
      }
      function fail(error) {
        if (!alive) return;
        failed = true;
        open.hidden = true;
        status.hidden = false;
        status.textContent = error?.message || '画像を表示できません。接続後に再読込してください。';
        status.classList.add('word-image-error');
        retry.hidden = false;
        clearURL();
      }
      async function load() {
        if (!alive || loading) return;
        loading = true;
        failed = false;
        status.hidden = false;
        status.textContent = '画像を読み込み中…';
        status.classList.remove('word-image-error');
        retry.hidden = true;
        try {
          const blob = await root.WordImages.getBlob(image);
          if (!alive) return;
          clearURL();
          url = root.URL.createObjectURL(blob);
          urls.add(url);
          picture.onload = () => {
            if (!alive) return;
            open.hidden = false;
            status.hidden = true;
          };
          picture.onerror = () => fail(Error('画像を表示できません。画像ファイルを確認してください。'));
          picture.src = url;
        } catch (error) { fail(error); }
        finally { loading = false; }
      }
      open.onclick = () => {
        if (!url || !alive) return;
        const dismiss = showImage(url, image, () => viewers.delete(dismiss));
        viewers.add(dismiss);
      };
      retry.onclick = load;
      retryTasks.add(() => { if (failed) load(); });
      load();
    }
    const retryFailed = () => retryTasks.forEach(retry => retry());
    root.addEventListener('online', retryFailed);
    root.addEventListener('word-images-ready', retryFailed);
    function destroy() {
      if (!alive) return;
      alive = false;
      root.removeEventListener('online', retryFailed);
      root.removeEventListener('word-images-ready', retryFailed);
      for (const dismiss of viewers) dismiss();
      viewers.clear();
      for (const url of urls) root.URL.revokeObjectURL(url);
      urls.clear();
      gallery.remove();
    }
    return { destroy };
  }

  function edit(container, images, options = {}) {
    let draft = copy(images), alive = true, busy = 0, lastError = null;
    let queue = Promise.resolve(), preview = null, replaceAt = -1;
    const pasteTarget = options.pasteTarget || container;
    const panel = mark(make('section', 'word-image-editor'));
    panel.setAttribute('aria-label', '裏面の画像');
    const heading = make('div', 'word-image-editor-title', '裏面の画像');
    const toolbar = make('div', 'word-image-toolbar');
    const add = button('画像を追加', 'word-image-add');
    const paste = button('画像を貼り付け', 'word-image-paste-button');
    toolbar.append(add, paste);
    const picker = make('input');
    picker.type = 'file'; picker.accept = ACCEPT; picker.multiple = true; picker.hidden = true;
    picker.setAttribute('aria-label', '裏面に追加する画像');
    const replacePicker = make('input');
    replacePicker.type = 'file'; replacePicker.accept = ACCEPT; replacePicker.hidden = true;
    replacePicker.setAttribute('aria-label', '差し替える画像');
    const hint = make('p', 'word-image-help', 'PNG・JPEG・WebP・GIF ／ 1枚20MBまで');
    const pasteHint = make('p', 'word-image-help', '画像をコピーして、下の欄にペーストします。PCはCtrl+V／⌘Vでも貼り付けできます。');
    // A real rich-text editing host exposes the system paste menu and can receive
    // image data even when the browser does not allow navigator.clipboard.read().
    const pasteZone = make('div', 'word-image-paste-zone');
    pasteZone.contentEditable = 'true';
    pasteZone.setAttribute('role', 'textbox');
    pasteZone.setAttribute('aria-label', '画像専用の貼り付け欄');
    pasteZone.setAttribute('data-placeholder', 'ここを長押ししてペースト');
    // Do not force inputmode=none: iOS WebKit sometimes suppresses its native Paste action.
    pasteZone.spellcheck = false;
    pasteZone.tabIndex = 0;
    const feedback = make('div', 'word-image-feedback');
    const status = make('p', 'word-image-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const dismiss = button('閉じる', 'word-image-dismiss'); dismiss.hidden = true;
    feedback.append(status, dismiss);
    const pasteDiagnostic = make('p', 'word-image-help word-image-paste-diagnostic');
    // Show the build marker throughout editing so stale WebView cache is visible.
    pasteDiagnostic.textContent = '貼り付け機能 ' + PASTE_VERSION + ' ／ コピーした内容は記録しません';
    pasteDiagnostic.hidden = false;
    const pickInstead = button('写真・ファイルから追加', 'word-image-add word-image-pick-instead');
    pickInstead.hidden = true;
    pickInstead.onclick = () => choose();
    const gallery = make('div', 'word-image-edit-gallery');
    panel.append(heading, toolbar, picker, replacePicker, pasteHint, pasteZone, hint, feedback, pasteDiagnostic, pickInstead, gallery);
    container.appendChild(panel);
    function report(message, error = null) {
      if (!alive) return;
      lastError = error;
      // Never erase a diagnostic merely because another async status update arrived.
      status.textContent = message && message.includes('クリップボードから画像データを取得できませんでした')
        ? message + ' ［' + PASTE_VERSION + '］' : message;
      status.classList.toggle('word-image-error', !!error);
      dismiss.hidden = !error;
    }
    function clearPasteDiagnostic() {
      pasteDiagnostic.textContent = '貼り付け機能 ' + PASTE_VERSION + ' ／ コピーした内容は記録しません';
      pasteDiagnostic.hidden = false;
      pickInstead.hidden = true;
    }
    function updateBusy() {
      if (!alive) return;
      panel.setAttribute('aria-busy', busy ? 'true' : 'false');
      for (const control of panel.querySelectorAll('button,input')) control.disabled = busy > 0;
      pasteZone.setAttribute('aria-busy', busy ? 'true' : 'false');
      options.onBusy?.(busy > 0);
    }
    function redraw() {
      preview?.destroy(); preview = null;
      gallery.replaceChildren();
      if (!draft.length) {
        gallery.appendChild(make('p', 'word-image-empty', '画像はまだありません。'));
        updateBusy();
        return;
      }
      const controllers = [];
      draft.forEach((image, index) => {
        const item = make('div', 'word-image-edit-item');
        const top = make('div', 'word-image-item-tools');
        top.appendChild(make('span', 'word-image-item-label', '画像 ' + (index + 1)));
        const replace = button('差し替え');
        const remove = button('削除', 'word-image-remove');
        replace.setAttribute('aria-label', '画像 ' + (index + 1) + 'を差し替え');
        remove.setAttribute('aria-label', '画像 ' + (index + 1) + 'を削除');
        replace.onclick = () => { if (!alive || busy) return; replaceAt = index; replacePicker.value = ''; replacePicker.click(); };
        remove.onclick = () => {
          if (!alive || busy) return;
          draft = draft.filter((_, at) => at !== index);
          report('画像を削除しました。「保存」で確定します。');
          redraw(); options.onChange?.(copy(draft));
        };
        top.append(replace, remove); item.appendChild(top); gallery.appendChild(item);
        controllers.push(render(item, [image]));
      });
      preview = { destroy: () => controllers.forEach(controller => controller.destroy()) };
      updateBusy();
    }
    function enqueue(operation) {
      if (!alive) return;
      busy++;
      report('画像を読み込み中…'); updateBusy();
      queue = queue.then(async () => {
        if (!alive) return;
        try { await operation(); }
        catch (error) { report(error?.message || '画像を追加できませんでした。', error instanceof Error ? error : Error(String(error))); }
        finally { busy--; updateBusy(); }
      });
    }
    async function saveFiles(files, at = -1) {
      if (!files.length) throw Error('コピーした画像が見つかりません。「画像を追加」から選択できます。');
      const stored = [];
      for (const file of files) {
        if (!alive) return;
        stored.push(await root.WordImages.storeFile(file));
      }
      if (!alive) return;
      if (at >= 0) draft = draft.map((image, index) => index === at ? stored[0] : image);
      else draft = draft.concat(stored);
      clearPasteDiagnostic();
      report((at >= 0 ? '画像を差し替えました。' : stored.length + '枚の画像を追加しました。') + '「保存」で確定します。');
      redraw(); options.onChange?.(copy(draft));
    }
    function choose() {
      if (!alive || busy) return;
      clearPasteDiagnostic(); picker.value = ''; picker.click();
    }
    add.onclick = choose;
    picker.onchange = () => {
      const files = Array.from(picker.files || []);
      picker.value = '';
      if (files.length) enqueue(() => saveFiles(files));
    };
    replacePicker.onchange = () => {
      const file = replacePicker.files?.[0], at = replaceAt;
      replaceAt = -1; replacePicker.value = '';
      if (file && at >= 0) enqueue(() => saveFiles([file], at));
    };
    dismiss.onclick = () => { clearPasteDiagnostic(); report(''); };
    const nativeHint = '下の欄を長押しして「ペースト」を選ぶか、「画像を追加」でファイルを選んでください。';
    const missingImage = 'クリップボードから画像データを取得できませんでした。';
    let lastClipboardTypes = '取得できた形式情報なし';
    function rememberClipboardTypes(data) {
      const types = new Set(Array.from(data?.types || []));
      for (const item of Array.from(data?.items || []))
        types.add((item.kind || '不明') + ':' + (item.type || '種類不明'));
      lastClipboardTypes = Array.from(types).slice(0, 8).join(', ') || '取得できた形式情報なし';
    }
    function reportUnreadable(reason) {
      report(missingImage + ' ' + nativeHint);
      pasteDiagnostic.textContent = '貼り付け診断 ' + PASTE_VERSION + '（内容は記録しません）：' + lastClipboardTypes + ' ／ ' + reason;
      pasteDiagnostic.hidden = false;
      pickInstead.hidden = false;
    }
    function recordClipboardItems(items) {
      const summary = [];
      for (const item of Array.from(items || [])) {
        const types = Array.from(item?.types || []).filter(type => typeof type === 'string');
        summary.push(types.length ? types.slice(0, 8).join(', ') : '形式不明');
      }
      lastClipboardTypes = summary.length ? summary.slice(0, 8).join(' | ') : 'クリップボードの項目が0件';
    }
    function diagnoseReadFailure(reason) {
      reportUnreadable(reason);
      pasteZone.focus({ preventScroll: true });
      revealPasteZone();
    }
    function revealPasteZone() {
      root.requestAnimationFrame(() => {
        if (alive && pasteZone.isConnected) pasteZone.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
    function fromDataURL(src) {
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/i.exec(src || '');
      if (!match) return null;
      const encoded = match[2].replace(/\s/g, '');
      if (encoded.length > Math.ceil(root.WordImages.MAX_BYTES / 3) * 4) throw Error('画像は1枚20MB以下にしてください。');
      let binary;
      try { binary = root.atob(encoded); } catch (_) { throw Error('コピーした画像のデータを読み取れませんでした。'); }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new root.Blob([bytes], { type: match[1].toLowerCase() });
    }
    function fromHTML(html) {
      if (!html || !/<img\b/i.test(html)) return [];
      // WebKit can expose clipboard images as blob URLs as well as data URLs.
      // A template is inert: never insert arbitrary pasted markup into the page.
      const template = document.createElement('template');
      template.innerHTML = html;
      return Array.from(template.content.querySelectorAll('img[src]')).map(img => img.getAttribute('src').trim());
    }
    function isLocalImageSource(src) {
      return /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(src) || /^blob:/i.test(src);
    }
    function isRemoteImageSource(src) {
      if (!/^https:\/\//i.test(src || '')) return false;
      try {
        const url = new root.URL(src);
        return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
      } catch (_) { return false; }
    }
    function isImageSource(src) { return isLocalImageSource(src) || isRemoteImageSource(src); }
    function extractSources(html, text = '') {
      const sources = fromHTML(html).filter(isImageSource);
      if (sources.length) return sources;
      const plain = (text || '').trim();
      return isImageSource(plain) ? [plain] : [];
    }
    const remoteUnavailable = '画像の提供元から直接取得できませんでした。画像を端末に保存し、「画像を追加」から選択してください。';
    async function readRemoteImage(src) {
      let response;
      try {
        response = await root.fetch(src, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      } catch (_) { throw Error(remoteUnavailable); }
      if (!response.ok || response.type === 'opaque') throw Error(remoteUnavailable);
      const type = (response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(?:png|jpeg|webp|gif)$/.test(type))
        throw Error('貼り付けたリンクは対応する画像ファイルではありません。「画像を追加」から選択してください。');
      const max = root.WordImages.MAX_BYTES;
      if (Number(response.headers?.get('content-length') || 0) > max)
        throw Error('画像は1枚20MB以下にしてください。');
      const reader = response.body?.getReader?.();
      if (!reader) {
        let blob;
        try { blob = await response.blob(); } catch (_) { throw Error(remoteUnavailable); }
        if (blob.size > max) throw Error('画像は1枚20MB以下にしてください。');
        return new root.Blob([blob], { type });
      }
      const chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > max) {
            await reader.cancel();
            throw Error('画像は1枚20MB以下にしてください。');
          }
          chunks.push(value);
        }
      } catch (error) {
        if (error?.message?.includes('20MB')) throw error;
        throw Error(remoteUnavailable);
      } finally { reader.releaseLock?.(); }
      return new root.Blob(chunks, { type });
    }
    async function readImageSources(sources) {
      const images = await Promise.all(sources.filter(isImageSource).map(async src => {
        const blob = fromDataURL(src);
        if (blob) return blob;
        if (isRemoteImageSource(src)) return readRemoteImage(src);
        // Blob URLs resolve only through the browser's own URL store.
        const response = await root.fetch(src, { credentials: 'omit' });
        if (!response.ok) throw Error(missingImage);
        return response.blob();
      }));
      return images.filter(Boolean);
    }
    function queueImageSources(sources) {
      // Start reads while clipboard Blob URLs are available, even if another
      // image is still saving. Attach rejection handling before joining the queue.
      const reading = readImageSources(sources).then(images => ({ images }), error => ({ error }));
      enqueue(async () => {
        const result = await reading;
        if (result.error) throw result.error;
        if (!result.images.length) { reportUnreadable('画像データが取得できませんでした'); return; }
        await saveFiles(result.images);
      });
    }
    function clipboardFiles(data) {
      const entries = Array.from(data?.items || []).filter(item => item.kind === 'file');
      const files = entries.map(item => {
        try { return item.getAsFile?.(); } catch (_) { return null; }
      }).filter(file => file && (!file.type || /^image\//i.test(file.type) || file.type === 'application/octet-stream'));
      return files.length ? files : Array.from(data?.files || [])
        .filter(file => file && (!file.type || /^image\//i.test(file.type) || file.type === 'application/octet-stream'));
    }
    async function normalizeClipboardFile(file) {
      if (/^image\/(?:png|jpeg|webp|gif)$/i.test(file.type || '')) return file;
      // Preserve original bytes. Some iOS clipboard PNGs have an empty MIME type.
      const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const ascii = start => String.fromCharCode(...header.subarray(start, start + 4));
      let type = '';
      if (header.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => header[i] === b)) type = 'image/png';
      else if (header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) type = 'image/jpeg';
      else if (ascii(0) === 'GIF8' && (header[4] === 55 || header[4] === 57) && header[5] === 97) type = 'image/gif';
      else if (ascii(0) === 'RIFF' && ascii(8) === 'WEBP') type = 'image/webp';
      if (!type) throw Error('コピーされた画像の形式を読み取れません。画像を端末に保存して「画像を追加」から選択してください。');
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[type];
      const name = (file.name || '').trim() || ('貼り付け画像' + ext);
      return typeof root.File === 'function'
        ? new root.File([file], name, { type })
        : new root.Blob([file], { type });
    }
    function readText(data, type) {
      try { return data?.getData(type) || ''; } catch (_) { return ''; }
    }
    paste.onclick = () => {
      if (!alive || busy) return;
      clearPasteDiagnostic();
      pasteGeneration++;
      if (!root.navigator.clipboard?.read) {
        let textRead;
        try { textRead = root.navigator.clipboard?.readText?.(); } catch (_) {}
        if (!textRead) {
          lastClipboardTypes = 'Clipboard APIが利用できません';
          diagnoseReadFailure('直接読み取りに非対応。下の欄の長押しを試してください');
          return;
        }
        enqueue(async () => {
          let value;
          try { value = await textRead; }
          catch (_) { lastClipboardTypes = '文字列の読み取りが拒否されました'; diagnoseReadFailure('ブラウザーのアクセス制限'); return; }
          const sources = extractSources('', value);
          if (!sources.length) {
            lastClipboardTypes = '文字列のみ、または空';
            reportUnreadable('Chromeから画像本体が渡されていません');
            pasteZone.focus({ preventScroll: true }); revealPasteZone(); return;
          }
          await saveFiles(await readImageSources(sources));
        });
        return;
      }
      // Start within the original button gesture; no delayed clipboard read.
      let reading;
      try { reading = root.navigator.clipboard.read(); }
      catch (_) { lastClipboardTypes = 'Clipboard APIが拒否しました'; diagnoseReadFailure('ブラウザーのアクセス制限'); return; }
      enqueue(async () => {
        let items;
        try { items = await reading; }
        catch (_) { lastClipboardTypes = 'Clipboard APIの読み取りが拒否されました'; diagnoseReadFailure('ブラウザーのアクセス制限'); return; }
        recordClipboardItems(items);
        const files = [];
        for (const item of items) {
          const types = Array.from(item.types || []);
          const type = types.find(type => /^image\/(png|jpeg|webp|gif)$/i.test(type));
          if (type) {
            try { files.push(await item.getType(type)); }
            catch (_) { diagnoseReadFailure('画像形式はありますが、画像本体の読み取りが拒否されました'); return; }
            continue;
          }
          let html = '', plain = '';
          try {
            if (types.includes('text/html')) html = await (await item.getType('text/html')).text();
            const textType = types.find(type => type === 'text/uri-list' || type === 'text/plain');
            if (textType) plain = await (await item.getType(textType)).text();
          } catch (_) { diagnoseReadFailure('コピー内容の読み取りが拒否されました'); return; }
          files.push(...await readImageSources(extractSources(html, plain)));
        }
        if (!files.length) { diagnoseReadFailure('利用できる画像データが0件でした'); return; }
        await saveFiles(await Promise.all(files.map(normalizeClipboardFile)));
      });
    };
    let pasteGeneration = 0;
    function pastedImages(event) {
      const generation = ++pasteGeneration;
      const inZone = pasteZone.contains(event.target);
      const data = event.clipboardData;
      if (inZone) clearPasteDiagnostic();
      rememberClipboardTypes(data);
      const files = clipboardFiles(data);
      if (files.length) {
        event.preventDefault(); event.stopPropagation();
        enqueue(async () => saveFiles(await Promise.all(files.map(normalizeClipboardFile)))); return;
      }
      const html = readText(data, 'text/html');
      const plain = readText(data, 'text/uri-list') || readText(data, 'text/plain');
      // Chrome on iPhone can expose an image item before getAsFile() is usable.
      // Allow the native editor to paste it instead of preemptively rejecting it.
      if (inZone && Array.from(data?.items || []).some(item => item.kind === 'file')) {
        event.stopPropagation();
        consumeNativeInsertion();
        root.setTimeout(() => {
          if (alive && generation === pasteGeneration && !pasteZone.querySelectorAll('img').length)
            reportUnreadable('画像ファイル項目はありますが、画像の中身を取得できません')
        }, 900);
        return;
      }
      const sources = extractSources(html, plain);
      if (sources.length) {
        event.preventDefault(); event.stopPropagation();
        queueImageSources(sources); return;
      }
      if (!inZone) return; // Ordinary text paste in the meaning field is unchanged.
      // Unknown clipboard types can still contain a native image on iOS.
      // Allow the editable host to receive that image before reporting failure.
      event.stopPropagation();
      root.setTimeout(() => {
        if (!alive || generation !== pasteGeneration) return;
        readNativeInsertion();
        if (generation === pasteGeneration)
          reportUnreadable('標準の貼り付けでも画像本体が挿入されません');
      }, 900);
    }
    let nativeInsertionTimer = null;
    function consumeNativeInsertion() {
      root.clearTimeout(nativeInsertionTimer);
      nativeInsertionTimer = root.setTimeout(readNativeInsertion, 50);
    }
    function readNativeInsertion() {
      nativeInsertionTimer = null;
      if (!alive || !pasteZone.childNodes.length) return;
      const pictures = Array.from(pasteZone.querySelectorAll('img'));
      // Native editors may create the element before assigning its image URL.
      // A later src mutation will retry; don't erase the unfinished insertion.
      if (pictures.some(img => !img.getAttribute('src')?.trim())) return;
      const sources = pictures.map(img => img.getAttribute('src').trim());
      if (!sources.length && !pasteZone.textContent.trim()) return; // Ignore caret BRs.
      pasteGeneration++;
      // Start reading before removing the browser-created image elements.
      const candidates = sources.length ? sources : extractSources('', pasteZone.textContent);
      if (candidates.some(isImageSource)) queueImageSources(candidates);
      else {
        const scheme = sources.length ? sources[0].split(':', 1)[0] : '画像要素なし';
        reportUnreadable('ブラウザーが取り出せない形式: ' + scheme);
      }
      pasteZone.replaceChildren();
    }
    // Do not block beforeinput: iOS may label an image insertion as insertText.
    pasteZone.addEventListener('input', consumeNativeInsertion);
    const pasteObserver = new root.MutationObserver(consumeNativeInsertion);
    pasteObserver.observe(pasteZone, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    function hasFiles(event) { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
    function dragOver(event) {
      if (!hasFiles(event)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
      panel.classList.add('word-image-dragover');
    }
    function dragLeave(event) { if (!panel.contains(event.relatedTarget)) panel.classList.remove('word-image-dragover'); }
    function dropped(event) {
      if (!hasFiles(event)) return;
      event.preventDefault(); event.stopPropagation(); panel.classList.remove('word-image-dragover');
      const files = Array.from(event.dataTransfer?.files || []);
      if (!busy && files.length) enqueue(() => saveFiles(files));
    }
    pasteTarget.addEventListener('paste', pastedImages);
    panel.addEventListener('dragover', dragOver);
    panel.addEventListener('dragleave', dragLeave);
    panel.addEventListener('drop', dropped);
    redraw();
    return {
      getImages: () => copy(draft),
      async ready() {
        if (Array.from(pasteZone.querySelectorAll('img')).some(img => !img.getAttribute('src')?.trim()))
          throw Error('画像の貼り付けが完了するまでお待ちください。');
        root.clearTimeout(nativeInsertionTimer);
        readNativeInsertion();
        await queue;
        if (!alive) throw Error('画像の編集は取り消されました。');
        if (lastError) throw lastError;
      },
      choose, revealPasteZone,
      destroy() {
        if (!alive) return;
        alive = false;
        root.clearTimeout(nativeInsertionTimer);
        pasteTarget.removeEventListener('paste', pastedImages);
        pasteObserver.disconnect();
        pasteZone.removeEventListener('input', consumeNativeInsertion);
        panel.removeEventListener('dragover', dragOver);
        panel.removeEventListener('dragleave', dragLeave);
        panel.removeEventListener('drop', dropped);
        preview?.destroy();
        panel.remove();
      }
    };
  }
  root.WordImageUI = Object.freeze({ render, edit });
})(window);
