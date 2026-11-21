# 本を作るときに必ず実行する制作・公開手順 v3（現行60項目の運用追補）

正本は [現行60項目ルール（参照先）](README.md)。この文書は61番目の検査ではない。原本JPEG・PNG、一次OCR、校正版、図版、読書位置、60個の状態と検査証拠を消したり改変したりしない。

## 制作を始める・再開する入口

WorkとChatは同じ [再開手順](WORK_RESUME_PROCESS.md) を使う。現在の制作台帳、
選定されたルール/実行版、私有品質manifest、60項目の評価と採用HTMLを一つの
PRIVATE entryから照合する。過去の公開入口や歴史保管用の台帳から、新しい初稿を
作り直してはいけない。新規書籍で現行作業がまだない場合だけ工程0から初期化し、
既存の原稿・訂正履歴がある場合はそれを再開する。

制作担当は、再開資料を選ぶ前に依頼から書籍ID・原本の開始／終了番号を確定し、私有の `request.json` に記録する。共通の再開入口と旧形式用の作業計画には毎回 `--request PRIVATE/request.json` を渡す。別の本・別範囲・依頼記録欠落で停止したときは依頼に合う資料を探す。

制作の順序は、原本保全と範囲確定、領域と読順の棚卸し、転記と独立原本照合、
本文/見出し/図版/注記の構造確定、承認済み入力の統合4工程、HTML凍結、必要検査、
完成判定と配布、実機確認を保つ。正式な10工程の名称と条件は採用する共通正本と
`workflow_contract.json`を使い、この概要を別の制作基準にしない。

60項目の残要件から選ぶ作業と、配布を許可する判定は別である。配布同意・保存・
公開・実機が待ち状態でも、その前提に依存しない原本確認や構造検査は進める。
現在の評価に保持された部分合格は再利用範囲を示すが、条文全体の合格ではない。
検査の再利用には対象・SHA・依存関係・検査コード・環境・証拠実体の一致が必要である。
報告の更新だけで原本を再OCRしたり、同じHTMLの24条件を再実行したりしない。

## 現行の共通読書テンプレート

新しく作る本は `templates/reader/v2/{text,image,mixed}.html` と `standard.css`／`standard.js` を基準とする。v1は既存参照用としてバイト不変で保持。v2のUI自動試験に通っても、原本全文字・60項目・iPhone実機の合格ではない。実書籍の文章と図版を公開見本に含めず、私有HTMLへ統合して別途検査する。

## 目次の原本画像保持と文字組版の両立（既存60項目の実行条件）

**目次を画像表示だけに限定しない。** 原本JPEG/PNGは変更せず、いつでも「原本」で確認できるように保持する。同じ目次を、原本にある全項目・作品名／章名・印刷ページ番号・順番を独立して照合した**読める文字ページ**としても用意する。目次の掲載位置・分類が `pageType:"toc"` という理由だけで読書用テキストを破棄・無視したり、画像へ強制変換したりしない。

これは新規の第61項目ではなく、現行正本の G1-05（ページ分類）、P20（目次の原本照合）、G7-10（目次の項目と番号の一体性）、G7-12（原本不変性）を実行するときの具体的な条件である。原本の各行・列を読み直し、作品名やページ番号が文字データと一致することを確認し、長い題名と番号を改ページで分離しない。目次は独立した読書区間にし、読書本文に未収録の作品は目次上に残しても未収録先へは移動できないようにする。

図版を伴う目次でも原本は不変で保持し、実物の構成に基づき文字組版と画像表示を切り替える。独立照合が不足すれば該当項目は `not_run` / `needs_source_review` とし、画像が表示できるだけで目次の合格を宣言しない。本文も原文と目次の間で文字の追加・削除・重複がないことを別に確認する。

## 分冊・統合後の原本全ページ照合

各20枚の分冊と統合した全範囲の双方で、採用した HTML の私有 manifest を照合する。依頼の原本番号を全件数え、端まで確認した領域台帳と、初稿を見ずに原本から読んだ第二稿を使う。

```sh
node tools/reader-source-pages.cjs PRIVATE/manifest.json --request PRIVATE/request.json
```

