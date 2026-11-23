# 本棚・標準読書テンプレート v2（文章／画像）

## 図版説明の横書き正式ルール（2026-11-19）

- 独立図版の**図題・説明ラベル・外部説明文**は横書き（`writing-mode:horizontal-tb`）。本文・本文の小見出しは従来の縦書き `vertical-rl` を維持。原本画像内の文字は画素を変えない。
- `standard.css` の `.figure-stage` / `.caption-box` / `.figure-caption-label` / `.caption-flow` に横書きを直接指定。旧 `.caption-flow{writing-mode:vertical-rl}` は撤去済み。旧設定を残して後段の `!important` で見かけ上だけ上書きする構成を禁止する。
- 可視 `#figure-caption` とオフスクリーン計測 `#measure-caption` は、同じ `.caption-flow` のCSS、横書き方向、文字サイズ・行間・幅・paddingを使う。説明の続きは同一画像DOM・同一位置のまま説明文のみ切り替える。
- `node --test tests/reader-figure-caption-horizontal.test.cjs` で公開テンプレートの旧CSS混入を検出する。実書籍では追加で現行共通運用基盤の `figure_caption_gate.py`、全図版の画像端・本文関連・説明送り、24条件表示、iPhone実機の独立検査を実施し、合成テストだけで完成扱いしない。
- 小説の単なる挿絵には図説UIを新設しない。書籍固有の出典照合済みの例外はプロファイル・採用版・実機の根拠を明示して別途判定する。過去の版や原本・OCRを公開リポジトリから勝手に削除しない。


**基準**：2026-11-15の『世界の歴史1』iPhone実画面と、同日確認された『図説 英国のインテリア史』の表示寸法。

このフォルダは**公開可能な画面・組版プログラムの見本だけ**を格納する。書籍の原本画像・OCR本文・私有JSON・認証トークンを置かない。

## 文章・画像・混在の3つの実行見本

| 入口 | 用途 | 元データ |
|---|---|---|
| [文章テンプレート](./text.html) | 本文・章見出し・段落の縦書き読書 | blocks（見出し／本文／原本番号） |
| [画像テンプレート](./image.html) | 原本画像のみ・図版＋説明文 | figures（原本画像／説明文／図版ID／原本番号） |
| [文章＋画像テンプレート](./mixed.html) | 文章の途中に原本画像・図版を挿入 | entries（kind:text／image を原本順に配列） |
| [小説専用テンプレート](./novel.html) | カギカッコ「から始まる会話を新しい縦列へ | novel-dialogue.js + 独立novel.js、novel.css |
| [読書HTMLの実表示検査](./layout-qa.html) | ReaderV11対応の24条件観測ツール | 利用者が選択したHTMLと論理モデルJSON |

**v2共通部品**：standard.css（上下バー、縦書き、文字サイズ、寸法）と standard.js（表示実測に基づく改ページ、A−/A＋、スワイプ、原本表示、進捗、位置保存）。文章・画像・混在の3つの見本は同じ部品を使用する。見本用の文章は架空のオリジナルであり、実際の本ではない。画像は空欄のままにし、端末上で選択した原本画像をそのまま表示して試せる。

## 確定した共通レイアウト

- 上段：左「◀ 本棚へ」／右に小さな書籍固有の状態表示。その下に書名、さらにその下に「原本」「最初へ」「全巻」と、右端で一体になった「A− 20px A＋」。
- 本文：日本語明朝体・縦書き・右から左。初期20px、line-height:1.50、letter-spacing:0。
- **見出し（v2の文章・小説で同じ寸法）**：共通`standard.css`で`font-size:1.12em`（本文20px時**22.4px**）、`font-weight:700`、`letter-spacing:0`、見出し後余白`0.82em`（約18.37px）、独立した縦列として本文は左隣の次列から開始。色だけ歴史書型`#925341`／小説`#000000`（`novel.css`で色のみ上書き）を切り替える。A−／A＋では大きさ・余白が連動する。実書籍の改ページとiPhone実機の合否は別途検査する。
- 本文外枠：上下各10px／左右各12px。本文内部の重複paddingは0。右端に30pxの予備列を残す。
- **見える本文と隠し計測枠は同じsheet・stage・text-flow** を用いる。画面実寸を測ってページ分割する。22文字強制改行・語句の強制結合・文字縮小・overflowによる欠落の隠蔽はしない。
- 下段：細い進捗ライン、左「前へ」、中央「現在 / 総ページ」と原本情報、右「次へ」。上下バーと本文は重ならない。ブラウザー固有の上下ツールバーは実装しない。
- 画像：原本JPEG/PNG/WebPを再圧縮・再生成せず、object-fit:containで全体表示する。説明文が長い場合は**同じ画像DOMを保持したまま説明文だけ**をページ送りする。説明文のない画像ページは全高を使う。

