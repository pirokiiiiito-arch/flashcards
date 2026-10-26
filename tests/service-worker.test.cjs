const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function worker(file, scope) {
  const handlers = {}, removed = [], names = ['flashcards-v13', 'plant-flashcards-v28', 'colors1000-review47-drive3-old', 'unrelated-cache'];
  const context = { URL, Request, Response, fetch: async () => new Response('ok'), caches: { keys: async () => names, delete: async k => removed.push(k), open: async () => ({ addAll: async () => {}, match: async () => undefined, put: async () => {} }) },
    self: { registration: { scope }, clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener: (k, f) => handlers[k] = f } };
  vm.createContext(context); vm.runInContext(fs.readFileSync(file, 'utf8'), context); return { handlers, removed };
}
test('each worker only removes its own old cache namespace', async () => {
  const cases = [['service-worker.js', 'flashcards-v13'], ['plants/service-worker.js', 'plant-flashcards-v28'], ['colors/service-worker.js', 'colors1000-review47-drive3-old']];
  for (const [file, expected] of cases) { const w = worker(file, 'https://example.github.io/flashcards/'); let done; w.handlers.activate({ waitUntil: p => done = p }); await done; assert.deepEqual(w.removed, [expected]); }
});
test('root worker does not intercept subapps or authenticated Google requests', () => {
  const w = worker('service-worker.js', 'https://example.github.io/flashcards/');
  for (const url of ['https://example.github.io/flashcards/plants/', 'https://example.github.io/flashcards/colors/index.html', 'https://www.googleapis.com/drive/v3/files?alt=media']) {
    let intercepted = false; w.handlers.fetch({ request: new Request(url), respondWith: () => intercepted = true }); assert.equal(intercepted, false);
  }
});
test('color worker does not cache private assets or OAuth requests', () => {
  const w = worker('colors/service-worker.js', 'https://example.github.io/flashcards/colors/');
  for (const url of ['https://example.github.io/flashcards/colors/assets/test.jpg', 'https://www.googleapis.com/drive/v3/files/a?alt=media', 'https://accounts.google.com/gsi/client']) {
    let intercepted = false; w.handlers.fetch({ request: new Request(url), respondWith: () => intercepted = true }); assert.equal(intercepted, false);
  }
});
