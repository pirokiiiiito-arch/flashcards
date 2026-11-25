/* Card image controls. Draft edits stay local until the card's Save action. */
(function (root) {
  'use strict';
  const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
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
    const paste = button('画像を貼り付け');
    toolbar.append(add, paste);
    const picker = make('input');
    picker.type = 'file'; picker.accept = ACCEPT; picker.multiple = true; picker.hidden = true;
    picker.setAttribute('aria-label', '裏面に追加する画像');
    const replacePicker = make('input');
    replacePicker.type = 'file'; replacePicker.accept = ACCEPT; replacePicker.hidden = true;
    replacePicker.setAttribute('aria-label', '差し替える画像');
    const hint = make('p', 'word-image-help', 'PNG・JPEG・WebP・GIF ／ 1枚20MBまで');
    const pasteHint = make('p', 'word-image-help', '画像をコピーして裏面に貼り付けるか、ここにドロップできます。');
    const feedback = make('div', 'word-image-feedback');
    const status = make('p', 'word-image-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const dismiss = button('閉じる', 'word-image-dismiss'); dismiss.hidden = true;
    feedback.append(status, dismiss);
    const gallery = make('div', 'word-image-edit-gallery');
    panel.append(heading, toolbar, picker, replacePicker, hint, pasteHint, feedback, gallery);
    container.appendChild(panel);
    function report(message, error = null) {
      if (!alive) return;
      lastError = error;
      status.textContent = message;
      status.classList.toggle('word-image-error', !!error);
      dismiss.hidden = !error;
    }
    function updateBusy() {
      if (!alive) return;
      panel.setAttribute('aria-busy', busy ? 'true' : 'false');
      for (const control of panel.querySelectorAll('button,input')) control.disabled = busy > 0;
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
      report((at >= 0 ? '画像を差し替えました。' : stored.length + '枚の画像を追加しました。') + '「保存」で確定します。');
      redraw(); options.onChange?.(copy(draft));
    }
    function choose() {
      if (!alive || busy) return;
      picker.value = ''; picker.click();
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
    dismiss.onclick = () => report('');
    paste.onclick = () => {
      if (!alive || busy) return;
      if (!root.navigator.clipboard?.read) {
        pasteTarget.querySelector('textarea')?.focus({ preventScroll: true });
        report('裏の意味欄で長押しして貼り付けるか、Ctrl+V／⌘Vを押してください。「画像を追加」でも選べます。');
        return;
      }
      // Start within the user gesture; Safari may reject a deferred read().
      let reading;
      try { reading = root.navigator.clipboard.read(); }
      catch (_) { report('貼り付けを許可するか、意味欄に画像を貼り付けてください。「画像を追加」でも選べます。'); return; }
      enqueue(async () => {
        let items;
        try { items = await reading; }
        catch (_) { throw Error('貼り付けを許可するか、意味欄に画像を貼り付けてください。「画像を追加」でも選べます。'); }
        const files = [];
        for (const item of items) {
          const type = item.types.find(type => /^image\//.test(type));
          if (type) files.push(await item.getType(type));
        }
        await saveFiles(files);
      });
    };
    function pastedImages(event) {
      let files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file' && /^image\//.test(item.type)).map(item => item.getAsFile()).filter(Boolean);
      if (!files.length) files = Array.from(event.clipboardData?.files || []).filter(file => /^image\//.test(file.type));
      if (!files.length) return; // Leave ordinary text paste in the meaning field intact.
      event.preventDefault(); event.stopPropagation();
      enqueue(() => saveFiles(files));
    }
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
        await queue;
        if (!alive) throw Error('画像の編集は取り消されました。');
        if (lastError) throw lastError;
      },
      choose,
      destroy() {
        if (!alive) return;
        alive = false;
        pasteTarget.removeEventListener('paste', pastedImages);
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
