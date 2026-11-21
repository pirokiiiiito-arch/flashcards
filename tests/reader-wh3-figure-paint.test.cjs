'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = process.env.READER_AUDIT_ROOT || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'reader/library/wh3-format.html'), 'utf8');
const artwork = html.slice(html.indexOf('const artworkCache='), html.indexOf('function render(){'));

function reader() {
  const requests = [];
  const drawn = [];
  const pages = [0, 1, 2, 3, 4].map(figure => ({kind: 'image', figure}));
  class FakeImage {
    constructor() { requests.push(this); }
    decode() { return new Promise(resolve => { this.decoded = resolve; }); }
  }
  const env = {
    Image: FakeImage, pages, index: 0,
    figures: pages.map(p => ({source: 'figure-' + p.figure}))
  };
  const api = vm.runInNewContext(artwork + `
    function render() {
      const p=pages[index],asset=pageArtwork(p);
      if(!waitingForArtwork(p,asset))draw(p,asset);
    }
    ({go(i){index=i;render()},warm(i){return pageArtwork(pages[i])},cacheSize(){return artworkCache.size}})
  `, {...env, draw: (p, asset) => drawn.push({figure:p.figure, asset})});
  async function finish(n) {
    const image = requests[n];
    image.naturalWidth = 320;
    const loading = image.onload();
    image.decoded();
    await loading;
    await Promise.resolve();
  }
  return {requests, drawn, finish, api};
}

test('an illustration and caption can commit only after its image has decoded', async () => {
  const {api, requests, drawn, finish} = reader();
  api.go(0);
  await finish(0);
  api.warm(1);
  api.go(1);
  const loading = requests[1].onload();
  assert.deepEqual(drawn.map(p => p.figure), [0]);
  requests[1].naturalWidth = 150;
  requests[1].decoded();
  await loading;
  await Promise.resolve();
  assert.deepEqual(drawn.map(p => p.figure), [0, 1]);
  assert.equal(drawn[1].asset.image, requests[1]);
  api.go(1);
  assert.equal(requests.length, 2);
  assert.equal(drawn[2].asset, drawn[1].asset);
});

test('a slow or failed image cannot overwrite a newer turn; the cache stays bounded', async () => {
  const {api, requests, drawn, finish} = reader();
  api.go(0);
  await finish(0);
  api.go(1);
  api.go(2);
  await finish(2);
  await finish(1);
  assert.deepEqual(drawn.map(p => p.figure), [0, 2]);
  api.go(3);
  requests[3].onerror();
  await Promise.resolve();
  assert.equal(drawn.at(-1).asset.failed, true);
  api.go(4);
  await finish(4);
  assert.equal(drawn.at(-1).figure, 4);
  assert.equal(api.cacheSize(), 3);
});
