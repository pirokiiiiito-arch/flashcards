"""Enable original-backed caption annotations in exported WH1 part/display HTML."""
from pathlib import Path
from subprocess import run


MODULE = Path(__file__).resolve().parents[1] / 'reader' / 'library' / 'wh1-caption-ruby.js'


def prepare_caption_ruby(html: bytes) -> bytes:
    if b'"ruby"' not in html:
        return html
    return run(['node', str(MODULE)], input=html, stdout=-1, check=True).stdout


def prepare_caption_fit(html: bytes) -> bytes:
    """Keep a complete figure caption together when its actual rendered lines fit."""
    if b'function illustrationFits(base,txt){' not in html:
        return html
    return run(['node', str(MODULE), '--fit'], input=html, stdout=-1, check=True).stdout