## G4-04 改ページ候補選択と例外処理（2026-11-17）

小説専用 `novel.js` は句読点→文節／語句→安全な文字境界の優先順で候補を選ぶ。表示可能文字数が十分あるのに最初の句点で6字だけを切り出すことは避ける（最小の実読量を適用）。章・作品末の残りが極端に短い場合は元の文章を変えず、適切な候補を先読みして分量を調整する。 `撃｜ち抜いた`・`ベッ｜ド` 型、開きカギカッコのみの表示は異常候補として検査する。

安全な境界が収まらないときは、まず既存の内容を確定して新しい読書ページで再試行する。再試行しても分割不可なら `G404_NO_SAFE_PAGE_BOUNDARY` として組版を止める。不可避の文字単位分割を行った場合、境界の前後20文字・例外理由を `boundaryAudit()` に記録し、`NovelReader.inspect().g404Pass=false` とし、見える状態欄を `G4-04要確認` にする。警告だけで全項目合格としない。

テストは `tests/reader-g404-pagination.test.cjs` と、実読書HTMLの320／390／430px×16～30pxの24条件と追加の実画面条件で行う。見本・単体試験の成功は原本全字照合、独立第2校正、iPhone実機の合格ではない。既存60項目は増減しない。原本画像・OCR本文・校正版はバイト不変で保持し、実HTMLに版を変えて適用するときは保存後の再取得一致を確認する。

## 『世界の歴史1』型の原本跨ぎ本文連結（G4-02／G4-04）

`standard.js` は、原本の印刷ページ境界で読書画面を強制的に区切らない。原本照合により後続の文章が前の本文から続くと確定したとき、**後続側**の本文ブロックへ `joinPrevious:true` を付ける。`paginateBlocks()` で組版候補を選ぶ**前**に、`joinLogicalContinuations()` が続きの本文を一つの論理テキストとして扱う。既存書籍の原本文字列を変更・推測補完したり、画像を再圧縮したりしない。

- `kind:'text'` の `blocks` と、`kind:'mixed'` の `entries[].blocks` に対応。例：`{kind:'text',scan:20,blocks:[{type:'body',text:'前半'}]}` の次に `{kind:'text',scan:21,blocks:[{type:'body',text:'続き',joinPrevious:true}]}`。数値の連続から推測して連結してはいけない。
- 新刊を本棚に登録する際は、原本で確定した接続を含む全分冊を `tools/reader-shelf-register.py pack` に渡す。本文と図版を扱う歴史書、小説のそれぞれについて、入力と実行例は[本棚登録の手順](../../../reader/quality/SHELF_REGISTRATION.md)を参照する。
- 20枚ごとの制作分冊を本文の改ページ位置に使わない。原本照合済みの接続を全巻で適用してから、実際に収まる文字数で組版する。画面末では日本語の語境界と禁則を確認する。
- 本文の章・節・小見出しは新しい読書ページの右端から始める。見出しに続く本文は同じページの左隣から組む。原本で一つの見出しを複数のブロックに分けた場合だけ、2行目以降の見出しブロックに `continuesHeading:true` を付ける。目次の項目・図題・柱・通常の段落は各々の表示規則に従う。
- `type:'heading'`、`type:'toc'`、`type:'note'`、`type:'footnote'`、`type:'caption'` は本文の連結境界。これらは従来の表示書式を維持し、本文に無条件で埋め込まない。`kind:'break'` は表示ページを増やさない明示的な論理区切りで、連結を止める。
- 既定の `kind:'image'` は図版を独立して表示し、その位置で本文の連結を止める。**原本照合で図版専用ページを挟む連続本文と確認できた場合のみ**、当該画像の `entry` に `deferUntilContinuation:true` を付けられる。これにより図版のJPEG/PNGは保持したまま、続きの本文の**あと**に独立した図版ページとして提示する。前の本文や後続の `joinPrevious:true` が欠けていたら、図版を隠さず `G402_DEFERRED_IMAGE_*` の組版エラーにする。注記は別データ・本文参照として管理し、本文の一語の途中へ無条件に挿入しない。
- 元原本への追跡情報は `StandardReader.pageManifest()[].sourceSpans` の `{scan,sourceBlock,sourceStart,sourceEnd}` に残す。書記素オフセットは元の登録本文ブロックに相対的で、ひとつの表示ページに複数の原本ページが入っても消さない。読書ページに表示する原本番号は先頭側の原本を代表することがあり、表示番号のみを唯一の逆引き根拠にしない。
- `joinPrevious` なしの既存データでは、**従来の段落の分離と画像表示**を維持する。仕様の正式確認に必要な検査は `tests/reader-wh1-continuity.test.cjs`（合成文のみ）。現行60項目の原本照合、実HTMLの再生成と24条件以上の実ブラウザー表示、iPhone実機は別の工程であり、単体テスト成功だけで合格とは扱わない。

