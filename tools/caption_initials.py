"""Find the reserved initial square at the start of a horizontally set caption.

Use source pixels to review the reported zones. OCR text, including a model's
alternate prediction, is never automatically removed, substituted or supplied.
"""
import argparse
import json
from pathlib import Path
from statistics import median


def candidates(lines, rows):
    """Inspect the first two lines of a caption for a two-line hanging initial.

    Both lines start beyond the box, and the third starts under it. When there
    are just two lines, an actual overlapping OCR detection is required.
    """
    if len(lines) < 2:
        return []
    by_id = {r['id']:r for r in rows}
    if len(by_id) != len(rows) or len(set(lines)) != len(lines):
        raise ValueError("Duplicate OCR row identifier")
    for r in rows:
        x,y,X,Y = r['box']
        if X <= x or Y <= y:
            raise ValueError("Invalid OCR rectangle")
    line_rows = [by_id[k] for k in lines]
    # The old caption can itself contain bogus oversized pieces of the initial.
    # Retain normal horizontal lines as anchors and allow the other rows as
    # physical evidence regardless of their old text role.
    line_rows = [r for r in line_rows if r['box'][2]-r['box'][0] >= 2.2*(r['box'][3]-r['box'][1])]
    if len(line_rows) < 2:
        return []
    lines = [r['id'] for r in line_rows]
    a, b = (r['box'] for r in line_rows[:2])
    h = median((a[3]-a[1], b[3]-b[1]))
    if not h or a[2]-a[0]<2.2*h or b[2]-b[0]<2.2*h:
        return []
    if not (.72*h <= b[1]-a[1] <= 2.9*h and abs(a[0]-b[0]) <= .7*h):
        return []
    left = min(a[0], b[0])
    outdent = None
    if len(line_rows) >= 3:
        c = line_rows[2]['box']
        if .65*h<=c[1]-b[1]<=3*h and c[2]-c[0]>=2.2*h and 1.25*h<=left-c[0]<=12*h:
            outdent = c[0]
    # OCR frequently recognises several mutually overlapping fragments of the
    # same enlarged glyph. Keep all IDs so a confirmed region is used once.
    initial_rows = []
    for other in rows:
        if other['id'] in lines or other.get('kind') in ('block_rubi','block_folio','block_pillar'):
            continue
        x,y,X,Y = other['box']
        if len(other['text'].strip())>5 or Y-y<1.25*h or Y-y>3.1*h or X-x>9*h:
            continue
        if min(Y,b[3])-max(y,a[1]) < .74*(Y-y) or min(Y,b[3])-max(y,b[1])<=0 or min(Y,a[3])-max(y,a[1])<=0:
            continue
        if not (left-12*h<=x and X<=left+.27*h and (outdent is not None or left-X<=4*h)):
            continue
        if outdent is not None and x<outdent-.65*h:
            continue
        initial_rows.append(other)
    if outdent is None and not initial_rows:
        return []
    x = outdent if outdent is not None else min(r['box'][0] for r in initial_rows)
    return [dict(box=[x, a[1],left,b[3]], lines=lines[:3], fragments=[r['id'] for r in initial_rows])]


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('geometry',type=Path,help='JSON with rows and ordered caption line ID lists')
    source=json.loads(p.parse_args().geometry.read_bytes())
    found = [dict(group=i,**c) for i,group in enumerate(source['captionRows']) for c in candidates(group, source['rows'])]
    print(json.dumps(found,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
