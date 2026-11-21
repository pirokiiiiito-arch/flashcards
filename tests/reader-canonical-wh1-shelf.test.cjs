'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../reader/library/read.html'), 'utf8');
const profileCheck = source.slice(source.indexOf('function usesPresidentsTemplate()'), source.indexOf('function usesWh3StandardInput()'));
const decorator = source.slice(source.indexOf('function decorateOtherBookReading(html)'), source.indexOf('async function openSegment(index'));
const recovery = source.slice(source.indexOf('async function recoverSavedBook()'), source.indexOf("window.addEventListener('pageshow',recoverSavedBook)"));
const id = 'us-presidents-south';
const manifest = {bookId: id, template_profile: 'world_history_1', canonicalTemplate: 'wh1-0011-0030'};
const input = '<html><head><style>body{font-size:20px}</style></head><body><main>Example</main></body></html>';

function decorate(bookId, bookManifest) {
  return vm.runInNewContext(profileCheck + decorator + '\ndecorateOtherBookReading(input)', {BOOK_ID: bookId, manifest: bookManifest, input});
}

test('an explicitly bound WH1 segment passes through the bookshelf without supplemental styling', () => {
  assert.equal(decorate(id, manifest), input);
  assert.equal(decorate('wh1', {bookId: 'wh1'}), input);
  for (const [bookId, bookManifest] of [
    ['another-book', manifest],
    [id, {...manifest, bookId: 'another-book'}],
    [id, {...manifest, canonicalTemplate: ''}],
    [id, {...manifest, template_profile: 'novel'}],
  ]) {
    assert.match(decorate(bookId, bookManifest), /id="bookshelf-other-books-wh1-layout"/);
  }
});

test('the new catalog ID follows its normal reader link to WH1 v9 with its parameters intact', async () => {
  const location = new URL('https://example.test/reader/library/read.html?id=' + id + '&s=1#mark');
  let destination;
  location.replace = value => { destination = value.href; };
  await vm.runInNewContext(recovery + '\nrecoverSavedBook()', {BOOK_ID: id, location, URL});
  assert.equal(destination, 'https://example.test/reader/library/read-wh1-v9.html?id=' + id + '&s=1#mark');
});
