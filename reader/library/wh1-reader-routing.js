/* Pure bookshelf routing. Book IDs and their existing storage keys are kept. */
'use strict';
((root) => {
  const ENTRY = 'read-wh1-v9.html';
  const titleKey = title => typeof title === 'string' ? title.normalize('NFKC').replace(/\s+/g, '') : '';
  const isBook = book => !!book && (book.id === 'wh1' || titleKey(book.title) === '世界の歴史1');
  const isManifest = manifest => !!manifest && titleKey(manifest.title) === '世界の歴史1' &&
    Array.isArray(manifest.range) && manifest.range.length === 2 && manifest.range[0] === 1 && manifest.range[1] === 274 &&
    Array.isArray(manifest.segments) && manifest.segments.length === 14;
  const href = book => './' + (isBook(book) ? ENTRY : 'read.html') + '?id=' + encodeURIComponent(String(book?.id ?? ''));
  function compatibilityHref({pathname, id, manifest, isSaved = false}) {
    // Only the legacy generic reader forwards. The generated WH1 entry uses
    // the same reader code and must never forward to itself.
    if (typeof pathname !== 'string' || !/(?:^|\/)read\.html$/.test(pathname)) return null;
    if (id === 'wh1' || (isSaved && isManifest(manifest))) return href({id, title: '世界の歴史1'});
    return null;
  }
  const api = Object.freeze({isBook, isManifest, href, compatibilityHref});
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WH1ReaderRouting = api;
})(typeof window === 'object' ? window : globalThis);