`totalScans` は依頼範囲、`matchedScans` はページ単位の照合記録がそろった数、`queue` は原本番号・欄・理由の一覧。本文の欠落が疑われるときは初稿・第二稿を並べ、原本の該当欄を全文読み直す。違いを解消した記録には既存の `field`, `firstSha256`, `secondSha256`, `canonicalSha256`, `regionId`, `reviewedBy`, `reason`, `resolved` と、原本画像の `sourceSha256`、読み直した採用欄の全文 `sourceReading` を記録する。訂正履歴がある欄の `firstSha256` は凍結した初稿の欄を指す。本文欄から独立に抽出した図注も同じ方法で確認する。白紙は両方の領域確認と `blankPage: true`, `hasReadableText: false` を記録する。

既存の `allScanReview` 形式に残っている一次・追加の保留件数は `pendingImportedFindings` に引き継ぐ。個別に決着した箇所は `resolutions.carriedIssues` に原本番号 `scan`、元のグループ名 `group`（pending または extraPending）、その記録順 `ordinal`（1始まり）、元記録の `priorReviewSha256`、`sourceSha256`、採用欄の `field` と `canonicalSha256`、`regionId`、`offset`（コードポイント、0始まり）、`sourceReading`、`reviewedBy`、`reason`、`resolved: true` を保存する。他形式の既知の指摘は `resolutions.openIssues` に原本番号と内容を引き継ぐ。

確認版では未解決ページを表示・引継ぎし、作業可能な別ページの校正を続ける。原本の読みが確定したページだけを校了の対象とし、既定の検査を実行する。

## 小説用の会話文レイアウト（ナイン・ストーリーズ以後の小説向け）

縦書き本文・見出し・目次は、[縦書き記号の組版と検査](VERTICAL_SYMBOLS.md) を適用する。原稿の半角 `?` と全角 `？` は、読書画面と改ページ計測の両方で全角 `？` の正立表示に統一する。感嘆符は元の文字幅で正立させ、括弧・句読点・長音には縦組字形を使う。既存エンジンを再利用するときは生成前に `reader-vertical-symbols.cjs apply` を実行し、全分冊と統合HTMLに `check` を実行する。

原本で作品・章の開始と確認した見出しは新しい読書ページの先頭に置き、収まる冒頭本文はその左列に続ける。分冊と統合後の HTML は、文字サイズ変更後も各作品の先頭を実表示で確認する。小説の確定時は原本で確認した作品・章を領域台帳の heading に登録し、同じ HTML の既存の DOM 観測（heading_dom_probe.js）が記録した全ページ・24条件のファイルを display.headingObservations に指定する。採用済み previewDisplay.observations も利用できる。複数の異なる文字欄が一つの見出し領域を参照する場合は headingField に見出し本文の欄を指定する。

小説で日本語の会話文を扱う場合は、歴史書の通常文章テンプレートとは別に `templates/reader/v2/novel.html`、`novel-dialogue.js`、`novel.js`、`novel.css` を参照する。これは現行60項目の追加・緩和ではない。WH1基準の明朝体20px・line-height 1.50・縦書き右から左・上下バー・原本保全・位置保存は共通。

会話文の最上位の開きカギカッコ `「` が現れたら、表示上で**必ず新しい縦列**から始める。セリフの先頭は字下げしない。地の文は通常の段落書式に従う。書籍の原文には改行・空白を捏造して挿入しない。閉じカギカッコ、入れ子の引用、会話前後の本文、原本ページをまたぐ文脈は校正原本で確認する。看板・題名などセリフではない引用は原本で確定した場合だけ `quoteMode:"inline"` で例外指定する。文字列の完全一致と列頭での表示を別々に検査する。

既存の『ナイン・ストーリーズ』001〜040を無検査で差し替えず、停止中の041〜060のOCR制作もこのテンプレート作成だけでは再開しない。実書籍への適用時に改めて工程ゲートと表示・iPhone実機の検査を行う。


## 工程別の実行証拠ゲート（2026-11-16運用変更）

**新しい品質検査項目は追加しない。** 正本60項目と既存 `reader-release-control.cjs` の判定をそのまま使い、作業の**進行判定**と**完了表現**だけを証拠に基づいて制御する。口頭の「確認済み」、チェック欄だけの `passed`、Actions 成功だけで先に進んだり公開完了と報告したりしない。

