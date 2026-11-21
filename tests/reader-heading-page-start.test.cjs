'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.env.READER_AUDIT_ROOT || path.join(__dirname, '..');
for (const name of ['templates/reader/v2/standard.js', 'reader/library/wh3-format.html']) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  const start = source.indexOf('function paginateBlocks(');
  const end = source.indexOf('\nfunction ', start + 1);
  const makePages = new Function('joinLogicalContinuations', 'textPart', 'fitsParts', 'protectedPageBoundary',
    source.slice(start, end) + '\nreturn paginateBlocks;');
  const paginate = makePages(blocks => blocks, (b, off, n) => ({type:b.type, scan:b.scan, text:b.text.slice(off, off+n)}),
    () => true, () => false);

  test(name + ' starts each independent heading on a fresh screen, even with space left', () => {
    function block(type, text, continuesHeading = false) {
      return {type, semanticType:type, text, units:[...text], scan:18, continuesHeading};
    }
    const blocks = [block('body','before'), block('heading','first'), block('body','after'),
      block('heading','chapter'), block('heading','title',true), block('body','opening'),
      block('heading','independent'), block('heading','separate'), block('body','last')];
    const pages = paginate(blocks, 9);
    assert.deepEqual(pages.map(p => p.parts.map(part => part.text)),
      [['before'], ['first','after'], ['chapter','title','opening'], ['independent'], ['separate','last']]);
    assert.deepEqual(pages.slice(1).map(p => p.start), pages.slice(0,-1).map(p => p.end));
    assert.equal(pages.at(-1).end, 9 + blocks.reduce((sum,b) => sum+b.units.length,0));
    assert.deepEqual(paginate([block('heading','only')],0).map(p => p.parts.length),[1]);
    assert.deepEqual(paginate([],0),[]);
  });
}
