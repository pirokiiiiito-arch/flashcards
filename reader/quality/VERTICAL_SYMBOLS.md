# 縦書き記号の組版と検査

全書籍共通ルール G7-02「選択テンプレートの書式再現」の実行手順。小説と『世界の歴史1』型の本文・見出し・目次に適用する。

| 記号 | 縦書きでの扱い |
| --- | --- |
| `?？!！‼⁇⁈⁉`、注記・単位記号（例 `※ % ＆ ℃`） | 点が下になる向きなど、元の記号を正立させる。連続した別々の文字は各文字を保つ。 |
| 通貨・数学記号（例 `￥ $ ＋ ＝ × ÷`）、矢印・図形（例 `→ ↑ ▼`） | 記号の意味と指す方向を保つため正立させる。 |
| `「」『』（）、。・`、長音 `ー`、ダッシュ `―`、波線 `〜`、リーダー `…‥` | `vertical-rl` と `text-orientation: mixed` でフォントの縦組字形・位置を使う。長音やダッシュは列の方向に伸び、リーダーの点は縦に並ぶ。 |
| その他の約物・記号、絵文字・異体字・結合記号 | Unicodeの縦書き向きとフォントの縦組機能を使う。異体字セレクター、キーキャップ、絵文字の結合列は一組で扱う。 |

原本・OCR・校正本文の文字コードは保持する。英字、既定の数字組版、縦中横、横書き図説、操作ボタンは従来の書式を使う。原本で文字自体の誤認が見つかった場合は、対応する原本ページと校正記録で扱う。

## Workでの実行

新しい共通テンプレートは本文を組むたびに自動適用する。既存の v2 系エンジンから分冊を再制作する場合は、次を実行する。運用ZIPの `integration/vertical-symbols/` からも同じコマンドを利用できる。

```sh
node tools/reader-vertical-symbols.cjs apply private-novel-engine.js
```

各分冊と統合版を通常の手順で再生成し、出力HTMLそのものを検査する。外部JS方式では候補HTMLと同じ相対位置に配布するJSを置く。コマンドは指定した全ファイルを順に検査して、ファイルごとの結果をJSONで返す。埋込型の確認版では原本枚数・正立記号数・縦組字形に任せる記号数も出力する。

```sh
node tools/reader-vertical-symbols.cjs check 分冊/*.html 統合確認版.html
```

画面幅320・390・430px、文字サイズ16～30pxで表示と改ページを確認する。プレビューの縦書き画面では `ReaderVerticalSymbols.inspect(document.getElementById('text-flow'))` で表示中の実測結果を得る。`mismatches` があるときは、文字コード、期待した向き、実際のCSS、対象ページを記録する。計測用の `measure-text` にも同じ検査を使える。書式・原本の文字列・見出しの改ページ・左端のはみ出しはそれぞれ確認する。

組版の仕様は [W3C 日本語組版処理の要件](https://www.w3.org/TR/jlreq/)、[CSS Writing Modes](https://www.w3.org/TR/css-writing-modes-3/#text-orientation)、[Unicode Vertical Text Layout](https://www.unicode.org/reports/tr50/) に基づく。
