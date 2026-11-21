'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const verticalReaderSymbols = require('../templates/reader/v2/vertical-symbols.js');

function reader(name) {
  const script = fs.readFileSync(path.join(__dirname, '../templates/reader/v2', name + '.js'), 'utf8');
  const source = script.slice(script.indexOf('let shownPage='), script.indexOf('function menuRefresh()'));
  const images = [];
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {id, classList: {toggle() {}}, style: {}, hidden: false,
      replaceWith(image) { nodes.set(id, image); }, removeAttribute() {}});
    return nodes.get(id);
  };
  class Picture {
    constructor() { images.push(this); }
    replaceWith(image) { nodes.set(this.id, image); }
    decode() { return new Promise((resolve, reject) => { this.ready = resolve; this.failed = reject; }); }
  }
  const api = new Function('$', 'Image', 'verticalReaderSymbols', `
    const book={},warning='',figures=[{source:'red',scan:2},{source:'blue',scan:3}];
    const pages=[{kind:'text',parts:[],scan:1},{kind:'image',figure:0,scan:2},
      {kind:'image',figure:1,scan:3},{kind:'text',parts:[],scan:4}];
    let index=0,activeFigure=-1,activeSrc=null,sourceURL=null,saved;
    const document={createDocumentFragment:()=>({})};
    const textFlow={replaceChildren(){}},caption={};
    function persist(){saved=shownPage.scan;}
    ${source}
    render();
    return {step:stepPage,goto:gotoPage,cancel:cancelPageTurn,
      state:()=>({index,scan:saved,pending:!!pendingPaint,text:!textFlow.hidden})};`);
  return {api:api(node, Picture, verticalReaderSymbols), node, images};
}

for (const name of ['standard', 'novel']) {
  test(name + ' displays and bookmarks only the last requested, decoded page', async () => {
    const {api, images, node} = reader(name);
    const label = () => node('page-major').textContent;
    api.step(1);
    assert.deepEqual(api.state(), {index:0, scan:1, pending:true, text:true});
    assert.equal(label(), '1 / 4');
    assert.equal(node('prev').disabled, false);
    api.step(-1);
    await images[0].onload();
    assert.equal(api.state().pending, false);
    api.step(1);
    const first = images[1].onload();
    api.step(1);
    const second = images[2].onload();
    images[2].naturalWidth = 80;
    images[2].ready();
    await second;
    images[1].ready();
    await first;
    assert.deepEqual(api.state(), {index:2, scan:3, pending:false, text:false});
    assert.equal(node('figure-image'), images[2]);
    assert.equal(label(), '3 / 4');

    api.step(-1);
    const failed = images[3].onload();
    images[3].failed(new Error('decode failed'));
    await failed;
    assert.equal(label(), '3 / 4');
    assert.equal(api.state().scan, 3);
    assert.equal(node('figure-image'), images[2]);
    api.step(-1);
    const retried = images[4].onload();
    images[4].naturalWidth = 90;
    images[4].ready();
    await retried;
    assert.equal(label(), '2 / 4');
    assert.equal(api.state().scan, 2);
    assert.equal(node('figure-image'), images[4]);
    api.step(1);
    api.cancel();
    await images[5].onload();
    assert.equal(label(), '2 / 4');
    api.step(1);
    api.step(1);
    await images[6].onload();
    assert.deepEqual(api.state(), {index:3, scan:4, pending:false, text:true});
  });
}
