"""Enable original-backed caption annotations in exported WH1 part/display HTML."""
from pathlib import Path
from subprocess import run


def prepare_caption_ruby(html: bytes) -> bytes:
    if b'"ruby"' not in html:
        return html
    module = Path(__file__).resolve().parents[1] / 'reader' / 'library' / 'wh1-caption-ruby.js'
    return run(['node', str(module)], input=html, stdout=-1, check=True).stdout