**注意：** この変更は、標準テンプレートの原本跨ぎ連結と図版の保持を扱う。小説のセリフ改列を標準テンプレートへ導入するものではなく、標準エンジンのすべての日本語語句境界を自動確定したと主張するものでもない。既存の私有『世界の歴史1』『世界の歴史2』のHTMLは自動更新されない。

## 小説の原本ページをまたぐ本文連結（G4-04・G4-02）

小説用 `novel.js` は、原本の印刷ページ境界を読書画面の強制改ページ点にしない。原本照合で一つの文・段落が続くと確認した場合に限り、**後続の本文ブロック**へ `joinPrevious:true` を記録する。組版直前に `joinLogicalContinuations()` が同じ読書テキストの連続したブロックを連結し、その後でG4-04の語句／文節境界を評価する。原文に空白や改行を足さず、原本のJPEG/PNGも変えない。

- `kind:'mixed'` の `entries:[{kind:'text',scan:12,blocks:[{type:'body',text:'前半'}]},{kind:'text',scan:13,blocks:[{type:'body',text:'続き',joinPrevious:true}]}]` のように、**後続側**だけを明示する。`kind:'text'` の `blocks` も同様。
- `joinPrevious` を原本番号から推測しない。独立した段落、見出し、目次行、開きカギカッコから始まる新しいセリフの前では連結しない。`kind:'image'` と `kind:'break'` は明示的な表示境界であり、この自動連結の範囲外とする。非隣接ページを図版・注記を挟んで接続する必要がある本は、本文と図版を別データとして整理し、明示的に確認した論理順を入力する。
- 一つの読書ページが複数の原本ページを含む場合でも、各表示部品の `sourceSpans:[{scan,sourceStart,sourceEnd}]`（原本ブロック由来の書記素オフセット）を保持し、`NovelReader.pageManifest()` で逆引きできる。本文を連結したからといって、原本番号を消さない。
- 変更するのは共通の**小説用**テンプレートだけ。既存の私有書籍HTMLは自動更新されないので、実書籍へ反映する場合は保存済みファイルを再生成し、G4-04・全文一致・原本対応・読書位置・画面条件を別に検査する。

確認は `tests/reader-novel-continuity.test.cjs` の合成データで行う。原本12→13に相当する継続、目次・見出し・セリフ・画像・明示的breakの障壁、複数原本の逆引きオフセットを検証する。これは実書籍の全文校正やiPhone実機検証の代わりにはならない。

## 小説専用テンプレート（歴史書の組版は変更しない）

`novel.html` は**見本用の架空の短編**です。『ナイン・ストーリーズ』の原本JPEG・日本語訳・OCRは含めていません。停止中の41〜60の制作をこの見本で再開することはありません。

