"""Prepare Japanese verse boundaries in the source text, independently of screen size."""
from functools import lru_cache
import re
import unicodedata

OPEN = frozenset('「『（【〔《〈［｛“‘([{')
CLOSE = frozenset('」』）】〕》〉］｝”’、。，．！？：；・…‥!?.,:;)]}')
KANA = re.compile(r'^[ァ-ヺー]+$')
LATIN = re.compile(r'^[A-Za-zＡ-Ｚａ-ｚ0-9０-９]+$')
CONNECTOR = frozenset('-‐‑./／．＿_+@：:')
UNITS = frozenset(('年','月','日','時','分','秒','円','個','枚','本','頁','色','歳','人','冊','％','%','℃','kg','km','cm','mm','m','g','ml'))

@lru_cache(maxsize=1)
def tokenizer():
    try:
        from sudachipy import dictionary
    except ImportError as error:
        raise ValueError('詩の語境界を生成するには sudachipy と sudachidict_core をインストールするか、確認済みの poetryWordEnds を指定してください') from error
    dic = dictionary.Dictionary()
    return dic.tokenizer() if hasattr(dic, 'tokenizer') else dic.create()


def word_ends(text):
    """Code-point offsets after whole orthographic words or Japanese phrases."""
    analyzer = tokenizer()
    from sudachipy.tokenizer import Tokenizer
    terms = list(analyzer.tokenize(text, Tokenizer.SplitMode.C))
    if ''.join(term.surface() for term in terms) != text:
        raise ValueError('形態素解析の文字列と原本の詩行が一致しません')
    ends = []
    for i, term in enumerate(terms):
        stop = term.end()
        if i + 1 == len(terms):
            ends.append(stop)
            break
        nxt = terms[i + 1]
        a, b = term.surface(), nxt.surface()
        pos, after = term.part_of_speech(), nxt.part_of_speech()
        if a.isspace():
            if not b.isspace():
                ends.append(stop)
            continue
        if b.isspace() or a[-1] in OPEN or b[0] in CLOSE or unicodedata.combining(b[0]):
            continue
        if pos[0] == '接頭辞' or after[0] in ('助詞','助動詞','接尾辞'):
            continue
        if (after[0] in ('動詞','形容詞') and after[1] == '非自立可能' and
                (pos[0] in ('動詞','形容詞','助動詞') or pos[1] in ('接続助詞','サ変可能','サ変形状詞可能'))):
            continue
        if ((KANA.fullmatch(a) and KANA.fullmatch(b))
                or (LATIN.fullmatch(a) and LATIN.fullmatch(b))
                or (pos[1] == '数詞' and (after[1] == '数詞' or after[2] == '助数詞可能'
                    or b in UNITS or after[0] == '名詞' and '\u3400' <= b[0] <= '\u9fff'))
                or (pos[0] == '名詞' and after[0] == '名詞' and
                    pos[1] in ('固有名詞','普通名詞') and after[1] in ('固有名詞','普通名詞'))):
            continue
        if (a in CONNECTOR and i > 0 and LATIN.fullmatch(terms[i-1].surface()) and LATIN.fullmatch(b)
                or b in CONNECTOR and i+2 < len(terms) and LATIN.fullmatch(a) and LATIN.fullmatch(terms[i+2].surface())):
            continue
        ends.append(stop)
    return ends


def is_verse(row):
    return row.get('kind') == 'text' and row.get('type', 'body') in ('body','dialogue') and row.get('lineRole', 'verse') == 'verse'


def prepare_verses(entries):
    """A continued verse may cross source blocks. Shape it as one line before counting."""
    line = []
    def finish():
        if not line:
            return
        text = ''.join(row['text'] for row in line)
        ends = line[0].get('poetryWordEnds')
        if ends is None:
            ends = word_ends(text)
        if (not isinstance(ends,list) or not ends or any(type(n) is not int for n in ends)
                or ends != sorted(set(ends)) or ends[0] <= 0 or ends[-1] != len(text)):
            raise ValueError('詩行の語境界と原文の文字位置が一致しません')
        line[0]['poetryWordEnds'] = ends
        for row in line:
            row['quoteMode'] = 'inline'
        line.clear()
    preceding = None
    for row in entries:
        if row.get('lineRole', 'verse') not in ('verse', 'prose'):
            raise ValueError('詩行には verse、散文には prose を指定してください')
        if row.get('joinPrevious') and preceding and is_verse(row) != is_verse(preceding):
            raise ValueError('詩行と散文の段落を続きとして接続できません')
        if not is_verse(row) or not row.get('joinPrevious'):
            finish()
        if is_verse(row):
            line.append(row)
        preceding = row
    finish()
