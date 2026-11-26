'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
const ui = read('word-images-ui.js');
const css = read('word-images.css');
const html = read('index.html');

test('single-tap image has no modal, zoom action, or instructional text', () => {
  assert.doesNotMatch(ui, /function showImage\s*\(/);
  assert.doesNotMatch(ui, /open\.onclick\s*=/);
  assert.doesNotMatch(ui, /enablePinchZoom/);
  assert.doesNotMatch(ui, /ピンチで拡大・縮小|タップで拡大/);
  assert.doesNotMatch(css, /word-image-zoom-hint|word-image-dialog/);
  assert.match(ui, /const open = make\('div', 'word-image-open'\)/);
  assert.match(ui, /const gallery = make\('div', 'word-image-gallery'\)/);
  assert.doesNotMatch(ui, /const gallery = mark\(make\('div', 'word-image-gallery'\)\)/);
  assert.match(ui, /open\.append\(picture\);/);
  assert.match(ui, /open\.setAttribute\('aria-label', image\.name \|\| '画像 ' \+ \(index \+ 1\)\)/);
});

test('picture, frame, card and back scroller allow native whole-page pinch zoom', () => {
  assert.match(css, /\.word-image-open\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(css, /\.word-image-picture\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(html, /\.card\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(html, /\.back-content\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  const initialViewport = html.match(/<meta name="viewport"[^>]*>/)?.[0] || '';
  assert.doesNotMatch(initialViewport, /user-scalable=no|maximum-scale=1/,
    'only the temporary front-flip reset may clamp browser page zoom');
  assert.match(html, /viewportMeta\.content='width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,viewport-fit=cover'/);
});

test('the application never intercepts native image pinch gestures', () => {
  assert.doesNotMatch(ui, /touchstart|touchmove|gesturestart|gesturechange|gestureend/);
  assert.doesNotMatch(ui, /preventDefault\(\).*pinch|scale\(/);
  assert.doesNotMatch(css, /transform-origin:center center|will-change:transform/);
  const start = ui.indexOf('  function render(container, images) {');
  const end = ui.indexOf('\n  function edit(container, images, options = {}) {', start);
  assert.ok(start >= 0 && end > start);
  const render = ui.slice(start, end);
  assert.doesNotMatch(render, /touch(start|move)|gesture(start|change)|preventDefault\(\)/);
  assert.match(render, /const gallery = make\('div', 'word-image-gallery'\)/);
  assert.match(ui, /element\.addEventListener\('click', stop\)/,
    'editing controls continue to stop clicks; study gallery does not');
});

test('photo data, loading and retry remain intact while whole-page zoom is browser owned', () => {
  assert.match(ui, /const blob = await root\.WordImages\.getBlob\(image\)/);
  assert.match(ui, /url = root\.URL\.createObjectURL\(blob\)/);
  assert.match(ui, /picture\.src = url/);
  assert.match(ui, /retry\.onclick = load/);
  assert.match(ui, /for \(const url of urls\) root\.URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(ui, /pinchControllers|zoom\.reset\(/);
});

test('native one-finger vertical scroll and back-to-front reset remain available', () => {
  assert.match(html, /if\(card\.classList\.contains\("show-back"\)&&e\.target\.closest\("\.back-content"\)\)/);
  assert.match(html, /function resetWordBackScroll\(card\)\{/);
  assert.match(html, /if\(!openBack\)resetWordBackScroll\(card\)/);
  assert.match(html, /if\(openBack\)resetWordBackScroll\(card\)/);
  assert.match(html, /\.card:not\(\.show-back\) \.back-content\{overflow-y:hidden\}/);
  assert.match(html, /\.back-content\{[^}]*overflow-y:auto/);
});



test('magnified browser page can pan over images, while normal view keeps horizontal swipe navigation', () => {
  assert.match(html, /function syncWordZoomedTouchPolicy\(\)\{/);
  assert.match(html, /\.word-page-zoomed \.card,\.word-page-zoomed \.back-content\{touch-action:auto\}/);
  assert.match(css, /\.word-page-zoomed \.word-image-open,\.word-page-zoomed \.word-image-picture\{touch-action:auto\}/);
  const start=html.indexOf('function syncWordZoomedTouchPolicy(){');
  const end=html.indexOf('\nfunction returnWordPageToNormalView(){',start);
  const src=html.slice(start,end);
  assert.ok(start>0&&end>start);
  const state={zoomed:false};
  const doc={documentElement:{classList:{toggle(name,enabled){
    assert.equal(name,'word-page-zoomed');
    state.zoomed=!!enabled;
  }}}};
  const context={document:doc,window:{visualViewport:{scale:1}}};
  const zoomPolicy=vm.runInNewContext(src+'\n(syncWordZoomedTouchPolicy)',context);
  zoomPolicy();
  assert.equal(state.zoomed,false);
  context.window.visualViewport.scale=2.25;
  zoomPolicy();
  assert.equal(state.zoomed,true);
  context.window.visualViewport.scale=1;
  zoomPolicy();
  assert.equal(state.zoomed,false);
});

test('photo tap flips its card, while editing controls and multi-touch gestures do not', () => {
  const start = html.indexOf(' card.addEventListener("click",e=>{');
  const end = html.indexOf('\n card.addEventListener("selectstart"', start);
  assert.ok(start >= 0 && end > start, 'use actual study-card click logic');
  let click, flips = 0;
  const context = {
    card: { addEventListener(type, callback) { if (type === 'click') click = callback; } },
    editing: false, suppressClickUntil: 0, touchTapHandled: false, imageTapBlocked: false,
    allowAction() { return true; },
    flipWordCardFace() { flips++; }
  };
  vm.runInNewContext(html.slice(start, end), context);
  assert.equal(typeof click, 'function');

  const imageTarget = {
    closest(selector) {
      if (selector === '.word-image-open') return { className: 'word-image-open' };
      if (selector === 'button,textarea,input,[data-image-ui]') return { dataset: { imageUi: '' } };
      return null;
    }
  };
  click({ target: imageTarget });
  assert.equal(flips, 1, 'a photo tap reaches the card despite the image-area ancestor');

  context.imageTapBlocked = true;
  click({ target: imageTarget });
  assert.equal(flips, 1, 'pinch/vertical swipe must not act like a tap');
  context.imageTapBlocked = false;

  const editingControl = { closest(selector) {
    return selector === '.word-image-open' ? null : {};
  } };
  click({ target: editingControl });
  assert.equal(flips, 1, 'button and editing UI clicks never flip a card');

  context.editing = true;
  click({ target: imageTarget });
  assert.equal(flips, 1, 'image taps in edit mode do not interrupt editing');
});

function gestureFixture() {
  const html=read('index.html');
  const start=html.indexOf(' let imageTapBlocked=false,imageTouchOrigin=null;');
  const end=html.indexOf(' card.addEventListener("pointerdown"',start);
  assert.ok(start>=0&&end>start,'extract actual back-image gesture handling');
  const handlers=new Map(),passive=new Map();
  let renders=0;
  const context={
    card:{
      classList:{contains:name=>name==='show-back'},
      addEventListener(type,handler,opts){handlers.set(type,handler);passive.set(type,opts?.passive)}
    },
    editing:false,window:{visualViewport:{scale:1}},
    order:[0,1,2],pos:1,cards:[{}, {}, {}],
    touchTapHandled:true,suppressClickUntil:500,
    render(){renders++}
  };
  const sandbox=vm.createContext(context);
  vm.runInContext(html.slice(start,end),sandbox);
  const target={closest(name){
    if(name==='.back-content'||name==='.word-image-open')return {};
    return null;
  }};
  const touch=(x,y)=>({identifier:1,clientX:x,clientY:y});
  function fire(type,coords,extras={}) {
    let prevented=false;
    const handler=handlers.get(type);
    assert.equal(typeof handler,'function','missing '+type);
    const event={
      target,touches:coords.map(([x,y])=>touch(x,y)),
      changedTouches:(extras.changed||coords).map(([x,y])=>touch(x,y)),
      cancelable:true,
      preventDefault(){prevented=true}
    };
    handler(event);
    return prevented;
  }
  return {
    context,sandbox,handlers,passive,fire,
    get renders(){return renders},
    blocked:()=>vm.runInContext('imageTapBlocked',sandbox)
  };
}

test('one-finger horizontal swipe on a photo moves to the next or previous card', () => {
  const f=gestureFixture();
  assert.equal(f.passive.get('touchstart'),true);
  assert.equal(f.passive.get('touchmove'),true);
  assert.equal(f.passive.get('touchend'),false);
  f.fire('touchstart',[[240,210]]);
  f.fire('touchmove',[[125,214]]);
  const prevented=f.fire('touchend',[],{changed:[[125,214]]});
  assert.equal(prevented,true,'recognized horizontal swipe is handled as card navigation');
  assert.equal(f.context.pos,2);
  assert.equal(f.renders,1);
  assert.equal(f.blocked(),true,'synthesized click after swipe must not flip a card');

  f.fire('touchstart',[[110,210]]);
  f.fire('touchmove',[[230,212]]);
  f.fire('touchend',[],{changed:[[230,212]]});
  assert.equal(f.context.pos,1);
  assert.equal(f.renders,2,'right swipe navigates backward');
});

test('vertical swipe on a photo continues native image scrolling without moving cards', () => {
  const f=gestureFixture();
  f.fire('touchstart',[[170,250]]);
  f.fire('touchmove',[[171,130]]);
  const prevented=f.fire('touchend',[],{changed:[[171,130]]});
  assert.equal(prevented,false);
  assert.equal(f.renders,0);
  assert.equal(f.context.pos,1);
  assert.equal(f.blocked(),true,'vertical gesture must not trigger a tap flip');
});

test('pinch and zoomed-page horizontal gestures never navigate or cancel browser zoom', () => {
  const f=gestureFixture();
  f.fire('touchstart',[[170,250]]);
  f.fire('touchstart',[[145,250],[215,250]]);
  assert.equal(f.blocked(),true);
  const prevented=f.fire('touchend',[],{changed:[[110,250]]});
  assert.equal(prevented,false);
  assert.equal(f.renders,0);

  f.context.window.visualViewport.scale=2;
  f.fire('touchstart',[[240,200]]);
  f.fire('touchmove',[[100,202]]);
  const blocked=f.fire('touchend',[],{changed:[[100,202]]});
  assert.equal(blocked,false,'allow zoomed browser page to pan');
  assert.equal(f.renders,0);
  assert.equal(f.context.pos,1);
  f.context.window.visualViewport.scale=1;
  f.fire('touchstart',[[170,200]]);
  const tap=f.fire('touchend',[],{changed:[[171,201]]});
  assert.equal(tap,false);
  assert.equal(f.blocked(),false,'new stationary tap can flip as usual');
  assert.equal(f.context.touchTapHandled,false);
});