| 段階 | 進行前に必要な証拠 | 許される判定 |
|---|---|---|
| 原本・継続データ | 既存の私有マニフェスト、原本・前版・訂正履歴、SHA/範囲照合 | 検査前は作業中。未確認を校正済みにしない |
| 原本独立照合・組版 | 原本の全領域、独立第2稿、訂正差分、原本・本文一致、実配布候補の24条件を含む正本60項目の制作側証拠 | `prepare` が合格した場合に限り非公開の新規仮保存 |
| Google Drive 仮保存・読戻し | 同一DriveファイルIDの実体を再取得し、現行読書HTMLの SHA-256 と一致する G8-08 証拠 | `release` 合格の場合に限り公開承認の証拠作成へ |
| 公開入口の承認・配信 | 公開専用ローダーの登録・正本ゲート・GitHub Pages配信後の**対象URLのHTTP 200と配信HTML SHA-256一致** | `deployed` と公開HTTP照合がそろって初めて「公開時点で配信確認済み」 |
| iPhone実機 | G8-04 の実機結果と対象版の証拠。Chromium代用不可 | `device` を満たすまで「実機確認済み」としない |

段階判定は検証済みの中核コードを呼び出す**読取専用**コマンドで確認する。下位工程に不備があれば後続は `not_evaluated` とし、完了報告を止める。

```sh
node tools/reader-evidence-gate.cjs PRIVATE/manifest.json prepare PRIVATE/reports/prepare-evidence.json
node tools/reader-evidence-gate.cjs PRIVATE/manifest.json release PRIVATE/reports/release-evidence.json
node tools/reader-evidence-gate.cjs PRIVATE/manifest.json deployed PRIVATE/reports/deployed-evidence.json
node tools/reader-evidence-gate.cjs PRIVATE/manifest.json device PRIVATE/reports/device-evidence.json
```

これらは**私有ファイルを読んで判定するのみ**。報告ファイルも公開GitHubには置かない。公開と実機の**最終完了判定**では、下記のようにGitHub Actionsで得た公開HTTP検査記録も入力し、同一書籍ID・ローダーSHA・HTTP 200・配信バイト一致と、`device` の実機証拠がそろった場合だけ `completedDelivery:true` とする。片方でも欠ければ未完了である。

```sh
node tools/reader-evidence-gate.cjs PRIVATE/manifest.json device PRIVATE/reports/final-evidence.json PRIVATE/reports/reader-public-delivery-evidence.json
```
従来の `reader-private-pipeline.cjs plan / verify-plan / complete-plan` と `reader-release-control.cjs check` は引き続き必須。進行判定の新設はそれらを置き換えない。

**明示的に受領を依頼された未完成の確認版だけは別経路**。利用者から当該SHAの明示的な確認依頼があり、`preview` ゲートと専用 `reader/preview/` の承認が通った場合に限り、未完成と明示して確認用として配布できる。`preview` の成功は `prepare / release / deployed / device` に昇格しない。

GitHub Pages の公開処理は `tools/reader-verify-pages.cjs` により、承認記録のある読書入口について公開された**実バイト**を確認し、その結果を Actions の `reader-public-delivery-evidence` として残す。検査が失敗・未実施・実行不能なら、URLを「公開確認済み」と報告しない。GitHubソース内にファイルが存在するだけでは配信済みとは限らない。

**手戻りを減らす運用：** SHA が不変で証拠が現行版と結び付く工程だけ既存証拠を再利用できる。変更された本文・原本・表示処理・設定・入口に依存する証拠は失効させ、影響範囲を再検査する。依存しない検査は並列に進められるが、前提未達の合格・完成宣言は不可。エラー時は工程名・原因・実行済み証拠・未実施を区別して報告する。

**強制範囲：** 公式の private pipeline／GitHub Actions を使う工程はゲートで止められる。ChatGPTの手動URL案内、外部サービスへの直接書込み、実機操作の実施そのものをプログラムが自動的に保証するわけではない。これらも同じ証拠確認を作業者が行う。

## 工程0：原本の発見・取得（ZIPを使う新規分冊の必須前処理）

過去の制作記録から**書籍ID・Googleドライブの親フォルダID・原本ZIPのファイルID・元ZIP SHA-256・原本画像総数**を回収する。ファイル名・更新日時だけで正本を決めない。過去の実行記録から元ZIPの所在が分かる場合はそれを優先する。

