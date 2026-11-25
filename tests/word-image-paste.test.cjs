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
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
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
function setup(fetchImage, { clipboard, userAgent } = {}) {
  const result = { saves: [], network: [] };
  const root = {
    Blob, URL, atob,
    navigator: { ...(clipboard ? { clipboard } : {}), ...(userAgent ? { userAgent } : {}) },
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
  return { result, editor, zone, paste, panel: container.children[0] };
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

test('iPhone clipboard PNG with an empty MIME type is preserved and added', async () => {
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
  const blob = new Blob([bytes], { type: '' });
  const app = setup(async () => { throw Error('must not fetch'); });
  const prevented = app.paste({ items: [{ kind: 'file', type: '', getAsFile: () => blob }] });
  await app.editor.ready();
  assert.equal(prevented(), true);
  assert.equal(app.result.saves.length, 1);
  assert.equal(app.result.saves[0].type, 'image/png');
  assert.deepEqual(Buffer.from(await app.result.saves[0].arrayBuffer()), Buffer.from(bytes));
  app.editor.destroy();
});

test('paste with unrecognized clipboard text allows iOS native insertion, then reports MIME-only diagnostics', async () => {
  const app = setup(async () => { throw Error('must not fetch'); });
  const prevented = app.paste({ plain: 'website copied rich content', items: [{ kind: 'string', type: 'text/plain' }] });
  assert.equal(prevented(), false);
  assert.equal(app.zone.attrs.inputmode, undefined);
  const node = new Element('span');
  node.textContent = 'native pasted content';
  app.zone.appendChild(node);
  app.zone.textContent = 'native pasted content';
  await app.editor.ready();
  const diagnostic = app.zone.parent.children.find(x => x.className.includes('word-image-paste-diagnostic'));
  assert.equal(diagnostic.hidden, false);
  assert.match(diagnostic.textContent, /text\/plain/);
  assert.equal(app.editor.getImages().length, 0);
  app.editor.destroy();
});

test('paste button reads image URL text if browser lacks rich clipboard.read()', async () => {
  const app = setup(async () => imageResponse, {
    clipboard: { async readText() { return 'https://images.example.test/copied.png'; } }
  });
  const toolbar = app.zone.parent.children.find(x => x.className === 'word-image-toolbar');
  toolbar.children[1].onclick();
  await app.editor.ready();
  assert.equal(app.result.saves.length, 1);
  assert.equal(app.editor.getImages().length, 1);
  app.editor.destroy();
});

test('unsupported iPhone clipboard image format returns an actionable error without saving', async () => {
  const blob = new Blob([Uint8Array.from([73, 73, 42, 0, 1, 2])], { type: 'image/tiff' });
  const app = setup(async () => { throw Error('must not fetch'); });
  const prevented = app.paste({ items: [{ kind: 'file', type: 'image/tiff', getAsFile: () => blob }] });
  await assert.rejects(app.editor.ready(), /コピーされた画像の形式を読み取れません/);
  assert.equal(prevented(), true);
  assert.equal(app.result.saves.length, 0);
  app.editor.destroy();
});

test('clipboard.read() with no items shows diagnostic and file-picker fallback', async () => {
  const app = setup(async () => { throw Error('unexpected network'); }, {
    clipboard: { async read() { return []; } }
  });
  app.panel.children.find(x => x.className === 'word-image-toolbar').children[1].onclick();
  await app.editor.ready();
  const diagnostic = app.panel.children.find(x => x.className.includes('word-image-paste-diagnostic'));
  const picker = app.panel.children.find(x => x.className.includes('word-image-pick-instead'));
  assert.equal(diagnostic.hidden, false);
  assert.match(diagnostic.textContent, /クリップボードの項目が0件/);
  assert.match(diagnostic.textContent, /画像データが0件/);
  assert.equal(picker.hidden, false);
  assert.equal(app.editor.getImages().length, 0);
  app.editor.destroy();
});

test('clipboard.read() with text-only data reports MIME type but not copied content', async () => {
  const secret = 'secret token in copied page';
  const app = setup(async () => { throw Error('unexpected network'); }, {
    clipboard: { async read() { return [{ types: ['text/plain'], async getType() { return new Blob([secret], { type: 'text/plain' }); } }]; } }
  });
  app.panel.children.find(x => x.className === 'word-image-toolbar').children[1].onclick();
  await app.editor.ready();
  const diagnostic = app.panel.children.find(x => x.className.includes('word-image-paste-diagnostic'));
  assert.equal(diagnostic.hidden, false);
  assert.match(diagnostic.textContent, /text\/plain/);
  assert.doesNotMatch(diagnostic.textContent, /secret token/);
  assert.equal(app.result.saves.length, 0);
  app.editor.destroy();
});

test('clipboard.read() permissions error shows specific diagnostic', async () => {
  const app = setup(async () => { throw Error('unexpected network'); }, {
    clipboard: { async read() { throw Error('NotAllowedError'); } }
  });
  app.panel.children.find(x => x.className === 'word-image-toolbar').children[1].onclick();
  await app.editor.ready();
  const diagnostic = app.panel.children.find(x => x.className.includes('word-image-paste-diagnostic'));
  assert.equal(diagnostic.hidden, false);
  assert.match(diagnostic.textContent, /アクセス制限/);
  app.editor.destroy();
});

test('clipboard.read() image success leaves version marker without failure message', async () => {
  const app = setup(async () => { throw Error('unexpected network'); }, {
    clipboard: { async read() {
      return [{ types: ['image/png'], async getType(type) { return new Blob(['synthetic fixture'], { type }); } }];
    } }
  });
  app.panel.children.find(x => x.className === 'word-image-toolbar').children[1].onclick();
  await app.editor.ready();
  const diagnostic = app.panel.children.find(x => x.className.includes('word-image-paste-diagnostic'));
  assert.equal(diagnostic.hidden, false);
  assert.match(diagnostic.textContent, /貼り付け機能 paste7/);
  assert.doesNotMatch(diagnostic.textContent, /利用できる画像データが0件/);
  assert.equal(app.result.saves.length, 1);
  assert.equal(app.editor.getImages().length, 1);
  app.editor.destroy();
});

test('paste7 build and device API capability are visible before any clipboard operation', async () => {
  const app = setup(async () => { throw Error('unexpected network'); });
  const diagnostic = app.panel.children.find(x => x.className.includes('word-image-paste-diagnostic'));
  assert.equal(diagnostic.hidden, false);
  assert.match(diagnostic.textContent, /貼り付け機能 paste7/);
  assert.match(diagnostic.textContent, /画像API:非対応/);
  assert.match(diagnostic.textContent, /文字API:非対応/);
  assert.equal(app.result.saves.length, 0);
  app.editor.destroy();
});

test('failed clipboard read keeps a visible diagnostic when ready() is called repeatedly', async () => {
  const app = setup(async () => { throw Error('unexpected network'); }, {
    clipboard: { async read() { return []; } }
  });
  app.panel.children.find(x => x.className === 'word-image-toolbar').children[1].onclick();
  await app.editor.ready();
  const diagnostic = app.panel.children.find(x => x.className.includes('word-image-paste-diagnostic'));
  assert.match(diagnostic.textContent, /貼り付け診断 paste7/);
  assert.equal(diagnostic.hidden, false);
  await app.editor.ready();
  assert.equal(diagnostic.hidden, false);
  assert.match(diagnostic.textContent, /画像データが0件/);
  app.editor.destroy();
});

test('iPhone Chrome button focuses native paste field, avoiding unsupported automatic clipboard reads', async () => {
  let readCalls = 0;
  const app = setup(async () => { throw Error('No network requests expected'); }, {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
    clipboard: { async read() { readCalls++; throw Error('iOS denied image clipboard'); } }
  });
  const pasteButton = app.panel.children.find(el => el.className === 'word-image-toolbar').children[1];
  assert.equal(pasteButton.textContent, 'ペースト欄へ');
  pasteButton.onclick();
  await app.editor.ready();
  const status = app.panel.children.find(el => el.className === 'word-image-feedback').children[0];
  assert.match(status.textContent, /長押しし、「ペースト」/);
  assert.equal(app.zone.focused, true);
  assert.equal(app.zone.scrolledIntoView, true);
  assert.equal(readCalls, 0, 'iOS Chrome must use native paste rather than a denied clipboard API');
  assert.equal(app.editor.getImages().length, 0, 'tapping shortcut does not fake image insertion');
  const diagnostic = app.panel.children.find(el => el.className.includes('word-image-paste-diagnostic'));
  assert.doesNotMatch(diagnostic.textContent, /読み取りが拒否されました|画像データが0件/);
  app.editor.destroy();
});

test('native paste still saves an image after tapping the iPhone Chrome paste-field shortcut', async () => {
  const app = setup(async () => { throw Error('No network request expected'); }, {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) CriOS/130.0 Safari/604.1',
    clipboard: { async read() { throw Error('Direct read must not be invoked'); } }
  });
  const button = app.panel.children.find(el => el.className === 'word-image-toolbar').children[1];
  button.onclick();
  const file = new Blob(['synthetic image data'], { type: 'image/png' });
  const prevented = app.paste({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] });
  await app.editor.ready();
  assert.equal(prevented(), true);
  assert.equal(app.result.saves.length, 1);
  assert.equal(app.editor.getImages().length, 1);
  app.editor.destroy();
});
