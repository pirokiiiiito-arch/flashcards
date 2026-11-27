/* Bounded I/O for the gun-card sync core. This module owns no card data and
 * never clears a cache or acknowledges an upload. Failed/uncertain writes are
 * reported to the caller so its existing pending journal remains recoverable. */
(function (root) {
  'use strict';
  const NETWORK_TIMEOUT_MS = 45000, STORAGE_TIMEOUT_MS = 15000;
  const duration = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
  function failure(code, message, retryable = true, cause) {
    const error = new Error(message);
    error.code = code; error.retryable = retryable;
    if (cause !== undefined) error.cause = cause;
    return error;
  }
  function close(db) { try { db?.close(); } catch {} }
  function abort(tx) { try { tx?.abort(); } catch {} }
  function create(options = {}) {
    const networkTimeoutMs = duration(options.networkTimeoutMs, NETWORK_TIMEOUT_MS);
    const storageTimeoutMs = duration(options.storageTimeoutMs, STORAGE_TIMEOUT_MS);
    const fetcher = options.fetcher || (root.fetch && root.fetch.bind(root));
    const database = options.indexedDB || root.indexedDB;
    const setTimer = root.setTimeout.bind(root), clearTimer = root.clearTimeout.bind(root);

    function fetchResponse(url, requestOptions = {}) {
      return new Promise((resolve, reject) => {
        if (typeof fetcher !== 'function' || !root.AbortController || !root.Response) {
          reject(failure('gun_network_unavailable', 'このブラウザでは同期通信を開始できません。', false));
          return;
        }
        const controller = new root.AbortController(), external = requestOptions.signal;
        let settled = false, timer, phase = '接続';
        function finish(error, value) {
          if (settled) return false;
          settled = true; clearTimer(timer);
          external?.removeEventListener?.('abort', onExternalAbort);
          if (error) reject(error); else resolve(value);
          return true;
        }
        function stop(error) {
          if (finish(error)) { try { controller.abort(error); } catch { controller.abort(); } }
        }
        function onExternalAbort() {
          const error = failure('gun_request_aborted', '同期通信を中止しました。', false, external?.reason);
          error.name = 'AbortError'; stop(error);
        }
        if (external?.aborted) { onExternalAbort(); return; }
        external?.addEventListener?.('abort', onExternalAbort, {once: true});
        if (external?.aborted) { onExternalAbort(); return; }
        timer = setTimer(() => stop(failure('gun_network_timeout',
          'Google Driveへの' + phase + 'が時間内に完了しませんでした。通信を再試行できます。')), networkTimeoutMs);

        // Keep the deadline active through the complete response body. Returning
        // a buffered Response prevents json()/blob() callers from waiting on an
        // unbounded network stream after headers have already arrived.
        Promise.resolve().then(async () => {
          if (settled) return;
          const response = await fetcher(url, {...requestOptions, signal: controller.signal});
          if (settled) {
            try { await response.body?.cancel(); } catch {}
            return;
          }
          phase = '応答の読み込み';
          const bytes = await response.arrayBuffer();
          if (settled) return;
          const emptyBody = [204, 205, 304].includes(response.status);
          const buffered = new root.Response(emptyBody ? null : bytes, {
            status: response.status, statusText: response.statusText, headers: response.headers
          });
          finish(null, buffered);
        }).catch(cause => {
          if (settled) return;
          finish(failure(phase === '接続' ? 'gun_network_error' : 'gun_response_read_error',
            phase === '接続' ? 'Google Driveとの通信を開始できませんでした。通信状態を確認して再試行してください。'
              : 'Google Driveからの応答を読み込めませんでした。通信を再試行できます。', true, cause));
        });
      });
    }

    function openDB(name, version, onUpgrade) {
      return new Promise((resolve, reject) => {
        if (!database?.open) {
          reject(failure('gun_storage_unavailable', 'このブラウザでは端末の保存領域を開けません。', false));
          return;
        }
        let request, settled = false, timer;
        function finish(error, value) {
          if (settled) return false;
          settled = true; clearTimer(timer);
          if (error) reject(error); else resolve(value);
          return true;
        }
        function stop(error) {
          if (!finish(error)) return;
          try { abort(request?.transaction); } catch {}
          try { close(request?.result); } catch {}
        }
        timer = setTimer(() => stop(failure('gun_storage_open_timeout',
          '端末の保存領域を開く処理が時間内に完了しませんでした。再試行できます。')), storageTimeoutMs);
        try { request = database.open(name, version); }
        catch (cause) { stop(failure('gun_storage_open_error', '端末の保存領域を開けませんでした。', true, cause)); return; }
        request.onblocked = () => stop(failure('gun_storage_blocked',
          '端末の保存領域が別の画面の処理を待っています。ほかのカード画面を閉じて再試行してください。'));
        request.onupgradeneeded = () => {
          if (settled) {
            abort(request.transaction); close(request.result); return;
          }
          try { onUpgrade?.(request.result); }
          catch (cause) { stop(failure('gun_storage_upgrade_error', '端末の保存領域を準備できませんでした。', true, cause)); }
        };
        request.onsuccess = () => {
          const db = request.result;
          if (settled) { close(db); return; }
          db.onversionchange = () => close(db);
          finish(null, db);
        };
        request.onerror = () => stop(failure('gun_storage_open_error',
          '端末の保存領域を開けませんでした。', true, request.error));
      });
    }

    function transaction(db, store, mode, fn) {
      return new Promise((resolve, reject) => {
        let tx, request, settled = false, timer;
        function finish(error, value) {
          if (settled) return false;
          settled = true; clearTimer(timer);
          if (error) reject(error); else resolve(value);
          return true;
        }
        function stop(error) {
          if (!finish(error)) return;
          abort(tx); close(db);
        }
        timer = setTimer(() => stop(failure('gun_storage_transaction_timeout',
          '端末への保存・読み込みが時間内に完了しませんでした。再試行できます。')), storageTimeoutMs);
        try {
          tx = db.transaction(store, mode);
          tx.oncomplete = () => {
            if (settled) return;
            try { finish(null, request?.result); }
            catch (cause) { stop(failure('gun_storage_transaction_error', '端末の保存結果を読み込めませんでした。', true, cause)); }
          };
          tx.onerror = tx.onabort = () => stop(failure('gun_storage_transaction_error',
            '端末への保存・読み込みを完了できませんでした。', true, tx.error));
          request = fn(tx.objectStore(store));
        } catch (cause) {
          stop(failure('gun_storage_transaction_error', '端末の保存・読み込み処理を開始できませんでした。', true, cause));
        }
      });
    }
    return Object.freeze({fetchResponse, openDB, transaction});
  }
  const factory = Object.freeze({create, NETWORK_TIMEOUT_MS, STORAGE_TIMEOUT_MS});
  root.GunSyncIOFactory = factory;
  root.GunSyncIO = create();
  if (typeof module !== 'undefined' && module.exports) module.exports = factory;
})(typeof window !== 'undefined' ? window : globalThis);
