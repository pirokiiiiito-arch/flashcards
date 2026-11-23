// WH1 figure notes use code-point offsets on each original note. The reader's
// page offsets use UTF-16 on the joined description, including its newlines.
'use strict';
(function () {
  function captionRubyRanges(notes) {
    let offset = 0;
    const ranges = [];
    for (const note of notes) {
      const offsets = [0];
      for (const character of note.text) offsets.push(offsets[offsets.length - 1] + character.length);
      let previous = 0;
      for (const row of note.ruby || []) {
        const { start, end, reading } = row;
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < previous ||
            end <= start || end >= offsets.length || typeof reading !== 'string' || !reading.trim() ||
            (row.base !== undefined && row.base !== note.text.slice(offsets[start], offsets[end]))) {
          throw Error('図説ルビの親文字・読み・位置を確認してください');
        }
        ranges.push({ start: offset + offsets[start], end: offset + offsets[end], reading });
        previous = end;
      }
      offset += note.text.length + 1;
    }
    return ranges;
  }

  function captionRubyBoundary(ranges, start, count) {
    const at = start + count;
    const crossing = ranges.find(row => row.start < at && at < row.end);
    if (!crossing) return count;
    return (crossing.start > start ? crossing.start : crossing.end) - start;
  }

  function captionWithRuby(page) {
    const span = document.createElement('span');
    span.className = 'figure-bundle-caption-content';
    const text = page.description;
    const start = page.partOffset || 0;
    let cursor = 0;
    for (const row of page.captionRuby || []) {
      if (row.start < start || row.start >= start + text.length) continue;
      const from = row.start - start;
      // Pagination probes occasionally end halfway through a base. Measure
      // its annotation too, exactly as the final indivisible word will render.
      span.append(text.slice(cursor, from));
      const ruby = document.createElement('ruby');
      ruby.append(text.slice(from, row.end - start));
      const rt = document.createElement('rt');
      rt.textContent = row.reading;
      ruby.append(rt);
      span.append(ruby);
      cursor = row.end - start;
    }
    span.append(text.slice(cursor));
    return span;
  }

  function prepare(html) {
    const marker = '/* WH1 source caption ruby v1 */';
    if (html.includes(marker) || !html.includes('"ruby"')) return html;
    const data = name => html.match(new RegExp('^const ' + name + '=(.*);$', 'm'))?.[1];
    const blocks = data('blocks'), groups = data('ILLUSTRATION_GROUPS');
    if (!blocks || !groups) return html;
    const rows = JSON.parse(blocks);
    if (!JSON.parse(groups).some(g => g.desc.some(i => rows[i].ruby?.length))) return html;
    function replaceOnce(before, after) {
      if (html.split(before).length !== 2) throw Error('図説ルビの表示に必要な第1巻の処理が見つかりません');
      html = html.replace(before, () => after);
    }
    replaceOnce('function bundleData(g){', [marker, captionRubyRanges, captionRubyBoundary, captionWithRuby, 'function bundleData(g){'].join('\n'));
    replaceOnce('descriptionFull:desc,', 'descriptionFull:desc,captionRuby:captionRubyRanges(g.desc.map(i=>blocks[i])),');
    replaceOnce('const remaining=all.slice(offset);', 'base.partOffset=offset;\n  const remaining=all.slice(offset);');
    const emit = 'output.push({...base,description:remaining.slice(0,n),partOffset:offset,';
    replaceOnce(emit, 'n=captionRubyBoundary(base.captionRuby,offset,n);\n  ' + emit);
    replaceOnce("node('span','figure-bundle-caption-content',p.description)", 'captionWithRuby(p)');
    return html;
  }

  // The legacy fitting search reserves 10px below every caption probe. A
  // complete remainder can use that margin if all of its actual lines fit.
  function wholeCaptionVisible(box, content) {
    const bounds = box.getBoundingClientRect();
    const fits = rect => rect.left >= bounds.left && rect.right <= bounds.right &&
      rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    if (!fits(content.getBoundingClientRect())) return false;
    const range = document.createRange();
    range.selectNodeContents(content);
    return Array.from(range.getClientRects()).every(fits);
  }

  function prepareCaptionFit(html) {
    const marker = '/* WH1 complete caption fit v1 */';
    const oldFunction = 'function illustrationFits(base,txt){';
    if (html.includes(marker) || !html.includes(oldFunction) ||
        !/^const ILLUSTRATION_GROUPS=\[\{/m.test(html)) return html;
    const height = 'content.getBoundingClientRect().height<=d.clientHeight-10';
    const remainder = 'if(!illustrationFits(base,remaining)){';
    for (const anchor of [oldFunction, height, remainder]) {
      if (html.split(anchor).length !== 2) throw Error('図説の改ページ計測処理を一意に特定できません');
    }
    return html.replace(oldFunction, () => marker + '\n' + wholeCaptionVisible.toString() +
      '\nfunction illustrationFits(base,txt,wholeRemainder=false){')
      .replace(height, '(' + height + '||(wholeRemainder&&wholeCaptionVisible(d,content)))')
      .replace(remainder, 'if(!illustrationFits(base,remaining,true)){');
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { prepare, prepareCaptionFit, wholeCaptionVisible, captionRubyRanges, captionRubyBoundary };
    if (require.main === module) {
      const transform = process.argv[2] === '--fit' ? prepareCaptionFit : prepare;
      process.stdout.write(transform(require('node:fs').readFileSync(0, 'utf8')));
    }
  } else {
    window.WH1CaptionRuby = Object.freeze({ prepare, prepareCaptionFit });
  }
})();
