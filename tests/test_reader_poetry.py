import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from reader_poetry import prepare_verses


class PoetryBoundaries(unittest.TestCase):
    def test_verified_boundaries_cover_a_line_continued_across_scans(self):
        rows = [
            {'kind': 'text', 'type': 'body', 'text': '青い', 'poetryWordEnds': [2, 5]},
            {'kind': 'text', 'type': 'body', 'text': '風の音', 'joinPrevious': True},
            {'kind': 'text', 'type': 'body', 'text': '解説', 'lineRole': 'prose'},
        ]
        with patch('reader_poetry.tokenizer', side_effect=AssertionError):
            prepare_verses(rows)
        self.assertEqual(rows[0]['poetryWordEnds'], [2, 5])
        self.assertNotIn('poetryWordEnds', rows[2])

    def test_invalid_offsets_and_mixed_verse_prose_joins_are_rejected(self):
        for ends in ([1, 1], [0, 1], [3], [True]):
            with self.subTest(ends=ends), self.assertRaises(ValueError):
                prepare_verses([{'kind': 'text', 'text': '昼', 'poetryWordEnds': ends}])
        with self.assertRaises(ValueError):
            prepare_verses([{'kind': 'text', 'text': '空', 'poetryWordEnds': [1]},
                            {'kind': 'text', 'text': '序', 'lineRole': 'prose', 'joinPrevious': True}])
