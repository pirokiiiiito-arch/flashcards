"""Build a whole-book reader with the canonical template for each profile."""
import base64
from collections import Counter
from hashlib import sha256
from html import escape
from urllib.parse import unquote_to_bytes
from html.parser import HTMLParser
import json
from mimetypes import guess_type
from pathlib import Path, PurePosixPath
import re

TEMPLATE = Path(__file__).resolve().parents[1] / 'templates/reader/v2'
ASSET_TABLE = ';\n(()=>{const assets='
ASSET_BINDINGS = (';for(const row of [...READER_BOOK.originals,...(READER_BOOK.entries||READER_BOOK.figures||[])])'
                  'if(row.assetIndex!==undefined)row.src=assets[row.assetIndex];})();')

# Accept prior canonical assets when repacking an old source volume. Do not
# replace custom presentation code just because a newer reader is available.
PREVIOUS_ASSET_SHA = {
    'poetry.css': {'12a88e6f18017ddbe195d991e3382a4bb5033bc35fb13dd971ce14e21eb42107'},
    'standard.js': {'aa50214094838cff85f5ace542e03d55d7703886d42557e44e4308d83a39f31c',
                    'b1e1fa8389b602934131725b9e6cfab85687ef24fd24977e4e262a4bc3960769'},
    'novel.js': {'bb3e9d9674e9edc6fa440528ccfcc4b746a371c572fa55004c3dce0e49cac250',
                 'dc7ffb8fc36d4b6d87e7c15bb65d34f34b47d57d22501d74d354a0022b649abc'},
}


def known_previous_asset(file, source):
    return file in PREVIOUS_ASSET_SHA and sha256(source.strip()).hexdigest() in PREVIOUS_ASSET_SHA[file]