- WH1と同じ基本レイアウト：本文明朝系、20px、列間 `line-height:1.50`、文字間0、縦書き右から左、A−/A＋、前後スワイプ、読書位置保存、上下バーの配置と原本表示。
- **小説の小見出し・章見出しは黒（`#000`）**で表示する。通常の歴史書の見出し色は変更しない。表示本体と隠し計測枠の両方で同じ色を適用する。
- **セリフの始まり「は、必ず独立した新しい縦列の先頭に置く。** 前の地の文と同じ列には続けない。会話は行頭の空白を足さず、セリフ以外の通常段落は先頭を1字下げる。1文字数固定の改行や、閉じカギカッコに合わせた文章改変はしない。
- `novel-dialogue.js` は**セリフの各「**を独立した縦列の開始として扱う。OCRで閉じカギカッコが欠けても、後のセリフまで改列不能にならない。最上位の区別をOCR記号の個数だけで推測しない。
- 一つのセリフの内部の入れ子引用「」は、原本照合で入れ子と確認した**開きカギカッコの原文オフセット**を `inlineQuoteOffsets:[...]` に指定する。指定値が原文の「位置と異なる場合はエラーとする。閉じカギカッコの不足は文字認識上の未校正課題として別記録し、組版だけの検査合格でOCR全字校正済みにしない。
- 看板の文字、用語、作品名など**セリフではない**引用に `「...」` が含まれる場合は、原本に基づく段落登録で `quoteMode:"inline"` を指定する。これは会話の改行を無効化する例外であり、実際のセリフに指定してはいけない。
- 原文には改行文字・全角空白を**自動で挿入・削除しない**。段落の分類だけを変える。各原本ブロックの元テキストと段落分割結果を連結すると完全一致することを毎回確認する。
- 表示する本文と隠し計測枠に**同じ novel.css**を適用し、計測したページだけ出す。長いセリフが複数ページに続いても最初の「を重複再表示しない。原本ページの情報は保持する。
- 小説用の `novel.js` は既存 `standard.js` の独立コピーであり、歴史書などの既存テンプレートを直接改造しない。

データ例：
```js
window.READER_BOOK={
 id:'PRIVATE_BOOK_ID', kind:'text', title:'書名', totalScans:60,
 blocks:[
  {type:'body',scan:41,text:'地の文。人物が言った。「こんにちは」'},
  {type:'body',scan:41,text:'「おはよう」'},
  {type:'body',scan:42,text:'看板の「待合所」という文字を読んだ。',quoteMode:'inline'}
 ]
};
```

**注意：** これは*組版テンプレート*の実装と見本であり、原本の独立全字照合・図版の検査・iPhone実機でのスワイプ／ピンチ操作・60項目の合格を保証しません。小説実書籍への適用時は現行正本60項目と制作・公開証拠ゲートを通常どおり実行します。原本や私有データを公開サンプルに埋め込みません。

## 新しい本を作る手順

1. [現行60項目の正本（参照先）](../../../reader/quality/README.md)を読む。原本・OCR・図版は私有領域に保存し、SHAと校正履歴を記録する。
2. 本文ページにはtext.htmlのレイアウト、原本画像・図版ページにはimage.htmlのレイアウトを使う。**実書籍の文章・画像を公開見本のREADER_BOOKに直接貼り込んでコミットしない。** 端末または認証済みGoogle Driveから私有ZIPを読み込んだ後に、書籍ごとのデータを渡す。
3. 本文のデータ例：{id, kind:"text", title, totalScans, blocks:[{type:"heading", scan:1, text:"..."}, {type:"body", scan:1, text:"..."}]}。文章は原本照合済みのテキストだけを使い、段落と見出しは独立して管理する。
4. 画像のデータ例：{id, kind:"image", title, totalScans, figures:[{id:"f-1", scan:1, title:"...", alt:"...", src:PRIVATE_OBJECT_URL, caption:"..."}]}。srcは元ファイルのBlobから得たURL等を実行時に渡し、GitHubの公開ソースへJPEGやPDFの本文を埋め込まない。図版と説明文を必ず対応付ける。
5. 新しい本の入口を登録するときは、既存のreader/quality/RELEASE_PROCESS.mdとtools/reader-release-control.cjsの公開検査を通す。テンプレートの表示が動いたことを、OCR全文校正やiPhone実機確認の合格に置き換えない。

## 品質確認

- **本文と画像を混同しない**。本文・段落の改ページと、図版を固定した説明文の改ページは別処理。
- 320／390／430px × 16／18／20／22／24／26／28／30pxの24基準条件に加え、355px幅等の実端末に近い条件で検査する。
- 原本・校正本文とページ表示を往復連結し、1文字の欠落・重複、図版の切れ・複製、途中で終わる段落、句読点の崩れを確認する。
- 原本JPEG/PNGのSHAを固定し、写真を生成AIで描き直さない。
- iPhone Chromeの等倍スワイプ／全画面ピンチ／拡大中のパンと、Chromiumの自動表示検査を**別の合格記録**にする。
- HTMLの見本は**共通のUI雛形**であり、実配布書籍の読み込み・保存・公開資格はそれぞれの制作工程で確認する。

## 変更管理

