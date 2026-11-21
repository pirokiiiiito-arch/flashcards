'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const root = process.env.READER_AUDIT_ROOT || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'reader/library/wh3-format.html'), 'utf8');
const fn = (start, end) => html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start)));
const readingBlocks = vm.runInNewContext('(' + fn('function readingBlocks(', '// Scans 252') + ')');
const sourceKind = vm.runInNewContext(fn('const sourceKind=', 'let blocks=') + 'sourceKind');
const join = vm.runInNewContext('(' + fn('function joinLogicalContinuations(', 'function textPart(') + ')');

function fixture(kind, lines) {
  return {
    sourceHeadingInventory: [{kind, text: 'Sample inset'}],
    sourceTextRegions: [{kind: 'body', id: 'paragraph'}, {kind: 'table', id: 'table'}],
    blocks: [
      {type: 'heading', text: 'Sample　inset'},
      ...lines.map(text => ({type: 'note', sourceRegions: ['paragraph'], text}))
    ]
  };
}

test('an inset follows the body typography at every size and remains a separate reading stream', () => {
  for (const kind of ['boxed-heading', 'boxed_heading', 'inset']) {
    const book = fixture(kind, ['A paragraph.', 'A second paragraph.']);
    const saved = JSON.stringify(book);
    const output = readingBlocks(book);
    assert.deepEqual(output.map(sourceKind), ['heading', 'aside', 'aside']);
    assert.equal(JSON.stringify(book), saved);
    assert.equal(output[1].type, 'note');
    assert.throws(() => join([
      {semanticType: 'body', units: ['a'], scan: 13, sourceBlock: 0},
      {semanticType: sourceKind(output[1]), sourceJoined: true, units: ['b'], scan: 14, sourceBlock: 1}
    ]), /CONTINUATION_BARRIER/);
  }
  const render = fn('function partNode(', 'function fitsParts(');
  assert.match(render, /semanticType==='aside'\)el\.classList\.add\('aside-body'\)/);
  assert.match(render, /else if\(p\.semanticType==='note'\)el\.classList\.add\('note-text'\)/);
  assert.match(fn('function fitsParts(', 'function joinLogicalContinuations('), /partNode\(additional\)/);
});

test('source credits after an inset quotation, regular notes, and table rows retain their roles', () => {
  const book = fixture('inset', ['「open 「nested」', 'the end」', 'Source credit']);
  book.blocks.push({type: 'note', sourceRegions: ['table'], text: 'Table entry'});
  assert.deepEqual(readingBlocks(book).map(sourceKind), ['heading', 'aside', 'aside', 'note', 'note']);
  const map = fixture('map-title', ['Map description']);
  assert.equal(readingBlocks(map)[1], map.blocks[1]);
  const table = fixture('inset', []);
  table.blocks.push({type: 'note', sourceRegions: ['table'], text: 'Table entry'});
  assert.equal(readingBlocks(table)[1], table.blocks[1]);
  assert.equal(sourceKind({type: 'note', readingRole: 'aside'}), 'aside');
});

test('a source heading printed across two lines identifies the same inset', () => {
  const book = fixture('inset', ['Paragraph']);
  book.sourceTextRegions.push({id: 'inset-title', kind: 'heading', text: 'Sample\ninset'});
  book.blocks.splice(0, 1, ...['Sample', 'inset'].map(text => ({type: 'heading', text, sourceRegions: ['inset-title']})));
  assert.deepEqual(readingBlocks(book).map(sourceKind), ['heading', 'heading', 'aside']);
});
