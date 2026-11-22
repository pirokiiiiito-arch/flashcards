#!/usr/bin/env python3
"""Collect PRIVATE ruby candidates from NDLOCR rows and attach visually verified readings.

candidates --ocr scan.json --image original.jpg --out candidates.json
apply --page page.json --review review.json --image original.jpg --out page-with-ruby.json

The page contains one scan and its blocks. A review carries sourceScan,
sourceImageSha256 and annotations. Each verified annotation supplies blockId
(or blockIndex), start/end in Unicode code points, base, reading, and sourceBox
[x0,y0,x1,y1] in original, top-left-based image pixels. When a nearby OCR row
actually contains emphasis dots, two words or an uncertain reading, leave it
pending or excluded. Neither the candidate geometry nor OCR votes approve it.
"""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

from PIL import Image


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_json(path):
    return json.loads(path.read_bytes())


def atomic_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, mode='w', encoding='utf-8') as output:
        tmp = Path(output.name)
        try:
            json.dump(value, output, ensure_ascii=False, separators=(',', ':'))
            output.write('\n')
            output.close()
            os.replace(tmp, path)
        finally:
            tmp.unlink(missing_ok=True)


def source_image(path):
    # Hash and inspect the very same open file, including when the source is replaced concurrently.
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        stream.seek(0)
        with Image.open(stream) as original:
            size = original.size
    return digest, size


def valid_box(box, size):
    return (isinstance(box, list) and len(box) == 4 and all(type(n) is int for n in box)
            and 0 <= box[0] < box[2] <= size[0] and 0 <= box[1] < box[3] <= size[1])


def check_scan(scan):
    require(type(scan) is int and scan > 0, 'A positive original scan number is required.')


def nearby_line(reading, lines):
    """Suggest a source line for human inspection. Never infer the parent characters."""
    left, top, right, bottom = reading
    nearest = None
    distance = float('inf')
    for row in lines:
        x0, y0, x1, y1 = row['box']
        if y1 - y0 > x1 - x0:
            gap = left - x1
            thickness = x1 - x0
            overlaps = min(bottom, y1) > max(top, y0)
        else:
            gap = y0 - bottom
            thickness = y1 - y0
            overlaps = min(right, x1) > max(left, x0)
        if overlaps and -thickness * .4 <= gap <= thickness and abs(gap) < distance:
            distance = abs(gap)
            nearest = {'sourceBox': row['box'], 'ocrText': row.get('text', '')}
    return nearest


def get_candidates(ocr, digest, size):
    scan = ocr['scan']
    check_scan(scan)
    require(ocr['source_sha256'] == digest and (ocr['width'], ocr['height']) == size,
            'OCR belongs to a different image or pixel size.')
    rows = ocr['rows']
    require(isinstance(rows, list), 'OCR rows must be an array.')
    lines = [row for row in rows if row.get('kind') in ('line_main', 'line_title', 'line_note', 'line_caption')
             and valid_box(row.get('box'), size)]
    annotations = []
    for row in rows:
        if row['kind'] != 'block_rubi':
            continue
        box = row['box']
        require(valid_box(box, size), 'OCR ruby box is outside the original image.')
        candidate = {'reviewStatus': 'pending', 'sourceBox': box, 'ocrReading': row.get('text', ''),
                     'alternativeReading': row.get('alternative', '')}
        nearby = nearby_line(box, lines)
        if nearby is not None:
            candidate['nearbyLineHint'] = nearby
        annotations.append(candidate)
    return {'sourceScan': scan, 'sourceImageSha256': digest, 'annotations': annotations}


def checked_annotation(item, text, scan, digest, size):
    require(isinstance(item, dict) and item.get('reviewStatus') == 'verified', 'Only reviewed annotations can be attached.')
    require(item.get('sourceScan', scan) == scan and type(item.get('sourceScan', scan)) is int
            and item.get('sourceImageSha256', digest) == digest, 'Ruby refers to another scan.')
    side = item.get('side', 'right')
    require(side in ('left', 'right'), 'Unknown printed ruby side.')
    start, end = item['start'], item['end']
    require(type(start) is int and type(end) is int and 0 <= start < end <= len(text),
            'Invalid half-open code-point interval.')
    require(isinstance(item.get('base'), str) and item['base'].strip() and text[start:end] == item['base'],
            'Ruby base no longer matches the source text at this offset.')
    reading = item['reading']
    require(isinstance(reading, str) and reading.strip() and not any(ord(c) < 32 for c in reading),
            'Missing or invalid printed reading.')
    require(valid_box(item.get('sourceBox'), size), 'A reading needs a box inside the original image.')
    return {'start': start, 'end': end, 'base': item['base'], 'reading': reading, 'sourceScan': scan,
            'sourceImageSha256': digest, 'sourceBox': item['sourceBox'], 'reviewStatus': 'verified', **({'side': 'left'} if side == 'left' else {})}