現行の安定した英国版読書入口 reader/british-interiors/full/index.html は変更しない。テンプレート側の更新はstandard.cssとstandard.jsで行い、文章・画像の双方を回帰確認してから新刊へ使用する。既存書籍を無検証で新テンプレートに一括置換しない。

## v1からの実装修正（2026-11-15）

- v1の `scrollWidth/scrollHeight` のみの改ページ判定を廃止。`Range.getClientRects()` で表示候補の縦列と文字領域を検査し、20px時に最低24pxとなる画面下端の安全余白を**表示・隠し計測の双方**へ適用する。短い画面でも下端余白を削らない。
- 文章用と画像用の独立デモは維持し、`kind:"mixed"` と `entries` で同じ本の中で原本順の本文・原本画像・図説を切り替える。`caption` が複数画面になる場合、図版DOMは同じまま説明文だけを切り替える。
- 2指ピンチはブラウザーの標準倍率を利用。埋込み時は親の認証された `reader-viewport-v8` 通知がない限り、危険な読書ページ送りを無効化する。親・子の倍率を区別し、等倍復帰で上下スワイプを復元する。接触対象と祖先要素の `touch-action`、原本／図説／本文の操作を端末で別途実測する。
- ブックごとの `standard-reader-v2:<bookId>` に文字サイズ・読書位置を保存する。旧v1のローカル保存を削除・上書きしない。iframeの親への保存通知は、親が対応している場合のみ有効になる。
- 文章はグラフェム境界で分割し、句読点付近の自然な切れ目を優先する。既知の「いずれ｜も」型の分断と年号・数値＋単位、行頭の閉じ句読点は、入る範囲で次画面へ送る。1文字すら安全に置けない場合は勝手に隠さず組版エラーを表示する。すべての日本語の語句境界・原本全文字・全24条件・iPhone実機の合格は**実書籍ごとに別途検査**する。
- v1は旧確認画面のため保存。新しい本はこのv2を用いる。GitHub Pages上へ原本・OCR本文を直接貼らない。

### 混在データ例

```js
window.READER_BOOK={
  id:'private-book-example',kind:'mixed',title:'書名',totalScans:40,
  entries:[
    {kind:'text',scan:21,blocks:[{type:'heading',text:'見出し'},{type:'body',text:'原本照合済みの文章'}]},
    {kind:'image',scan:22,id:'scan-22',title:'原本22',src:PRIVATE_BLOB_URL,caption:''}
  ]
};
```
このコードは形式見本であり、実際の文章・画像・図説の登録には原本照合と私有端末上の読み込みが必要。


## 汎用の実表示検査ツール（2026-11-20）

`layout-qa.html` は公開可能な検査プログラムだけを持ちます。書籍本文・原本画像・私有JSONは同梱せず、特定書籍の配布入口・公開許可・完成判定を代行しません。端末でHTMLと同じ版の `reader_logical_stream.json` を選び、明示的に読み込みを開始します。この検査コードにはサーバー送信処理も保存済み書籍の自動読込もありません。

対応する実HTMLは、`ReaderV11` のページ・文字・実DOM観測API、`readerVerifiedStructure.model`、`HeadingDOMProbe` を持つものです。対応しないHTMLを別エンジンへ偽装して検査しません。入力の実バイトSHA、JSONファイルSHAと正規化モデルSHA、見出し台帳・独立承認へのbindingを区別し、モデル不一致や実寸不一致は停止します。

320×740、390×844、430×930の各実iframe表示寸法で16～30pxの8文字サイズを測ります。全読書ページを巡回し、見出し・本文全文・文字の欠け・画像全体・横書き説明・説明送り中の画像固定を記録します。途中停止・失敗・未実施を合格へ変換しません。任意の見出しは検索語を入力して確認できます。

保存する見出し観測は既存の `reader-heading-dom-observations-v1` とbindingをそのまま保持します。全体の観測報告は `reader-browser-qa-v1` です。見出し観測JSONは現行の私有 `heading_render_audit.py` 等へ入力し、モデル・台帳・原本証拠との正式な照合を別途実施します。表示観測だけで原本校正、正式60項目、公開された書籍、iPhone実機を合格にしません。

この追加は共通機構の変更としてレビューします。`tests/reader-layout-qa.test.cjs` は合成API・DOMによるコード回帰であり、実書籍の24条件表示ではありません。Pagesでは既存の書籍preflight・隔離stage・release-controlを維持し、生成後の公開ツリーのQAコードが検査したソースと同一であることを専用テストで確認します。書籍registry・receipt・互換baselineはこのツール掲載のために変更しません。