原本を探す際は（1）既知IDの実体照会、（2）`/Google Drive` が正規のGoogle Driveマウントであることの確認、（3）**対象フォルダの直接一覧と全ページ取得**、（4）必要に応じて検索語・ファイル種類を変えた検索の順に行う。検索0件を『存在しない』と読み替えない。MIME型は `application/zip`、`application/x-zip-compressed` 等を想定し、拡張子に依存せず元ファイルのZIP署名まで検査する。直接一覧に保存先候補があれば、通常検索に出なくてもそのIDで取得する。

取得したZIPはPRIVATE領域に置き、記録済みSHA-256、画像数、ZIP内部の順序、依頼した20枚の範囲と各画像SHA-256を照合する。ZIP内の元JPEG/PNGのバイトは改変しない。名前が同じでIDが違う、原本SHAが違う、一覧が途中で切れた、ZIPが不正なら自動選択せず作業を止める。失敗状態は `blocked` / `unresolved` と記録し、全ドライブからの『不存在』を主張しない。

前処理の証拠は `tools/reader-source-preflight.py` の入力 `reader-source-discovery-input-v1` と出力 `reader-source-preflight-v1` をPRIVATEに保持する。新規ZIP分冊の初期化には `reader-private-pipeline.cjs init-resolved` を使い、証拠と実際のHTMLに収録した原本画像のハッシュを再照合する。昔の作品の `init` や既存の正式60項目の実行／証跡／合格状態は変更しない。これは**検査61番ではない**。

最小入力形（全ID、ファイル名、SHAはPRIVATEで実値に置換する。検索0件でも一覧で発見可能）：

```json
{
  "schema": "reader-source-discovery-input-v1",
  "bookId": "sample-novel", "range": [41, 60],
  "expected": {"fileId": "PRIVATE_FILE_ID", "folderId": "PRIVATE_FOLDER_ID",
               "fileName": "PRIVATE_SOURCE.zip", "sha256": "64-char-sha256", "imageCount": 286},
  "lookups": {"searches": [{"query": "name", "resultCount": 0}],
              "byId": {"attempted": true, "found": true, "item": {"id": "PRIVATE_FILE_ID"}}},
  "folderListing": {"attempted": true, "complete": true, "folderId": "PRIVATE_FOLDER_ID",
                    "files": [{"id": "PRIVATE_FILE_ID", "name": "PRIVATE_SOURCE.zip",
                               "mimeType": "application/x-zip-compressed"}]}
}
```

```sh
python3 tools/reader-source-preflight.py --snapshot PRIVATE/source-lookup.json --archive PRIVATE/original.zip --report PRIVATE/source-preflight.json
node tools/reader-private-pipeline.cjs init-resolved PRIVATE/book.html PRIVATE/book-workspace BOOK_ID PRIVATE/loader.html PRIVATE/original-index.json PRIVATE/source-preflight.json
```

`source_ready_for_ocr` は原本所在とバイト一致の**限定検査**であり、原本の独立全字照合・60項目の合格・Chrome配信・iPhone実機の成功は意味しない。再アップロードを依頼する前に既知ID、正規マウント、直接一覧のページ送り、ZIP形式の変種、他の許可された経路を確認し、発見できないときは状況を `未確認` と報告する。

### 保存済みの範囲原本ZIPを使う場合

原本全体 ZIP の実 bytes が未取得でも、以前に無加工で保存した対象範囲 ZIP を
既知の別 ID から取得できる場合は、その ZIP を独立した対象原本として検査できる。
全体 ZIP の ID、サイズ、画像数を範囲 ZIP の値へ混ぜず、親原本の metadata と
取得・読取の状態を別の PRIVATE 来歴に残す。親が未取得なら ZIP 全体 SHA は未検証のまま。
ZIP を新しく組み替えたり、ダミー画像で元の ordinal を埋めたりして検査を通さない。

この経路は `scanMapping` を明示したときだけ有効で、未指定の既存 ordinal 方式は変えない。
たとえば実際の archiveScanRange が 20〜41、対象が 21〜40 なら `expected.imageCount` は
**実在する22枚**とし、`entries` に 20〜41 の22件を ZIP 内順序どおり省略せず指定する。
各 `entryName` は階層を含む実 ZIP 名と完全一致させる。

```json
{
  "schema": "reader-source-scan-map-v1",
  "archiveScanRange": [20, 22],
  "entries": [
    {"scan": 20, "entryName": "scan_020.jpg"},
    {"scan": 21, "entryName": "scan_021.jpg"},
    {"scan": 22, "entryName": "scan_022.jpg"}
  ]
}
```

