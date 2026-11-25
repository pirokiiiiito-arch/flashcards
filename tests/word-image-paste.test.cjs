'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const uiCode = fs.readFileSync(path.join(__dirname, '..', 'word-images-ui.js'), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.className = ''; this.children = []; this.parent = null;
    this.listeners = {}; this.attrs = {}; this.textContent = ''; this.isConnected = true;
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  get childNodes() { return this.children; }
  append(...items) {
    for (const item of items) if (item && typeof item === 'object') {
      item.parent = this; this.children.push(item);
    }
  }
  appendChild(item) { this.append(item); return item; }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key] || null; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  removeEventListener(type) { delete this.listeners[type]; }
  contains(item) {
    for (let x = item; x; x = x.parent) if (x === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    const out = [];
    function walk(el) {
      if ((selector === 'img' && el.tag === 'img') ||
          (selector === 'button,input' && ['button', 'input'].includes(el.tag))) out.push(el);
      el.children.forEach(walk);
    }
    walk(this);
    return out;
  }
  focus() {}
  scrollIntoView() {}
  remove() {}
  click() {}
}
class Template extends Element {
  set innerHTML(html) {
    this.content = {
      querySelectorAll() {
        return [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
          .map(match => ({ getAttribute: () => match[1] }));
      }
    };
  }
}
function setup(fetchImage) {
  const result = { saves: [], network: [] };
  const root = {
    Blob, URL, atob,
    navigator: {},
    WordImages: {
      MAX_BYTES: 20 * 1024 * 1024,
      normalizeImages: images => images || [],
      async storeFile(file) {
        result.saves.push(file);
        return { ref: 'local:synthetic', name: 'sample.png', type: file.type };
      },
      async getBlob() { throw Error('Mock display unavailable'); }
    },
    async fetch(url, opts) { result.network.push({ url, opts }); return fetchImage(); },
    setTimeout: () => 0, clearTimeout() {},
    requestAnimationFrame(fn) { fn(); },
    addEventListener() {}, removeEventListener() {},
    MutationObserver: class { observe() {} disconnect() {} }
  };
  const doc = { createElement: tag => tag === 'template' ? new Template(tag) : new Element(tag), body: new Element('body') };
  vm.runInNewContext(uiCode, { window: root, document: doc });
  const container = new Element(), target = new Element();
  const editor = root.WordImageUI.edit(container, [], { pasteTarget: target });
  const zone = container.children[0].children.find(item => item.className === 'word-image-paste-zone');
  function paste({ html = '', plain = '', items = [], destination = zone } = {}) {
    let prevented = false;
    target.listeners.paste({
      target: destination,
      clipboardData: {
        items, files: [],
        getData(type) { return type === 'text/html' ? html : type === 'text/plain' ? plain : ''; }
      },
      preventDefault() { prevented = true; },
      stopPropagation() {}
    });
    return () => prevented;
  }
  return { result, editor, zone, paste };
}
const imageResponse = {
  ok: true, type: 'cors', body: null,
  headers: { get(name) { return name === 'content-type' ? 'image/png' : null; } },
  async blob() { return new Blob(['PNG synthetic'], { type: 'image/png' }); }
};

test('pasted HTML image URL is imported with a credential-free CORS request', async () => {
  const app = setup(async () => imageResponse);
  const prevented = app.paste({ html: '<img src="https://images.example.test/image.png">' });
  await app.editor.ready();
  assert.equal(prevented(), true);
  assert.equal(app.result.saves.length, 1);
  assert.equal(app.editor.getImages().length, 1);
  assert.equal(app.result.network[0].opts.credentials, 'omit');
  assert.equal(app.result.network[0].opts.referrerPolicy, 'no-referrer');
  app.editor.destroy();
});

test('pasted plain image URL is imported when the URL serves an image', async () => {
  const app = setup(async () => imageResponse);
  const prevented = app.paste({ plain: 'https://images.example.test/image.png' });
  await app.editor.ready();
  assert.equal(prevented(), true);
  assert.equal(app.result.saves.length, 1);
  app.editor.destroy();
});

test('opaque image clipboard item permits native iPhone Chrome image insertion', async () => {
  const app = setup(async () => { throw Error('unexpected network request'); });
  const prevented = app.paste({
    html: '<img src="https://images.example.test/image.png">',
    items: [{ kind: 'file', type: 'image/png', getAsFile() { return null; } }]
  });
  const image = new Element('img');
  image.setAttribute('src', 'data:image/png;base64,QUJDRA==');
  app.zone.appendChild(image);
  await app.editor.ready();
  assert.equal(prevented(), false);
  assert.equal(app.result.network.length, 0);
  assert.equal(app.result.saves.length, 1);
  app.editor.destroy();
});

test('CORS failure leaves card images untouched and returns a usable error', async () => {
  const app = setup(async () => { throw Error('CORS blocked'); });
  app.paste({ html: '<img src="https://images.example.test/denied.png">' });
  await assert.rejects(app.editor.ready(), /画像の提供元から直接取得できませんでした/);
  assert.equal(app.editor.getImages().length, 0);
  assert.equal(app.result.saves.length, 0);
  app.editor.destroy();
});

test('ordinary meaning field text paste is not intercepted', async () => {
  const app = setup(async () => { throw Error('must not fetch'); });
  const prevented = app.paste({ plain: '一般的な意味の説明', destination: new Element('textarea') });
  await app.editor.ready();
  assert.equal(prevented(), false);
  assert.equal(app.result.network.length, 0);
  app.editor.destroy();
});