配信後は `tools/verify-layout-qa-pages.cjs` が公開QA URLのHTTP 200と実配信SHAを再取得し、`reader-layout-qa-public-evidence` に保存します。この記録はQAプログラムの到達性とバイト一致だけの証拠であり、私有書籍の配信・校正・実機の証拠ではありません。

## 原本20枚ごとの校正と校了

原本の順で20枚ずつ照合する。最終分冊は残りの枚数を対象にする。新規制作・既存稿の修正とも、選定済みの書籍ID、原本番号、原画像のSHA-256を引き継ぐ。

1. 原本の紙面全体を端まで見て、本文、見出し、図説、注、ふりがな、図版、目次、その他の各領域を記録する。領域IDと原本座標を付ける。説明だけが前後の原本に載る場合、複数の図を説明する場合、飾り罫を含む場合も記録する。独立した領域一覧は、OCRの検出候補や登録済み図版から作らない。
2. 原本を見て、読書表示を伏せた状態で読めた文字と領域の所属を確定する。ふりがなは親文字の位置・範囲と読みを対で記録する。全文字を確認した種類だけを確認範囲に加える。該当領域がない場合も、原本と独立照合の両方で確認した種類を記録する。判読不能は箇所・根拠と読書上の表記を残す。未照合、推定、候補の残存を判読不能として確定しない。
3. 実際の読書画面を開き、原本から挙げた各領域を読み返す。次に表示された文字・領域を原本へ逆にたどり、欠落・余分な文字・誤った所属・重複を照合する。図の説明、別ページの注、ふりがなの親文字と読み、見出しの改ページも含める。同じ版の実表示証拠を採る。値の転記、原本画像を開いただけの画面、機械検出だけで読書表示済みとは記録しない。
4. 1件ずつ一致・訂正を反映して再照合・原本判読不能の結果を記録する。原本と独立照合・実表示の8種類を全て比較し、未照合、未解決の差分、出典不明の表示がゼロになった分冊を校了する。判読不能の確定数は校了時も明記する。一部分だけの突合は対象と件数を示した部分校正とし、ほかの分冊へその状態を引き継がない。全巻の校了は依頼範囲に含まれる全分冊がこの条件を満たした時点で記録する。

後日の修正では原本・証拠・読書用成果物の版やSHAを確認する。変更の影響を受けた箇所と接続先を再照合し、新しい成果物に結び付く表示証拠を採る。原本と独立照合が同じ場合はその証拠を引き継ぐ。分冊の校了、60項目検査、公開承認、iPhone実機での確認はそれぞれの結果を記録する。

`templates/reader/v2/proof-inventory.schema.json` に沿って、作業用の `templates/reader/v2/proof-inventory.json` を私有の制作フォルダーへコピーし、依頼の書籍ID・範囲に合わせて各原本に行を設ける。各画像、領域一覧、独立照合のファイルを相対パスと実バイトのSHA-256で結ぶ。書籍の私有品質manifestの `proofInventory` にはこの記録の `path` と `sha256` を指定する。

- `census` には `scan`、`sourceSha256`、`reviewedBy`、`edgesChecked`、`completeScopes`、`regions` を記録する。各領域は `id`、`scope`、原画像の `box` を持つ。種類は `body`、`heading`、`caption`、`note`、`ruby`、`figure`、`toc`、`other`。一部分だけを照合した領域には `partial: true` を付ける。
- `review` には `scan`、`sourceSha256`、`reviewedBy`、`blindToOutput: true`、`completeScopes` と領域ごとの `id`、`state`、`value` を記録する。照合済みの状態は `matched`、`corrected`、`illegible`。通常の文字は `text`、見出しは `text` と `startsPage`、ふりがなは `base`、`reading`、`start`、`end`、`parent`、画像は `sha256` で突合する。
- 判読不能を確定するときは `census` の領域に `illegible: true`、`review` に根拠と原本のSHA・矩形・注を残す。読書画面が注を表示する場合はその文と元の画像を照合する。原本ボタンを使う形式では、正しい原本を実際に開いて原本番号・画像SHA・寸法・矩形・画面証拠を記録する。注を私有記録に残す場合は、読書画面上の前後の文字も観測して余分な文字が入っていないことを確かめる。確認できない箇所は保留する。
- 独立した見出しは実画面の先頭から始まることを確認する。原本で本文内見出しと確定した場合は `census` の `placement: "inline"` と根拠の `placementReason` を記録する。
- 実表示の `readback` はその成果物の `artifactSha256` と採取時の各原本ページの `capture`、`completeScopes`、観測済みの領域・値を持つ。図説だけを確認したときは図説の範囲に限定する。本文中に正しく印刷された「17」も、誤って本文へ入った「17」も、原本で読みと所属を確かめる。