class TemplateSource(HTMLParser):
    """Read literal data from private HTML. Source scripts are never evaluated."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.data = None
        self.script = ''

    def handle_starttag(self, tag, attrs):
        props = dict(attrs)
        if tag == 'script':
            self.script = 'json' if props.get('id') == 'bookdata' and props.get('type') == 'application/json' else 'js'

    def handle_endtag(self, tag):
        if tag == 'script':
            self.script = ''

    def handle_data(self, data):
        if self.script == 'json':
            self.data = json.loads(data)
        elif self.script == 'js' and self.data is None:
            match = re.match(r'\s*window\.READER_BOOK\s*=\s*(?=\{)', data)
            if match:
                decoder = json.JSONDecoder()
                try:
                    book, end = decoder.raw_decode(data, match.end())
                except json.JSONDecodeError:
                    return
                tail = data[end:].strip()
                if tail in ('', ';'):
                    self.data = book
                elif tail.startswith(ASSET_TABLE):
                    assets, end = decoder.raw_decode(tail, len(ASSET_TABLE))
                    if tail[end:] != ASSET_BINDINGS:
                        return
                    if not isinstance(assets, list):
                        raise ValueError('統合読書HTMLの画像一覧が不正です')
                    for row in book.get('originals', []) + (book.get('entries') or book.get('figures') or []):
                        if 'assetIndex' in row:
                            index = row['assetIndex']
                            if type(index) is not int or not 0 <= index < len(assets) or not isinstance(assets[index], str):
                                raise ValueError('統合読書HTMLの画像番号が不正です')
                            row['src'] = assets[index]
                    self.data = book


def verified_template(html, profile, part, read_bytes):
    # Accept literal data or the canonical shell with its original assets.
    poetry = profile == 'poetry'
    novel = profile in ('novel','poetry')
    styles = ('standard.css','novel.css') if novel else ('standard.css',)
    scripts = ('novel-dialogue.js','novel.js') if novel else ('standard.js',)

    if poetry:
        styles += ('poetry.css',)
        scripts = ('novel-dialogue.js','poetry.js','poetry-reader.js')

    def canonical_markup(value):
        def script(match):
            attrs, code = match.groups()
            if re.search(r'\btype=["\x27]application/json["\x27]',attrs,re.I) or re.fullmatch(r'\s*window\.READER_BOOK\s*=\s*\{.*\}\s*;?\s*',code,re.S):
                return ''
            for file in scripts:
                if not attrs.strip() and (code.strip() == (TEMPLATE/file).read_text().strip()
                                          or known_previous_asset(file, code.encode())):
                    return '<script src="./'+file+'"></script>'
            return match[0]
        value = re.sub(r'<script\b([^>]*)>(.*?)</script\s*>', script, value, flags=re.I|re.S)
        def stylesheet(match):
            css = match.group(1).strip()
            for file in styles:
                if css == (TEMPLATE/file).read_text().strip() or known_previous_asset(file, css.encode()):
                    return '<link rel="stylesheet" href="./'+file+'">'
            return match[0]
        value = re.sub(r'<style>(.*?)</style>', stylesheet, value, flags=re.S)
        value = re.sub(r'<title>.*?</title>','<title></title>',value,flags=re.I|re.S)
        value = re.sub(r'(<output class="shelf-status" id="shelf-status">)[^<]*(</output>)',r'\1\2',value)
        return re.sub(r'>\s+<','><',value.strip())
    shape = canonical_markup(html)
    metadata_only = re.sub(r'</?(?:head|body|title)>|</?html(?: +lang=["\x27][^"\x27]*["\x27])?>|<!doctype html>|<meta (?:charset|name)=["\x27][^>]*>', '',shape,flags=re.I)
    if not metadata_only.strip():
        return
    templates = ('poetry.html',) if poetry else ('novel.html',) if novel else ('mixed.html', 'image.html')
    if all(shape != canonical_markup((TEMPLATE / name).read_text()) for name in templates):
        raise ValueError('個別の読書画面は標準テンプレートに置換できません。書式を保った全巻HTMLを指定してください')
    for file in styles + scripts:
        try:
            asset = read_bytes(str(PurePosixPath(part['part']).parent / file))
        except (FileNotFoundError, KeyError):
            continue
        if asset != (TEMPLATE/file).read_bytes() and not known_previous_asset(file, asset):
            raise ValueError(f'個別の表示処理 {file} を含むため、書式を保った全巻HTMLを指定してください')


def read_part(part, read_bytes, profile=None):
    raw = read_bytes(part['part'])
    if part.get('sha256') and sha256(raw).hexdigest() != part['sha256']:
        raise ValueError('分冊のSHA-256が一致しません')
    text = raw.decode('utf-8-sig')
    if text.lstrip().startswith('{'):
        return json.loads(text)
    if profile:
        verified_template(text,profile,part,read_bytes)
    parser = TemplateSource()
    parser.feed(text)
    parser.close()
    if not isinstance(parser.data, dict):
        raise ValueError('読書テンプレートのJSON本文が見つかりません')
    return parser.data


def data_url(path, read_bytes, expected_hash=None):
    mime = guess_type(path)[0]
    if mime not in {'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif'}:
        raise ValueError('画像形式を判定できません')
    raw = read_bytes(path)
    if expected_hash and sha256(raw).hexdigest() != expected_hash:
        raise ValueError('原本・図版のSHA-256が一致しません')
    return 'data:' + mime + ';base64,' + base64.b64encode(raw).decode('ascii')


def part_image(src, part, read_bytes):
    if src.startswith('data:image/'):
        return src
    if not src or ':' in src or '\\' in src or PurePosixPath(src).is_absolute():
        raise ValueError('図版をローカルファイルから解決できません')
    asset = part.get('assets', {}).get(src)
    path = asset['path'] if asset else str(PurePosixPath(part['part']).parent / src)
    return data_url(path, read_bytes, asset.get('sha256') if asset else None)


def template_entries(src):
    kind = src.get('kind')
    if kind == 'mixed':
        return src['entries']
    if kind == 'text':
        return [{'kind': 'text', 'blocks': src['blocks']}]
    if kind == 'image':
        return [dict(f, kind='image') for f in src['figures']]
    raise ValueError('分冊に text、image、mixed の表示種別が必要です')


def arrange(entries, text, links):
    """Move a verified continuation immediately after its predecessor, across optional plates."""
    # Only an illustration may stand between the two parts of a paragraph.
    # A heading, dialogue, note, explicit break or unrelated prose stays in source order.
    next_text = {}
    prior_text = None
    for key, row in entries:
        if row['kind'] == 'image':
            continue
        if prior_text is not None and key is not None:
            next_text[prior_text] = key
        prior_text = key

    after = {}
    before = {}
    for link in links:
        a, b = tuple(link['from']), tuple(link['to'])
        if a not in text or b not in text or a >= b:
            raise ValueError('本文接続先・順序が一致しません')
        if next_text.get(a) != b:
            raise ValueError('本文接続が途中の見出し・段落・改ページを飛び越えています')
        if a in after and after[a] != b or b in before and before[b] != a:
            raise ValueError('本文接続が矛盾しています')
        after[a] = b
        before[b] = a
    result = []
    prior = None
    for key, entry in entries:
        if key in before:
            continue
        while True:
            if key is not None and (key in before or entry.get('joinPrevious')):
                if not prior or prior.get('type') not in ('body','dialogue') or entry['type'] != 'body':
                    raise ValueError('本文接続が見出し・画像・会話の区切りと矛盾しています')
                entry = dict(entry, joinPrevious=True)
            result.append(entry)
            prior = entry if key is not None else None
            if key not in after:
                break
            key = after[key]
            entry = text[key]
    if len(result) != len(entries):
        raise ValueError('本文・図版の接続で項目数が変わりました')
    return result


def validate_source_ruby(block, original_sha):
    """Ruby uses code-point offsets local to one original block, also after a join."""
    if 'ruby' not in block:
        return
    rubies = block['ruby']
    if not isinstance(rubies, list) or rubies and block['type'] not in ('body', 'dialogue', 'heading'):
        raise ValueError('ルビは本文・会話・見出しの注記配列で指定してください')
    ends = {'left': 0, 'right': 0}
    previous_start = 0
    for ruby in rubies:
        if not isinstance(ruby, dict):
            raise ValueError('ルビに親文字・読み・原本位置が必要です')
        side = ruby.get('side', 'right')
        start, end = ruby.get('start'), ruby.get('end')
        if (type(start) is not int or type(end) is not int
                or side not in ('left', 'right') or not max(ends[side], previous_start) <= start < end <= len(block['text'])
                or ruby.get('base') != block['text'][start:end] or not ruby['base'].strip()):
            raise ValueError('ルビの親文字・範囲・順序が本文と一致しません')
        box = ruby.get('sourceBox')
        if (ruby.get('reviewStatus') != 'verified' or type(ruby.get('sourceScan')) is not int
                or ruby['sourceScan'] != block['scan'] or not isinstance(original_sha, str)
                or not re.fullmatch('[0-9a-f]{64}', original_sha) or ruby.get('sourceImageSha256') != original_sha
                or not isinstance(ruby.get('reading'), str) or not ruby['reading'].strip()
                or any(ord(c) < 32 for c in ruby['reading'])
                or not isinstance(box, list) or len(box) != 4 or not all(type(n) is int for n in box)
                or not (0 <= box[0] < box[2] and 0 <= box[1] < box[3])):
            raise ValueError('ルビの読み・原本番号・原本画像SHA・位置・確認状態を照合できません')
        previous_start = start
        ends[side] = end


def template_html(manifest, read_bytes):
    """read_bytes resolves safe archive-root paths. Source block ordinals are local to a scan."""
    profile = manifest['template_profile']
    if profile not in ('novel','world_history_1'):
        raise ValueError('読書テンプレートを特定できません')
    novel = profile == 'novel'
    variant = manifest.get('template_variant')
    if variant is not None and (variant != 'poetry' or not novel):
        raise ValueError('詩用テンプレートの基準プロファイルが一致しません')
    poetry = variant == 'poetry'
    roles = {'heading','body','toc'} | ({'dialogue'} if novel else {'note','footnote','caption'})
    entries, text = [], {}
    images, image_indexes, originals = [], {}, {}
    links = list(manifest.get('continuations', [])) + list(manifest.get('readingFlow', {}).get('continuations', []))
    ordinal = Counter()

    def asset_index(url):
        header, sep, payload = url.partition(',')
        if not sep or not payload or not header.startswith('data:image/'):
            raise ValueError('図版・原本の画像データを読み込めません')
        content = base64.b64decode(payload,validate=True) if header.endswith(';base64') else unquote_to_bytes(payload)
        key = sha256(content).digest()
        if key not in image_indexes:
            image_indexes[key] = len(images)
            images.append(url)
        return image_indexes[key]

    def register_original(n, url):
        i = asset_index(url)
        if n in originals and originals[n] != i:
            raise ValueError(f'分冊の原本画像が登録画像と違います: {n}')
        originals[n] = i

    def valid_scan(n, part):
        if type(n) is not int or not part['start'] <= n <= part['end']:
            raise ValueError('本文または画像の原本番号が分冊の範囲外です')
        return n

    kinds = set()
    def require_supported(row, *, text_block=False):
        rich_fields = ('rubies','glosses','emphasis','captionGlosses','notes','footnotes',
                       'toc','toc_entries','html','css','style','bbox')
        if any(row.get(k) for k in rich_fields) or (not text_block and row.get('ruby')):
            raise ValueError('ルビ・注記・図版切り抜き等を含む書式は、対応する構造付き原本または全巻HTMLを指定してください')
    for part in manifest['segments']:
        src = read_part(part, read_bytes, 'poetry' if poetry else profile)
        require_supported(src)
        kinds.add(src['kind'])
        book_id = manifest['bookId']
        low, high = part['start'], part['end']
        allowed_ids = {book_id}
        for separator in ('-', '_'):
            allowed_ids.update((f'{book_id}{separator}{low}-{high}', f'{book_id}{separator}{low:03}-{high:03}'))
        if part.get('sourceId') and part.get('sha256'):
            allowed_ids.add(part['sourceId'])
        identity_matches = src['bookId'] == book_id if 'bookId' in src else src.get('id') in allowed_ids
        if not identity_matches or src.get('range',[low,high]) != [low,high]:
            raise ValueError('分冊の書籍IDまたは原本範囲が違います')
        links.extend(src.get('continuations', []))
        for item in src.get('originals', []):
            n = valid_scan(item['scan'], part)
            if item.get('src'):
                register_original(n, part_image(item['src'], part, read_bytes))
        for item in template_entries(src):
            kind = item['kind']
            if kind != 'text' or 'blocks' in item:
                require_supported(item)
            if kind == 'text':
                for block in item.get('blocks', [item]):
                    require_supported(block, text_block=True)
                    n = valid_scan(block.get('scan',item.get('scan')), part)
                    key = n, ordinal[n]
                    ordinal[n] += 1
                    if not isinstance(block.get('text'),str) or not block['text']:
                        raise ValueError('本文ブロックが空です')
                    b = dict(block, kind='text', scan=n, sourceRef=list(key), type=block.get('type','body'))
                    if b['type'] not in roles:
                        raise ValueError('読書テンプレートの本文種別が不明です')
                    entries.append((key,b))
                    text[key] = b
            elif kind == 'image':
                valid_scan(item.get('scan'), part)
                url = part_image(item['src'], part, read_bytes)
                figure = dict(item, assetIndex=asset_index(url))
                del figure['src']
                entries.append((None,figure))
            elif kind == 'break':
                entries.append((None,{'kind':'break'}))
            else:
                raise ValueError('読書テンプレートの項目種別が不明です')
    for n, ref in manifest.get('originalScans', {}).items():
        register_original(int(n), data_url(ref['path'], read_bytes, ref.get('sha256')))
    if set(originals) != set(range(manifest['range'][0], manifest['range'][1] + 1)):
        raise ValueError('原本範囲に対応する原本画像が不足または重複しています')
    original_hashes = {idx: digest.hex() for digest, idx in image_indexes.items()}
    for (scan, _), block in text.items():
        validate_source_ruby(block, original_hashes[originals[scan]])
    from reader_shelf_pack import review_seams
    bodies, ids, edges = {}, {}, set()
    for link in links:
        endpoints = [link.get(name) for name in ('from','to')]
        if any(not isinstance(ref,list) or len(ref) != 2 or any(type(n) is not int for n in ref) for ref in endpoints):
            raise ValueError('本文接続先が不正です')
        a,b = map(tuple,endpoints)
        if a not in text or b not in text:
            raise ValueError('本文接続先が見つかりません')
        edges.add((a,b))
    previous = None
    deferred = []
    for key, row in entries:
        if key is not None and row['type'] in ('body','dialogue'):
            bodies[key] = row['text']
            if row.get('id'):
                if row['id'] in ids:
                    raise ValueError('原本本文IDが重複しています')
                ids[row['id']] = key
            if row.get('joinPrevious') and previous is not None:
                edges.add((previous,key))
            previous = key
        elif row.get('kind') == 'image' and row.get('deferUntilContinuation') is True:
            deferred.append((previous,row))
        else:
            previous = None
    edges = review_seams(manifest, bodies, ids, edges)
    for previous, image in deferred:
        if not any(a == previous for a,_ in edges):
            raise ValueError('図版の後に接続する本文が原本で確認されていません')
        # The ordered output places the figure after the complete joined prose.
        image.pop('deferUntilContinuation')
    links = [{'from':a,'to':b} for a,b in edges]
    mode = next(iter(kinds)) if len(kinds) == 1 else 'mixed'
    stream = arrange(entries,text,links)
    if poetry:
        from reader_poetry import prepare_verses
        prepare_verses(stream)
    field = {'text':'blocks','image':'figures','mixed':'entries'}[mode]
    book = {'id':manifest['bookId'], 'title':manifest['title'], 'totalScans':manifest['range'][1],
            'kind':mode, 'status':manifest.get('status') or '読書版', field:stream,
            'originals':[{'scan':n,'assetIndex':i} for n,i in sorted(originals.items())]}
    if poetry:
        book['templateVariant'] = 'poetry'
    # Store each private image only once even when it serves as both a plate and an original.
    def js(obj):
        return json.dumps(obj,ensure_ascii=False,separators=(',',':')).replace('<',r'\u003c')
    source = 'window.READER_BOOK='+js(book)+ASSET_TABLE+js(images)+ASSET_BINDINGS
    shell = (TEMPLATE/('poetry.html' if poetry else 'novel.html' if novel else 'mixed.html')).read_text()
    shell, count = re.subn(r'<script>window\.READER_BOOK=.*?</script>',
                           lambda _:'<script>'+source+'</script>', shell, flags=re.S)
    if count != 1:
        raise ValueError('読書テンプレートの本文挿入位置が一致しません')
    shell = re.sub(r'<title>.*?</title>',lambda _:'<title>'+escape(manifest['title'])+'</title>',shell,count=1)
    shell = re.sub(r'\s*<p class="help">(?:この短編は見本用|これは制作見本)[^<]*</p>','',shell,count=1)
    shell = re.sub(r'\s*<label class="help">本文用の原本画像を試す.*?</label>','',shell,count=1,flags=re.S)
    shell = re.sub(r'\s*<input id="figure-file"[^>]*>','',shell,count=1)
    shell = re.sub(r'(<output class="shelf-status" id="shelf-status">)[^<]*(</output>)',
                   lambda m:m[1]+escape(book['status'])+m[2],shell,count=1)
    shell = shell.replace('href="../../../reader/library/"','href="./"')
    styles = ('standard.css','novel.css') if novel else ('standard.css',)
    for f in styles + (('poetry.css',) if poetry else ()):
        shell = shell.replace(f'<link rel="stylesheet" href="./{f}">',
                              '<style>\n'+(TEMPLATE/f).read_text()+'\n</style>')
    scripts = ('novel-dialogue.js','novel.js') if novel else ('standard.js',)
    if poetry:
        scripts = ('novel-dialogue.js','poetry.js','poetry-reader.js')
    for f in scripts:
        shell = shell.replace(f'<script src="./{f}"></script>',
                              '<script>\n'+(TEMPLATE/f).read_text()+'\n</script>')
    return shell.encode()