上は3枚の構文例であり、`snapshot.scanMapping` に置く。実作業には省略のない全件の対応を使う。
`expected.imageSha256` には**対象範囲だけの全 SHA**を、既存の独立原本台帳から与える。
新 HTML 自身のハッシュ欄を独立台帳に読み替えない。重複、欠落、余剰、非連番、
範囲外、実 ZIP と名前・順序が異なる対応、SHA 不足・不一致はすべて停止する。
無効な `scanMapping` を指定しても既存 ordinal 方式へ自動的に戻さない。

検査成功は取得した ZIP の SHA・実画像数・対象画像 SHA の限定検査である。
`sourceScope=downloaded_archive_only`、`upstreamArchiveBytesVerified=false` を維持し、
全体原本の検証、校正、既存60項目、Drive の現行 HTML 読戻し、公開、実機確認へ昇格させない。
後段の `init-resolved`、配布・公開ゲートは従来どおり実行する。

## 他の書籍でも同じ校正ループを完了できる条件（追加の61項目ではない）

書籍の本文と画像の構成に応じ、[再校正プロファイル・状態遷移](REPAIR_PROFILES_AND_STATES.md) を使用する。
`reader-repair-plan.cjs` は従来の小説ページ単位進捗v1を保持しつつ、
歴史・解説書、写真中心、目次、文章と写真の混合本にはv2の
原本領域分類・文字領域の独立照合・非文字領域の画像保持・図版／注記関連照合を要求する。
未分類の画像ページを勝手にOCR対象にしない。実際に原本の文字が確認された
部分だけ本文・ラベル・キャプションとして再転記する。

一次再転記から二次校正、原本差分の解決、正式60項目の実施待ちへ
進む各状態は `reader-repair-state.cjs` と `reader-repair-transition.cjs` で
別々の証拠を確認する。旧稿のSHAを使って新しい稿の二次校正や表示検査を
済ませたことにはしない。これらの状態は **納品許可ではない**。
写真だけの書籍も原本JPEG/PNGの不変性、図版位置、文字の有無について
出典証拠を要求する。歴史書の非隣接の文章接続と図版・注記の関連も保持する。
## 納品停止を解決する再校正・作業キュー（既存60項目の実行支援）

納品ゲートは安全を守るために停止するが、**制作まで停止させるものではない**。
`reader-work-ledger-v1` の `pendingDraft` と実ページ別のPRIVATE証拠を
`tools/reader-repair-plan.cjs` へ渡すと、未完了作業を有限の順序で返す。

```sh
node tools/reader-repair-plan.cjs --request PRIVATE/request.json --book BOOK_ID \
  --ledger reader/quality/work-ledger.json \
  --progress PRIVATE/repair-progress.json \
  --output PRIVATE/repair-plan.json
```

初回は `--progress` を省略してよい。再転記の未実施ページ、第一稿と
独立第二稿の差分、ページ内部の境界、区間外の前後境界、既知の欠陥を
順に登録する。毎回最初の作業を実行し、原本照合の結果と参照SHAを
PRIVATEの校正記録へ保存する。合格済みの画面検査は**そのHTMLのSHAが
不変の間だけ**再利用する。文章を一文字でも修正したら新しいSHAを作り、
OCR・文境界・文字組版・対象画面・校正差分を再検査する。旧版は保持する。

このキューに記録があることは、独立転記・正式60項目の合格を意味しない。
人間・AIの自己申告を実証済みとみなさない。独立した原本照合で確認
できない箇所は、推測で補って完了扱いしない。**作業キューが最後まで
進んだ時点でも**既存の `reader-release-control.cjs` と
`reader-unified-handoff.cjs` が対象版について本当に `verified_release`
を出す必要がある。これは第61項目ではなく、合格に到達するための実行順序。

各チャットは「納品できない」と報告するだけでなく、その時点で実行
可能な次のページの再転記・差分解消を始める。原本へのアクセスが
ない場合のみ原因と残作業を報告し、実際に成功した作業を区別する。
公開URLや未校正の読書版を作業キューで勝手に納品しない。

## 画面検査の遅延防止（既存60項目の検査範囲を変更しない）