```sh
node tools/reader-proof-batches.cjs --artifact PRIVATE/reader.html --inventory PRIVATE/proof-inventory.json --book-id BOOK_ID --start 1 --end 20 --readback PRIVATE/readback.json
```

`--require-complete` は全範囲の校了を要求する場合に付ける。通常の制作・再開では、未照合が残る分冊と対象の種類を引き継げる。

『世界の歴史1』の読書経路では、実際に配布するZIPと本棚のサイトを使って観測記録を採る。`--route shelf` は本棚、`--route part` は分冊を開く。領域IDとDOM内の位置の対応が必要な場合は `--locations PRIVATE/locations.json` を追加する。対応ファイルには位置を記し、原本から転記した期待文字は渡さない。

```sh
python tools/reader_shelf_readback.py --archive PRIVATE/book.zip --inventory PRIVATE/proof-inventory.json --site SITE_ROOT --chromium CHROMIUM --route shelf --start 1 --end 20 --out PRIVATE/readback.json
```

標準・小説の分冊は、下記のコマンドで対象HTMLの実画面を読み返す。本文・見出し・図説・ふりがなの観測値を、原本から作った独立照合記録と比較する。

```sh
python tools/reader_template_readback.py --html PRIVATE/reader.html --inventory PRIVATE/proof-inventory.json --out PRIVATE/readback.json --chromium CHROMIUM
```

### 図説の短い最終行を確かめる

原本で図説の先頭から最後の句読点までを読み、末尾の短い行と、その近くの本文・注の所属を確かめる。図説が複数段に続く場合は段順を記録し、複数の図に共通する説明は、その説明を使う全図のIDを記録する。

新規制作・補修とも、図説候補行 `rows` に加えて、原本のOCR全行を `sourceRows` として渡す。`endingCandidates` は、直前の図説行、末尾に続く可能性がある未割当行、原画像内の座標を返す。`caption-ending-review` が付いた原本では、画像から読み取った文字と元の本文をそれぞれ照合し、戻す行と取り除く混入行を原本上で特定する。OCR自体が落とした行もあるため、候補0件の図説も原画像で最終行を確認する。

合成例では `short-line` が末行候補となり、原本照合を求める終了コード2を返す。

```sh
python tools/figure_caption_geometry.py templates/reader/v2/caption-ending-geometry.example.json
```

読書画面では、図説が複数ページになる場合も次画面へ進み、全ての断片が順にそろい、原本どおりに終わることを確かめる。原本画像・矩形・対応する図と本文・訂正後の実表示に証拠を結び、確認できた領域を所属する20枚の進捗に反映する。

## 原本全体から図と図説を照合する

新規制作・次の20枚・既存稿の補修では、分冊の原本を1枚ずつ端まで見る。図のある場所と図説のある場所を先に列挙し、図のない紙面、説明が隣の原本に載る紙面も記録する。挿図・地図・複数図・全面図版には図ID、原本番号、矩形、対応する説明IDを付ける。説明がないことを紙面で確認できた図は、説明IDの空配列を記録する。原本をまだ開いていない紙面は未確認のまま残す。

読書画面を伏せて、原本の各図説を最初の字から最後の句読点まで読み、段順・対応する図・親文字とふりがなを記録する。独立したレビューにも図と図説の件数を残す。原本の全OCR行を別に保存し、図の下、横、間にある行と、本文に誤って入った短い行・語頭・最終行を座標で照合する。候補の各行に所属先と根拠を記録する。OCRが拾わなかった行も原本から補う。

