/* Word-card images: immutable original bytes, local-first storage and portable JSON. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WordImages = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const MAX_BYTES = 20 * 1024 * 1024;
  const DB_NAME = 'flashcards_drive_cache_v3';
  const LOCAL_PREFIX = 'word-image:';
  const MIME = /^image\/(png|jpeg|webp|gif)$/;
  const LOCAL_REF = /^local:([a-f0-9]{64})$/;
  const DRIVE_REF = /^gdrive:([A-Za-z0-9_-]{1,256}):([a-f0-9]{64})$/;
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function fail(code, message, cause) {
    const error = new Error(message);
    error.code = code;
    if (cause) error.cause = cause;
    return error;
  }
  function imageName(name, type) {
    if (name === undefined || name === '') return '画像.' + (type === 'image/jpeg' ? 'jpg' : type.split('/')[1]);
    if (typeof name !== 'string' || /[\u0000-\u001f\u007f]/.test(name))
      throw fail('INVALID_NAME', '画像のファイル名を確認できません。');
    return name;
  }
  function parseRef(ref) {
    if (typeof ref === 'string') {
      const local = ref.match(LOCAL_REF);
      if (local) return { local: true, hash: local[1] };
      const drive = ref.match(DRIVE_REF);
      if (drive) return { local: false, hash: drive[2] };
    }
    throw fail('INVALID_REF', '画像の保存先情報が不正です。画像ファイルを追加し直してください。');
  }
  function normalizeImages(images) {
    if (images === undefined || images === null) return [];
    if (!Array.isArray(images)) throw fail('INVALID_IMAGES', '画像一覧の形式を確認できません。');
    return images.map(image => {
      if (!image || typeof image !== 'object' || Array.isArray(image))
        throw fail('INVALID_IMAGES', '画像情報の形式を確認できません。');
      parseRef(image.ref);
      if (typeof image.type !== 'string' || !MIME.test(image.type))
        throw fail('INVALID_TYPE', '画像はPNG・JPEG・WebP・GIFを選んでください。');
      return { ref: image.ref, name: imageName(image.name, image.type), type: image.type };
    });
  }
  function storageError(error) {
    if (typeof error?.code === 'string' && error.code.startsWith('IMAGE_STORAGE')) return error;
    return error?.name === 'QuotaExceededError'
      ? fail('IMAGE_STORAGE_FULL', '端末の保存容量が不足しているため、画像を保存できませんでした。空き容量を増やしてから再試行してください。', error)
      : fail('IMAGE_STORAGE_UNAVAILABLE', 'このブラウザーに画像を保存・読込できません。ブラウザーの保存設定を確認して再試行してください。', error);
  }
  function openDB() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(storageError()); return; }
      let request, settled = false;
      try { request = root.indexedDB.open(DB_NAME, 1); }
      catch (error) { reject(storageError(error)); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('states')) db.createObjectStore('states');
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => { settled = true; reject(storageError(request.error)); };
      request.onblocked = () => {
        settled = true;
        reject(fail('IMAGE_STORAGE_BLOCKED', '画像の保存先を開けませんでした。ほかの単語帳タブを閉じて再試行してください。'));
      };
    });
  }
  async function readLocal(hash) {
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readonly');
        const request = tx.objectStore('blobs').get(LOCAL_PREFIX + hash);
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(storageError(tx.error || request.error));
      });
    } catch (error) { throw storageError(error); }
    finally { db.close(); }
  }
  async function writeLocal(entries) {
    if (!entries.length) return;
    const db = await openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        let requestError;
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(storageError(tx.error || requestError));
        try {
          const store = tx.objectStore('blobs');
          for (const [hash, blob] of entries) {
            const request = store.put(blob, LOCAL_PREFIX + hash);
            request.onerror = () => { requestError = request.error; };
          }
        } catch (error) {
          try { tx.abort(); } catch (_) { /* An already-aborted transaction is still a failed save. */ }
          reject(storageError(error));
        }
      });
    } catch (error) { throw storageError(error); }
    finally { db.close(); }
  }
  function signature(bytes) {
    const prefix = (...values) => values.every((value, i) => bytes[i] === value);
    const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
    if (bytes.length >= 24 && prefix(137, 80, 78, 71, 13, 10, 26, 10) && ascii(12, 4) === 'IHDR') return 'image/png';
    if (bytes.length >= 4 && prefix(255, 216, 255)) return 'image/jpeg';
    if (bytes.length >= 13 && /^(GIF87a|GIF89a)$/.test(ascii(0, 6))) return 'image/gif';
    if (bytes.length >= 20 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && /^(VP8 |VP8L|VP8X)$/.test(ascii(12, 4))) return 'image/webp';
    return '';
  }
  async function validateBlob(blob, expectedType, expectedHash) {
    if (!(blob instanceof root.Blob)) throw fail('INVALID_BLOB', '画像ファイルを読み込めません。');
    if (!blob.size) throw fail('EMPTY_IMAGE', '空の画像ファイルは追加できません。');
    if (blob.size > MAX_BYTES) throw fail('IMAGE_TOO_LARGE', '画像は1枚20MB以下にしてください。');
    if (!MIME.test(blob.type) || (expectedType && blob.type !== expectedType))
      throw fail('INVALID_TYPE', '画像はPNG・JPEG・WebP・GIFを選んでください。画像情報とファイル形式が一致する必要があります。');
    let bytes;
    try { bytes = new Uint8Array(await blob.arrayBuffer()); }
    catch (error) { throw fail('IMAGE_READ_FAILED', '画像ファイルを読み込めませんでした。ファイルを選び直してください。', error); }
    if (signature(bytes) !== blob.type)
      throw fail('INVALID_SIGNATURE', '画像の内容とファイル形式が一致しません。元のPNG・JPEG・WebP・GIFファイルを選んでください。');
    if (!root.crypto?.subtle) throw fail('HASH_UNAVAILABLE', '画像の検証を利用できません。HTTPSの単語帳を開いてください。');
    const hash = [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (expectedHash && hash !== expectedHash)
      throw fail('HASH_MISMATCH', '画像の保存データが一致しません。元の画像を追加し直すか、Driveから再取得してください。');
    return hash;
  }
  async function verifyDecoding(blob) {
    let bitmapError;
    if (typeof root.createImageBitmap === 'function') {
      let bitmap;
      try {
        bitmap = await root.createImageBitmap(blob);
        if (!(bitmap.width > 0 && bitmap.height > 0)) throw new Error('Empty image dimensions');
        return;
      } catch (error) { bitmapError = error; }
      finally { bitmap?.close?.(); }
    }
    // Some browsers cannot create a bitmap for a format their <img> supports.
    // Decoding only reads the original Blob; no canvas or re-encoding is used.
    if (typeof root.Image === 'function' && typeof root.URL?.createObjectURL === 'function') {
      let url;
      try {
        url = root.URL.createObjectURL(blob);
        await new Promise((resolve, reject) => {
          const image = new root.Image();
          image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve() : reject(new Error('Empty image dimensions'));
          image.onerror = () => reject(new Error('Browser image decoding failed'));
          image.src = url;
        });
        return;
      } catch (error) {
        throw fail('IMAGE_DECODE_FAILED', '画像ファイルを表示できません。ファイルが壊れていないか確認し、元の画像を選び直してください。', error);
      } finally { if (url) root.URL.revokeObjectURL(url); }
    }
    if (bitmapError)
      throw fail('IMAGE_DECODE_FAILED', '画像ファイルを表示できません。ファイルが壊れていないか確認し、元の画像を選び直してください。', bitmapError);
    // Node has no browser decoder. Signature, MIME and SHA checks still run.
  }
  async function storeFile(file) {
    const hash = await validateBlob(file);
    const image = { ref: 'local:' + hash, name: imageName(file.name, file.type), type: file.type };
    await verifyDecoding(file);
    await writeLocal([[hash, file]]);
    return image;
  }
  async function getBlob(image, api = root.WordDriveSync) {
    const normalized = normalizeImages([image])[0], ref = parseRef(normalized.ref);
    let blob = await readLocal(ref.hash);
    if (blob) {
      await validateBlob(blob, normalized.type, ref.hash);
      return blob;
    }
    if (ref.local) throw fail('LOCAL_IMAGE_MISSING', 'この画像の元データが端末にありません。画像入りの保存JSONを読み込むか、画像を追加し直してください。');
    if (typeof api?.getBlob !== 'function')
      throw fail('DRIVE_IMAGE_UNAVAILABLE', 'この画像を読み込むにはGoogle Driveへの接続が必要です。接続してから再試行してください。');
    blob = await api.getBlob(normalized.ref);
    await validateBlob(blob, normalized.type, ref.hash);
    await writeLocal([[ref.hash, blob]]);
    return blob;
  }
  async function toCloudImages(images, api = root.WordDriveSync) {
    const result = [];
    for (const image of normalizeImages(images)) {
      const ref = parseRef(image.ref);
      if (!ref.local) { result.push(image); continue; }
      if (typeof api?.putBlob !== 'function')
        throw fail('DRIVE_UPLOAD_UNAVAILABLE', '画像は端末に保存されています。Google Driveに接続すると画像も同期できます。');
      const blob = await getBlob(image, api);
      const uploaded = await api.putBlob(blob), parsed = parseRef(uploaded);
      if (parsed.local || parsed.hash !== ref.hash)
        throw fail('DRIVE_IMAGE_MISMATCH', 'Driveへの画像保存結果が元の画像と一致しません。画像の同期を完了できませんでした。');
      result.push({ ...image, ref: uploaded });
    }
    return result;
  }
  function encodeData(bytes, type) {
    // Each chunk is a multiple of three, so only the final base64 chunk is padded.
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += 24576)
      parts.push(root.btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
    return 'data:' + type + ';base64,' + parts.join('');
  }
  function decodeData(data, type) {
    const header = 'data:' + type + ';base64,';
    if (typeof data !== 'string' || !data.startsWith(header))
      throw fail('INVALID_IMAGE_DATA', '保存JSONの画像本体または形式が不正です。画像を含めて保存したJSONを選んでください。');
    const encoded = data.slice(header.length);
    if (encoded.length > Math.ceil(MAX_BYTES / 3) * 4) throw fail('IMAGE_TOO_LARGE', '保存JSONの画像は1枚20MB以下にしてください。');
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const payload = encoded.slice(0, encoded.length - padding);
    if (!encoded.length || encoded.length % 4 || /[^A-Za-z0-9+/]/.test(payload)
      || (padding === 2 && (BASE64.indexOf(payload.at(-1)) & 15))
      || (padding === 1 && (BASE64.indexOf(payload.at(-1)) & 3)))
      throw fail('INVALID_IMAGE_DATA', '保存JSONの画像データが壊れています。元の保存JSONを選び直してください。');
    let binary;
    try { binary = root.atob(encoded); }
    catch (error) { throw fail('INVALID_IMAGE_DATA', '保存JSONの画像データを復元できません。', error); }
    if (!binary.length || binary.length > MAX_BYTES) throw fail('IMAGE_TOO_LARGE', '保存JSONの画像は1枚20MB以下にしてください。');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new root.Blob([bytes], { type });
  }
  function cardText(card, imageCount) {
    if (!card || typeof card !== 'object' || Array.isArray(card)
      || typeof card.word !== 'string' || !card.word.trim() || typeof card.meaning !== 'string'
      || (!card.meaning.trim() && !imageCount))
      throw fail('INVALID_CARD', 'カードには単語と、意味または画像を入力してください。保存JSONの形式を確認してください。');
    return { word: card.word, meaning: card.meaning };
  }
  async function exportCards(cards, api = root.WordDriveSync) {
    if (!Array.isArray(cards)) throw fail('INVALID_CARDS', '単語帳データはカードの配列である必要があります。');
    const result = [];
    for (const card of cards) {
      const images = normalizeImages(card?.images), copy = cardText(card, images.length);
      if (images.length) {
        copy.images = [];
        for (const image of images) {
          const blob = await getBlob(image, api);
          copy.images.push({ name: image.name, type: image.type, data: encodeData(new Uint8Array(await blob.arrayBuffer()), image.type) });
        }
      }
      result.push(copy);
    }
    return result;
  }
  async function importCards(cards) {
    if (!Array.isArray(cards)) throw fail('INVALID_CARDS', '保存JSONはカードの配列である必要があります。');
    const result = [], entries = new Map();
    // Validate the entire backup before opening the single atomic write transaction.
    // The caller replaces its card metadata only after this promise succeeds.
    for (const card of cards) {
      const images = card?.images === undefined || card?.images === null ? [] : card.images;
      if (!Array.isArray(images)) throw fail('INVALID_IMAGES', '保存JSONの画像一覧の形式を確認できません。');
      const copy = { ...cardText(card, images.length), images: [] };
      for (const image of images) {
        if (!image || typeof image !== 'object' || Array.isArray(image) || typeof image.type !== 'string'
          || !MIME.test(image.type) || Object.prototype.hasOwnProperty.call(image, 'ref'))
          throw fail('INVALID_IMAGE_DATA', '保存JSONには画像本体が必要です。PNG・JPEG・WebP・GIFを含む保存JSONを選んでください。');
        const name = imageName(image.name, image.type), blob = decodeData(image.data, image.type);
        const hash = await validateBlob(blob, image.type);
        if (!entries.has(hash)) await verifyDecoding(blob);
        entries.set(hash, blob);
        copy.images.push({ ref: 'local:' + hash, name, type: image.type });
      }
      result.push(copy);
    }
    await writeLocal([...entries]);
    return result;
  }
  return Object.freeze({ MAX_BYTES, normalizeImages, storeFile, getBlob, toCloudImages, exportCards, importCards });
});
