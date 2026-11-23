"""Resolve OCR caption-to-figure candidates by physical edges, line clusters and column order.

CLI: python figure_caption_geometry.py input.json
Input: {"width":..., "height":..., "rows":[{"box":[x1,y1,x2,y2],"text":"...","id":"..."}],
        "figures":[{"bbox":[x1,y1,x2,y2]}], "existingCaptionRows":[["id",...],...]}
Use rows for candidate horizontal lines outside art, and sourceRows for ALL raw
OCR rows including text whose orientation may have been misdetected. Existing
caption source order is optional. sourceRows uses the same IDs and rectangles.
The JSON result lists candidate row IDs and review flags. Nonempty flags require
a source-verified assignment or retention of the original image for this page.
"""
from caption_initials import candidates as initial_candidates

import argparse
from collections import defaultdict
import json
import re
from pathlib import Path

# A possible decorative rule is retained for review, never silently deleted.
REPEATED_DIGIT = re.compile(r"(?<![0-9０-９])([0０])\1{11,}(?![0-9０-９])")


def intersects(a, b, axis):
    return max(0, min(a[axis + 2], b[axis + 2]) - max(a[axis], b[axis]))


def gap(a, b, axis):
    return max(0, a[axis] - b[axis + 2], b[axis] - a[axis + 2])


def contiguous(a, b):
    """Neighboring lines within a caption column (in local font-height units)."""
    height = min(a[3] - a[1], b[3] - b[1])
    width = min(a[2] - a[0], b[2] - b[0])
    return (intersects(a, b, 0) >= 0.35 * width and gap(a, b, 1) <= height * 1.8
            or intersects(a, b, 1) >= 0.6 * height and gap(a, b, 0) <= height * 1.2)


def group_rows(rows):
    """Connected printed regions; a remote, unconnected row does not inherit membership."""
    pending = list(rows)
    groups = []
    while pending:
        region = [pending.pop()]
        for row in region:
            remaining = []
            for other in pending:
                if contiguous(row['box'], other['box']):
                    region.append(other)
                else:
                    remaining.append(other)
            pending = remaining
        groups.append(region)
    return groups


def figure_distance(row, figure):
    """Closest aligned edge distance in the local type size."""
    b, f = row['box'], figure['bbox']
    height = b[3] - b[1]
    eligible = []
    if intersects(b, f, 0) >= .35 * min(b[2]-b[0], f[2]-f[0]):
        eligible.append(gap(b, f, 1)/height)
    if intersects(b, f, 1) >= .6 * height:
        eligible.append(gap(b, f, 0)/height)
    return min(eligible,default=float('inf'))


def alternating_columns(rows, width, height):
    """The stored read order must not repeatedly switch columns on the same line."""
    jumps = sum(1 for a,b in zip(rows,rows[1:]) if
                b['box'][0]-a['box'][0]>.24*width
                and abs(a['box'][1]-b['box'][1])<.013*height)
    return jumps >= 2


def printed_order(rows):
    """Read complete, non-spanning horizontal columns from left to right."""
    columns = []
    right = None
    for row in sorted(rows,key=lambda r:r['box'][0]):
        x, _, end, _ = row['box']
        if right is None or x > right:
            columns.append([])
        columns[-1].append(row)
        right = end if right is None else max(right,end)
    return [r for column in columns for r in sorted(column, key=lambda r:(r['box'][1], r['box'][0]))]


def column_risk(rows, width):
    """A persistent two-column gutter that another OCR line crosses or a long article straddles."""
    substantial = [r for r in rows if .17 * width <= r['box'][2]-r['box'][0] <= .59 * width]
    pairs = []
    for left in substantial:
        a = left['box']
        for right in substantial:
            b = right['box']
            height = min(a[3]-a[1], b[3]-b[1])
            if (0 < b[0]-a[2] < width*.16
                    and intersects(a, b, 1) >= .4 * height):
                pairs.append((a, b))
    for a, b in pairs:
        cut = (a[2]+b[0])/2
        common = [(l,r) for l,r in pairs if l[2] <= cut <= r[0]]
        # Tolerate isolated short last lines, captions with innocent inline word gaps, etc.
        if len({(l[1],r[1]) for l,r in common}) < 3:
            continue
        if any(r['box'][0] < cut - .17 * width and r['box'][2] > cut + .17 * width
               for r in rows):
            return True
    return False