実際に配る分冊と本棚で、各図説が続く画面の最後まで読み返す。余分な図・図説、消えた説明、取り違えた図、末尾の欠落、ふりがなの親文字と読みを、原本から表示へ、表示から原本へともに照合する。図を複数まとめる場合、別の原本の図を説明する場合、原本1枚を画像のまま表示する場合も、印刷された関係を記録する。照合結果は20枚ごとに確定し、未確認があれば原本番号・理由とともに引き継ぐ。図説の校了を本文・他の領域の校了と区別する。
新規の私有原稿を `reader-private-pipeline.cjs init-resolved` で取り込むと、原本実体から `caption-work` にページごとの未確認台帳ができる。原本から先に制作するときは、`templates/reader/v2/caption-sources.example.json` の入力例に合わせて `sources.json` を作る。掲載する全原本の番号と画像・元OCRのパスを記す。未入手の入力には `null` を指定する。

```sh
python tools/reader_caption_prepare.py init --sources PRIVATE/sources.json --out PRIVATE/caption-work
python tools/reader_caption_prepare.py attach --work PRIVATE/caption-work --sources PRIVATE/later-sources.json
python tools/reader_caption_prepare.py sheets --work PRIVATE/caption-work
python tools/reader_caption_prepare.py crops --work PRIVATE/caption-work
python tools/reader_caption_prepare.py refresh --work PRIVATE/caption-work
```

`attach` は後から届いた原本・同じ原本の元OCRに使う。画像と図説の原本座標を記録してから `crops` で周囲の本文を含む拡大画像を作り、原画像と照合する。`refresh` で記録の版を固定する。`caption-census.json` は全ページを原本、独立した棚卸し、読書表示を伏せた照合、元OCR、OCR全行の検査に結び付ける。空の雛形を作った時点では全ページが未確認となる。

制作中の私有manifestでは `captionCensus` に索引の相対パスとSHA-256、`captionReadbacks.part` と `captionReadbacks.shelf` に各経路の実画面記録の参照配列、`captionArchive` に実配布ZIPの参照、`captionSiteRoot` に実際に観測した本棚の検査用サイトの相対フォルダーを指定する。`bind-captions` の選定ファイルは `bookId`、`range`、`captionCensusPath` とこれらの実表示参照を持つ。元OCRの独立した受領記録があれば、その相対パスとSHA-256を `captionOcrOrigins` で指定する。原本とOCRの受領時に固定されたハッシュが校正用のOCR全行と一致することを検査する。既に採用したOCRを別の版に切り替える場合は、選定ファイルに旧受領記録の `previousOcrReceiptSha256` を指定する。原本の棚卸しが先に進んだときは、実表示の配列を空にして読戻し待ちのまま保存できる。

```sh
node tools/reader-private-pipeline.cjs bind-captions PRIVATE/manifest.json PRIVATE/selected-bindings.json
node tools/reader-source-pages.cjs PRIVATE/manifest.json --request PRIVATE/request.json
python tools/reader_caption_census.py --index PRIVATE/caption-work/caption-census.json --book-id BOOK_ID --start 1 --end 20 --part-readback PRIVATE/part.json --shelf-readback PRIVATE/shelf.json
```

原本の矩形、対応する図、独立した転記、ふりがなの文字範囲、OCR行の採否を記入する具体例は `templates/reader/v2/caption-review.example.json` を参照する。

同じ書籍の棚登録用 `--proof-index` にも `captionCensus` の相対パスとSHA-256を指定する。分冊用と本棚用の読書HTMLが別の場合は各メンバーの `readback` に対応する実表示を登録する。標準・小説で同じ読書HTMLを両経路で使う場合は分冊を `readback`、本棚を `shelfReadback` に指定する。実画面の記録を別経路に流用すると、その原本は未確認になる。上記の診断は原本と表示の対応を返す。通常の完成検査・本棚登録は、採用した実体のSHA・対象範囲・読書経路も照合する。

### 照合済みの分冊を全巻に引き継ぐ

分冊ごとに台帳を作った場合は、採用する台帳のパスとSHA-256を `selected-batches.json` の `batches` 配列に記録する。各要素は `{"path":"001-020/caption-census.json","sha256":"採用台帳のSHA-256"}` の形式で、一覧全体には `bookId` と全巻の `range` を付ける。

```sh
python tools/reader_caption_prepare.py combine --selection PRIVATE/selected-batches.json --out PRIVATE/combined-r1
```

出力の `caption-census.json` を制作と本棚登録の両方に指定する。提出した分冊の原資料と元OCRの受領記録を引き継ぎ、未提出の原本は未確認として集計する。次の分冊を追加するときは同じ採用一覧に追記して新しい出力先にまとめる。同じ原本に異なる照合結果が指定された場合は、元の分冊を確認し、採用する版を一覧で指定する。