小説 `novel` の実配布候補は [SHA付き分割表示検査](FAST_LAYOUT_QA.md) を適用する。
幅320/390/430px×16〜30pxの8フォント、および高さ5条件の29条件を
一括の巨大処理にせず分けて検査。各条件終了時に結果をPRIVATEへ逐次保存する。
同一HTML SHA・同一検査プログラムSHAでPASSした条件のみ再利用できる。
エラー時は失敗した条件だけを再実行し、OCR本文の再転記・既存の校正・
原本ZIPの検査を自動的に最初からやり直さない。
他の書籍種類には各書籍プロファイルと実読書エンジンに一致した表示テストを使う。
29条件PASSは正式な原本全文字照合・60項目・iPhone実機確認の代わりにしない。

## 開始トリガー

利用者が「新しい本を作る」「次の20ページを作る」「既存本の読書画面を直す」と依頼するたびに、次の順番を実行する。

1. **原本と継続位置**: 利用者指定Google Driveフォルダ、原本ZIP、前回の読書HTML、訂正履歴、最後の読書位置、正本60項目を再読取する。書籍ID・対象スキャン範囲・原本画像SHA256・前版HTML SHA256を照合する。勝手に保存先を移動／変更しない。
2. **私有制作**: 原本画像をバイト不変のまま、OCR一次稿→独立原本照合→校正版→原本画像つき読書HTMLを別の私有版に書き出す。未確定箇所は `not_run` / `needs_source_review` / `failed` のまま保持し、推測で補わない。20枚は原本数であり読書画面数を固定しない。
3. **表示・操作**: WH1実画面、20px/1.50、縦書き右から左、正確なスワイプ／全画面ピンチ／拡大中パン／図版固定／文章逆連結／可変高さ／24条件を**実配布候補**で検査する。原本の全字独立照合、iPhone実機検査、Chromium検査を混同しない。
4. **Drive保存・読戻し**: `stage` は新規ファイルだけに保存。実際のDriveファイルIDを受取り、同一IDから再取得した内容・SHA256と対象範囲を比較する。修正版は上書きで旧版を失わない。G8-08が未完了なら「配布成功」を宣言しない。
5. **公開専用Chrome入口**: 利用者から明示的に受領を依頼された未完成の確認版は、`reader/preview/<book-range>/index.html` の専用ローダーだけをGitHubに置く。原本・OCR本文・JSON原稿は置かない。見える公開データと私有データをハッシュで対応づける。公開の失敗と校正の未完了を別々に報告する。
6. **書籍制作時の自動点検**: 新規／更新プレビューのプルリクエストで `.github/workflows/reader-book-creation.yml` を自動実行。書籍単位の登録・証跡・公開ローダーハッシュ・60-ID・プレビュー状態・私有データ混入を `node tools/reader-book-preflight.cjs --all` で点検する。単独本の場合 `node tools/reader-book-preflight.cjs BOOK_ID`。これに通ってもOCR／実機の60項目に合格したわけではない。
7. **品質ゲートと公開用ツリー**: 既存の `reader-release-control.cjs`／`reader-publish-stage.cjs` で全共有資産・既存公開済みファイルの不変性を検証し、承認済みの公開物だけをステージングする。GitHub Pages全体を配信するときも、既存の正常なURLを消さない。公開未承認のファイルを勝手に含めない。
8. **公開の事後確認**: GitHub Actionsの成功、個別Chrome URLのHTTP 200、ローダーの配信された実バイトのSHA256、Chromeでの私有HTMLの選択・表示を別々に記録する。実機iPhoneの合否は本人による実検査まで `not_run`。必ず **確認用URLを文字列・公開状態付き** で返す。失敗なら未公開と明記し、リンクだけで公開したと称さない。
9. **再開可能な検査台帳**: 書籍別 `bookId` / `range` / Drive ID / 原本ZIP SHA / HTML SHA / loader SHA / 状態 / 未解決項目 / 最終合格根拠 / 公開結果を保存。次の本や次の20枚で同じ手順を繰り返し、前々回の位置・原本も失わない。

## 証跡の世代互換（品質判定を緩めない）