def apply_review(page, review, digest, size):
    scan = page['scan']
    check_scan(scan)
    require(type(review.get('sourceScan')) is int and review['sourceScan'] == scan
            and review.get('sourceImageSha256') == digest, 'Review identifies a different source.')
    for field in ('sha256', 'sourceImageSha256', 'source_sha256', 'originalSha256'):
        if field in page:
            require(page[field] == digest, 'Source hash in page differs from the original image.')
    for field, actual in zip(('width', 'height'), size):
        if field in page:
            require(page[field] == actual, 'Original image dimensions differ.')
    blocks = page['blocks']
    require(isinstance(blocks, list), 'Expected one original scan with its text blocks.')
    by_id = {}
    additions = [[] for block in blocks]
    for index, block in enumerate(blocks):
        require(isinstance(block, dict), 'Invalid block.')
        if 'id' in block:
            ident = block['id']
            require(isinstance(ident, str) and ident and ident not in by_id, 'Duplicate or invalid block ID.')
            by_id[ident] = index
    annotations = review['annotations']
    require(isinstance(annotations, list), 'Annotations must be an array.')
    for item in annotations:
        require(isinstance(item, dict) and item.get('reviewStatus') in ('verified', 'pending', 'excluded'),
                'Each review must state its disposition.')
        if item['reviewStatus'] != 'verified':
            continue
        index = item.get('blockIndex')
        if 'blockId' in item:
            require(item['blockId'] in by_id, 'Reviewed block is missing.')
            known = by_id[item['blockId']]
            require(index is None or type(index) is int and index == known, 'Block number and ID disagree.')
            index = known
        require(type(index) is int and 0 <= index < len(blocks), 'Unknown block index.')
        text = blocks[index].get('text')
        require(isinstance(text, str), 'Expected canonical text on the reviewed block.')
        annotation = checked_annotation(item, text, scan, digest, size)
        start, end = annotation['start'], annotation['end']
        if 'before' in item:
            require(isinstance(item['before'], str) and text[:start].endswith(item['before']),
                    'Context before reviewed ruby no longer matches.')
        if 'after' in item:
            require(isinstance(item['after'], str) and text[end:].startswith(item['after']),
                    'Context after reviewed ruby no longer matches.')
        additions[index].append(annotation)
    assembled = []
    for block, new in zip(blocks, additions):
        if 'ruby' not in block and not new:
            assembled.append(block)
            continue
        require(type(block.get('scan', scan)) is int and block.get('scan', scan) == scan,
                'Text block belongs to a different original scan.')
        text = block.get('text')
        require(isinstance(text, str), 'Ruby needs a source text block.')
        existing = block.get('ruby', [])
        require(isinstance(existing, list), 'Expected a list of block ruby annotations.')
        intervals = []
        for item in existing:
            require(isinstance(item, dict) and item.get('sourceImageSha256') == digest and item.get('sourceScan') == scan,
                    'Existing annotation lacks a matching source reference.')
            checked_annotation(item, text, scan, digest, size)
            intervals.append(item)
        for annotation in new:
            if not any(prior.get('side', 'right') == annotation.get('side', 'right') and
                       all(prior.get(k) == v for k, v in annotation.items()) for prior in intervals):
                intervals.append(annotation)
        intervals.sort(key=lambda item: (item['start'], -item['end'], item.get('side') == 'left'))
        ends = {'left': 0, 'right': 0}
        for item in intervals:
            side = item.get('side', 'right')
            require(ends[side] <= item['start'], 'Reviewed ruby intervals overlap on the same side.')
            ends[side] = item['end']
        assembled.append({**block, 'ruby': intervals})
    return {**page, 'blocks': assembled}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    for command, flags in [('candidates', ['ocr']), ('apply', ['page', 'review'])]:
        sub = commands.add_parser(command)
        for flag in [*flags, 'image', 'out']:
            sub.add_argument('--' + flag, type=Path, required=True)
    args = parser.parse_args()
    try:
        inputs = [getattr(args, attr) for attr in ('image', 'ocr', 'review') if hasattr(args, attr)]
        require(all(args.out.resolve() != p.resolve() for p in inputs), 'Output must not overwrite the original image or review inputs.')
        digest, size = source_image(args.image)
        if args.command == 'candidates':
            data = get_candidates(load_json(args.ocr), digest, size)
        else:
            data = apply_review(load_json(args.page), load_json(args.review), digest, size)
        atomic_write(args.out, data)
    except (KeyError, TypeError, ValueError, OSError) as exc:
        parser.exit(2, 'Source ruby validation failed: ' + str(exc) + '\n')


if __name__ == '__main__':
    main()