def caption_assignments(rows, figures, width):
    """Physical adjacency, not nearest-centre alone. Abstain on conflicting evidence."""
    bindings = defaultdict(list)
    flags = []
    if not figures:
        return bindings, flags
    if any(REPEATED_DIGIT.search(row['text']) for row in rows):
        flags.append('repeated-zero-run')
    for group in group_rows(rows):
        distances = sorted((min(figure_distance(row, figure) for row in group), i)
                           for i,figure in enumerate(figures))
        best, index = distances[0]
        if best > 4.4:
            flags.append('detached-text')
        elif (len(distances)>1 and distances[1][0]<=4.4
              and distances[1][0] < 1.75*best + .1):
            flags.append('ambiguous-figure')
        else:
            bindings[index].extend(group)
    for i,group in bindings.items():
        if column_risk(group, width):
            flags.append('cross-column-ocr')
        bindings[i]=printed_order(group)
    return bindings, sorted(set(flags))



def inspect_input(data):
    rows, figures = data['rows'], data['figures']
    width, height = data['width'], data['height']
    if width <= 0 or height <= 0:
        raise ValueError('Positive page dimensions required')
    for owner, key in [(r,'box') for r in rows]+[(f,'bbox') for f in figures]:
        x,y,X,Y=owner[key]
        if not (0<=x<X<=width and 0<=y<Y<=height):
            raise ValueError(f'Invalid physical region {owner[key]}')
    by_id={r['id']:r for r in rows}
    if len(by_id)!=len(rows):
        raise ValueError('Duplicate OCR row IDs')
    groups, flags = caption_assignments(rows, figures, width)
    owners={r['id']:i for i,group in groups.items() for r in group}
    previous=data.get('existingCaptionRows')
    if previous is not None:
        if len(previous)!=len(figures):
            raise ValueError('Expected one existing row list per figure')
        claimed=set()
        for i,sequence in enumerate(previous):
            for key in sequence:
                if key in claimed or key not in by_id:
                    raise ValueError(f'Duplicate or unknown source row {key}')
                claimed.add(key)
                if key in owners and owners[key]!=i:
                    flags.append('conflicting-figure')
            if alternating_columns([by_id[key] for key in sequence], width, height):
                flags.append('interleaved-column-order')
    assigned = {i:[r['id'] for r in group] for i,group in sorted(groups.items())}
    orders = enumerate(previous) if previous is not None else assigned.items()
    source_rows = data.get('sourceRows', rows)
    source = {row['id']: row for row in source_rows}
    if len(source) != len(source_rows):
        raise ValueError('Duplicate source OCR row IDs')
    for key, horizontal_row in by_id.items():
        if key not in source or source[key]['box'] != horizontal_row['box']:
            raise ValueError(f'Caption row missing from the original OCR geometry: {key}')
    for row in source_rows:
        x, y, X, Y = row['box']
        if not (0 <= x < X <= width and 0 <= y < Y <= height):
            raise ValueError(f'Invalid original OCR region {row["id"]}')
    initials = [dict(figure=i, **zone) for i, ids in orders
                for zone in initial_candidates(ids, source_rows)]
    result = {'candidates': assigned, 'reviewFlags': sorted(set(flags))}
    if initials:
        result['initialCandidates'] = initials
        result['reviewFlags'] = sorted(set(flags) | {'caption-initial-review'})
    return result


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path)
    result=inspect_input(json.loads(parser.parse_args().input.read_bytes()))
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(2 if result['reviewFlags'] else 0)