- 公開証跡が発行時の検査コードのSHAに結びついている場合、**検査コード更新だけを理由に自動破棄しない**。旧証跡は発行時の識別値とダイジェスト、書籍ID、対象範囲、ローダー・レポート・実際の公開バイトの一致を再検証する。未確認の旧証跡は拒否する。署名による人間の審査証明であるとは称しない。
- 旧版の明示例外は **bookId・entry・issuer・receiptDigestが完全一致**したプレビューのみに限定し、`reader-release-control.cjs` の固定台帳へ記録する。新しい未校正プレビューには `previewProtocol: reader-immutable-preview-v3` を用いる。これは発行時検査エンジンの変更に耐える*プレビュー用の証拠形式*であり、通常版／`completed` の基準を緩めない。ファイル内容・60件・範囲・証拠・公開バイトの照合は毎回必要。
- 古い証跡を無検査で新しい `passed` に書き換えない。証跡のハッシュ不一致や既知欠陥がある場合、どの書籍・どのフィールドで不一致かを出し、別の書籍の状態や原本を変更せず停止する。

## 共通本棚・公開ゲートの世代整合

- 本棚キャッシュ／アプリのバージョンは公開時の `reader/library/sw.js` を読み、`reader/library/index.html` と一致するか検査する。自動テストに旧v16の固定文字列を別保存しない。**一致だけで合格とせず**、原本・保存・読書位置・オフライン・互換性・他書籍の回帰テストと公開ファイルの厳密なバイトピンも実行する。
- 書籍プレビューの不具合は書籍単位の事前検査と原因表示で切り分ける。GitHub Pages自体はサイト全体を配信するため、共有スクリプト／過去に公開したファイルの未承認変更があれば全体公開を止めることは正当。共有資産の検査を飛ばして個別URLを出さない。
- 未承認変更は人工的に `passed` とせず、どの旧／新のSHAが異なるかを記録する。検査の全無効化、`|| true` による失敗の無視、不要な旧版削除、ソースへの故障注入は禁止する。

## 検査と納品の表現

`book-create-preflight`、GitHub Pages成功、HTML保存済み、24条件の代表表示、OCR全字独立照合、現行60項目の合否、iPhone Chrome実機操作は独立の事実。ユーザーへの報告に **「対象範囲、Google DriveのHTML URL、Chrome確認URLと公開／未公開状態、実施済み検査、残る未検証項目」** を必ず含める。


## 工程9：チャットをまたぐ統一納品ゲート（既存60項目のまま）

**異なるチャット、別モデル、別のWorkから再開する場合も、判断基準は会話内の
自己申告ではなく固定台帳と同じ検査コマンドにする。**
公開GitHubの `reader/quality/work-ledger.json` は書籍ID・原本範囲・
原本ZIP SHA・納品候補HTML SHA・未解決不具合だけを持つ共有管理台帳。
**原本画像・OCR本文・校正根拠はプライベート保存のみ**。台帳の
`reviewed`、`candidate` を自己申告しても、その状態だけでは納品可能にならない。

通常納品は `tools/reader-unified-handoff.cjs --mode normal` が
`verified_release` を返した**同じHTMLのSHA**だけ許可する。
このコマンドは既存 `reader-release-control.cjs` と
`reader-evidence-gate.cjs` をその場で呼び直し、
現行60項目の合格と独立照合、実機、Drive同一ID読戻し、公開HTTP/SHA、
原本ZIPのSHA・各画像SHA、OCRの疑義を厳格に照合する。
前提不足・記録紛失・不一致は**default deny**。

`--mode audit` は不審なOCRを読取専用で検出するが**絶対に納品許可を返さない**。
`--mode preview` は未完成の確認版であり、対象版と残る検査を開示したうえで
その版を受け取る明示的な依頼を記録し、私有 preview manifest と同一の
同意ファイルが一致する場合のみ `unverified_preview_only` として扱う。
未校正OCRのv1文言条件は維持する。二稿照合済み・全QA未完了のv2は、
正確な開示に対する実際の肯定短答を保存し、未校正という虚偽の引用を要求しない。
通常の「作って」「次の20ページ」は preview の許可ではない。
preview の検査成功も 60項目やiPhone実機の合格ではない。

台帳の既知不具合を `not_run` に戻したり、過去のSHAの証拠を新しいSHAに
転用したりしない。更新時はGitHubのファイルblob SHAを使って競合検出し、
過去の版と公開済みURLを保持する。原本OCRの訂正や追加検査では必ず
別版のHTMLと検査報告を作る。新しい60項目IDは作らない。

