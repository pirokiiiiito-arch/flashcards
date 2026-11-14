/* Pure bookshelf routing. Book IDs and their existing storage keys are kept. */
'use strict';
((root) => {
  // All bookshelf titles, including WH1, use the existing shared reader.
  // The former read-wh1-v9.html target is absent from the deployed repository.
  const ENTRY = 'read.html';
  const titleKey = title => typeof title === 'string' ? title.normalize('NFKC').replace(/\s+/g, '') : '';
  const isBook = book => !!book && (book.id === 'wh1' || titleKey(book.title) === '世界の歴史1');
  const isManifest = manifest => !!manifest && titleKey(manifest.title) === '世界の歴史1' &&
    Array.isArray(manifest.range) && manifest.range.length === 2 && manifest.range[0] === 1 && manifest.range[1] === 274 &&
    Array.isArray(manifest.segments) && manifest.segments.length === 14;
  const href = book => './' + (isBook(book) ? ENTRY : 'read.html') + '?id=' + encodeURIComponent(String(book?.id ?? ''));
  function compatibilityHref(_options) {
    // No redirect: sending read.html back to itself would cause a loop.
    // The common reader already supports the WH1 manifest and stored ZIP.
    return null;
  }
  const api = Object.freeze({isBook, isManifest, href, compatibilityHref});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WH1ReaderRouting = api;
})(typeof window === 'object' ? window : globalThis);