**重要な限界:** GitHub ActionsはGitHubの管理対象となる公開経路を停止できるが、
別チャットで直接ChatGPTファイルリンクを出す操作やGoogle Driveへの直接書込みを
プラットフォーム全体で阻止することはできない。全経路を技術的に強制するには、
納品先の書込み権限を認証付きの単一APIへ集約し、ChatGPTからの直接納品を
禁止する外部権限制御が必要。現状は「公式制作経路は自動ゲート、
チャット直納品は共通手順でゲート実行」という区別を保持する。



### 照合済み・全QA未完了の確認版

原本二稿の差分が解消していても、小字の追加原本点検・表示・操作等が残る版は完成ではない。現在の状態と正確な版を先に開示し、その質問に対する実際の肯定返信を同意v2へ結び付ける手順は `RELEASE_PROCESS.md` を参照する。文脈の無い作成/URL依頼を同意に変換せず、未完了をpassedへ書き換えない。既存60 ID・数・順序と通常版基準は変更しない。

### 範囲付き校正稿の確認版 v3

本文を原本と比較した校正稿があり、独立全文二稿が未完了の場合は、旧v1の未校正文言やv2の二稿済み条件へ変換しない。`PREVIEW_V3_PROCESS.md`のscoped evidence・実24条件の動的状態・正規60assessment・実同意を使用する。既存pendingDraftで別SHAの新候補を保持し、明示した対象SHAだけを選択する。原本・台帳・同一ID読戻し・公開前検査を省略せず、通常版へ格上げしない。

## Workでの統合

依頼から書籍ID・原本全範囲を決めて先に記録した `request.json` を使用する。制作工程台帳の `book_id` と `scan_range` に同じ対象を明示し、統合が依頼範囲に含まれるときに `scope.include_merge` を有効にする。現行の配布ZIPを展開し、次の2工程を実行する。以下の PRIVATE と runtime は採用した実パスに置き換える。

1. 承認済みの統合台帳を制作工程台帳のcontent入力としてパス・実SHA付きで登録し、分冊を選定する。

```sh
python3 tools/reader-merge-work.py --runtime runtime stage --request PRIVATE/request.json --workflow-root PRIVATE --workflow-state PRIVATE/workflow_state.json --book-dir PRIVATE/book --manifest PRIVATE/book/merge_manifest.json --out-dir PRIVATE/approved
```

2. 新しく生成された `PRIVATE/approved/approved_files.json` を同じ制作工程台帳のcontent入力に登録し、そのSHAを固定する。次に同じ依頼記録を指定して統合する。

```sh
python3 tools/reader-merge-work.py --runtime runtime merge --request PRIVATE/request.json --workflow-root PRIVATE --workflow-state PRIVATE/workflow_state.json --staged-dir PRIVATE/approved --out-dir PRIVATE/merged
```

`source_page_start/end` には図版専用ページ・白紙を含む分冊の連続した物理範囲を登録できる。`nontext_pages` は本文のないページと理由、`source_scan_ids` と分冊の `scans` は収録する原本全件を指定する。旧形式の本文範囲も、収録原本・非本文分類を照合して受け付ける。旧選定一覧に依頼の記録がない場合は、校正済み入力を保持して選定から再実行する。

統合保留時には、同じ依頼の工程台帳に登録済みでSHAが一致する候補を使う。正しい候補が一つなら入口がそのまま選定・統合を実行する。複数候補の採用判断や変更済み入力の承認は採用記録で確認する。合格済み原稿を作り直さない。
採用済みの制作再開entryがある書籍は、両コマンドに `--entry PRIVATE/current-work.json --expected-entry-sha256 ENTRY_SHA` を付ける。ENTRY_SHAは選定記録の外部固定値を使う。統合が保留になったらWorkは結果の `nextAction` と `diagnostics` の該当箇所を処理する。個別ファイルの読み取り照合結果は `inputAudit` に出る。依頼範囲内の前提が整った作業は `nextProductionTask` と `readyTasks` を参照し、同じターンで着手して実際の証拠を記録する。原本・根拠・権限を必要とする判断は制作の既存手順に従う。依頼・入力・環境が変わるまで同一失敗の統合を反復しない。継続できる作業が尽きた時に、不足している資料または判断を具体的に伝える。

統合報告の `requested_scope` に依頼の書籍ID・原本範囲・SHAが残る。4工程の合格後に必要な表示・配布検査は従来どおり実施する。Workの再開時は、採用した実行版・工程台帳・引継記録を一組で復元する。
