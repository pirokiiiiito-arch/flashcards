# 全書籍の本棚登録

確認版と通常版の新規登録、続きの統合、差し替えに同じ入口を使う。読書用ZIP・原本資料・DriveファイルID・書誌の実データ・署名用の秘密鍵は非公開で扱う。登録台帳 `reader/quality/shelf-registration.json` には内容の指紋、実測値、署名を保存する。

## 20枚分冊から読書用ZIPを作る

新規書籍と差し替えには、Driveの仮置き前に共通の `pack` を使う。分冊は制作と保管の単位として維持する。読書画面では全巻にわたる本文の接続を先に確定し、画面幅と文字サイズに合わせて改ページする。

```bash
python tools/reader-shelf-register.py pack \
  --manifest private/manifest.json --archive private/book.zip
```

私有の目録には `schema: 1`、`bookId`、`title`、`template_profile`、`range: [1, 最終原本番号]` を指定する。各分冊は `segments` の `start`、`end`、`part` で元のファイルに対応づける。すべてのファイルパスは目録を置いたフォルダからの相対パス。原本を別ファイルに保管している場合、`originalScans` の原本番号ごとに `path` と記録済みであれば `sha256` を指定する。

- 歴史書の分冊に `bookdata.pages` と `reader-verified-structure` がある場合、`pack` は本文・図版・目次と原本番号を保持し、`structured-scan-flow-v1` の目録を作る。扉は `pageType: "portrait"` または `readingFlow.portraitScans`、原本に固有の並べ替えは `readingFlow.scanOrder` に全巻の順番で記録する。
- 通常の標準テンプレート・小説テンプレートは、各分冊の `window.READER_BOOK` に入っているリテラルJSON、同じ形式の `script#bookdata`、またはJSONファイルを直接読める。`kind` は `text`、`mixed`、`image`。選択したテンプレートの本文・見出し・図版を全巻の順番で組み、同じエンジンで開く自己完結HTMLとして梱包する。全巻の読書HTMLがすでにある場合には `entry` に指定できる。
- 歴史書・小説ともに、四工程で統合した原稿では `mergeReport` に `merged/merge_report.json` を指定する。同じフォルダの `merged_bookdata.json` と `reader_logical_stream.json` を統合記録のSHAと照合し、確定した境界判断を利用する。目録の横に `merge_report.json` があるときは自動で見つける。図版・注記・目次など配置を保存する本には、照合済みの読書分冊も渡す。
- 確認済みの本文接続は分冊の `continuations` または目録の `readingFlow.continuations` に `{"from":[20,3],"to":[21,0]}` のように記録する。番号は原本番号と、その原本での0始まりの本文ブロック番号。通常テンプレートの連続する本文では、確認済みの `joinPrevious: true` も使用できる。図版・注記が途中にある接続は両方の原本位置で示す。
- 前後に本文のある分冊境界には原本で照合した接続、または明示した段落・会話・見出しなどの区切りを用意する。既存の四工程の境界台帳は `--structure-reviews private/merged_bookdata.json` でも読み込める。段落などが続かない場合も、`source_review_status: "verified"`、`display_boundary`、実際の `left_suffix`・`right_prefix`、左右の本文ID（または `from`・`to`）を照合する。必要な判断が見つからない場合は該当する原本番号が表示される。画像だけの本では本文接続の指定は不要。
- `prepare` はDriveから読み戻した実物を本棚で開く。分冊間で続く本文が実際の読書順で隣り合い、画面をまたぐ場合は語の境界にあることを検査する。原本から独立に作った区間越え接続一覧を原本照合表の `continuations` に含めると、省略・余分な接続も照合できる。結果は私有の `verification.json` の `continuity` に保存する。新規登録の前に、通常版と確認版それぞれの登録・校正手順を続ける。

## ページ送りと分冊境界の検査

原本20枚単位の制作・校正と、選択した書式を維持する。ページ送りでは、現在の紙面を表示したまま移動先の本文・図版とページ番号を準備し、一度に切り替える。「次へ」の直後に「前へ」を押した場合は元のページに戻す。遅れて終わった読み込みが本文やしおりを上書きしないよう、最後に指示された移動先を確認してから表示する。

確認版・通常版の新規登録と差し替えには、既存の `prepare` を使う。保存済み書籍を開く経路で、元分冊の全境界と実際の表示区間の全境界を検査する。統合後に二つの原本が同じ画面に収まる場合も、元分冊番号と表示位置の対応を記録する。通常の往復と素早い折り返しで、Chromiumから取得した描画フレームの紙面とページ番号を移動前・移動先の表示と照合する。途中に白い紙面、読み込み表示、別ページの表紙、異なるページ番号などが映った場合は該当境界を修正して再検査する。表紙や白紙自体が正しい移動先なら、その正しい紙面と番号の組で判定する。

私有の `verification.json` の `pageTurns` に検査結果を保存する。登録台帳の署名には検査結果のSHA-256と確認した境界を含める。登録済みの既存版は引き続き読める。新しい版の登録には、その版で取得した検査結果が必要になる。

## 制作から本棚まで

1. いつもの20枚単位の制作と校正を進め、書籍の実体をDriveの非公開の仮置き先に用意する。原本から作った目次照合表、今回の書誌、Driveの現行本棚一覧を用意する。各分割ファイルを同じDrive IDから読み直し、順に `01.bin`、`02.bin` と保存する。読戻し記録 `parts.json` は各ファイルの `index`（1から）、`id`、`bytes`、`sha256` を持つ配列とする。
2. `prepare` を実行する。本棚と同じビルド済みの配信ツリー（`--site`）を使う。検査は原本範囲の末尾まで、最大20枚ずつ、実際に保存した本を開く経路で行う。各区間で2本指による画面全体の拡大・縮小、拡大中の上下左右パンと読書位置、等倍での上下1ページ送りを実測する。原本・図版・目次のある本はその画面でも検査する。原本目次の各行と、押した先の原本番号を照合する。失敗時は示された分冊・表示・資料対応の原因を直して再実行する。
3. 署名済みの `registry-staged.json` を公開台帳へ反映する。反映には取得した最新Gitリビジョンの一致を条件にする。競合時は他書籍の変更を残し、自分の書籍の未確定・現行レコードを照合してから自分の候補だけを足す。Pages配信完了後に、実際に配信された台帳を読み戻す。この間は旧版も読み込み可能。
4. `catalog` に、配信中の台帳、改めて取得した同じDrive IDの本棚一覧と分割データを渡す。対象書籍だけを追加・差し替えた一覧が出力される。他の本の変更を保持する。同じ本が別の版に更新済みならその版から作業を再開する。出力の `write-condition.json` で現行版を確かめ、Driveの同一IDで差し替えて読み戻す。更新に対応するクライアントでは `If-Match` を使う。更新前後の内容が同一なら書き込みを省く。
5. `finalize` で、実際に配信された候補・Driveの本棚一覧・同一IDから読み直した分割データを照合する。合格した最終台帳を直前のGitリビジョン一致を条件に反映する。公開後、台帳に今回の署名があり、本棚を同期して同じ本が開くことを確認する。中断時は既存の `plan.json` と配信中の台帳から再開する。候補が公開済みでDrive未更新なら手順4、Drive更新済みなら手順5へ進む。

`existing` は移行時から同じ書誌・同じ実体で提供されていた8冊。固定された一覧に後から例外を追加できない。新しい端末で同じ旧版を再ダウンロードできる。`pending` の版も署名検証を通り、`editions` は切替確定済みの版を表す。以前から端末に保存している本や読書位置は保持する。Driveに置いた任意のZIPや、未署名の確認版を本棚一覧に書き込んでも登録されない。

## 入力と実行例

主な環境は Python 3.11以降、Pillow、PlaywrightのChromium、Node.js 22以降。`--chromium` に実行ファイルを指定することもできる。発行時には所有者の非公開ファイル「本棚登録_発行鍵_P256.pem」を作業用の非公開ディレクトリに取得し、`--key` にそのパスを渡す。秘密鍵を公開リポジトリ、配信物、ログ、チャット本文に入れない。

`entry.json` は本棚の既存形式で `id,title,subtitle,status,scans,totalBytes,parts` を指定する。`parts` の各要素は `id,name,size` を持つ。通常版では既存の正式な納品判定のJSON配列を `--handoff` に指定し、実体とハッシュを照合する。確認版の本棚検査は正式校了・iPhone実機確認に昇格させない。

```bash
python tools/reader-shelf-register.py prepare \
  --site "$PUBLISHED_TREE" --catalog private/current-bookshelf.json \
  --book private/entry.json --archive private/book.zip \
  --readback private/readback --reference private/reference.json \
  --channel preview --key "$PRIVATE_SHELF_KEY" --out private/checked

python tools/reader-shelf-register.py catalog \
  --prepared private/checked --registry private/served-staged-registry.json \
  --catalog private/current-bookshelf.json --readback private/readback --out private/upload

python tools/reader-shelf-register.py finalize \
  --prepared private/checked --registry private/served-staged-registry.json \
  --catalog private/same-id-catalog-readback.json --readback private/readback --out private/final
```

`reference.json` には `bookId,title,range,profile,modes,toc` を指定する。`profile` は `world_history_1` または `novel`。`modes` は実在する `text,figure,original,contents`。`cases` では各特殊画面の `{scan,mode,selector}` を追加できる。本文のみ、画像のみ、本文と図版の混在に応じて `defaultMode` と各分冊先頭をキーにした `batchModes` を選べる。原本目次の照合表は生成後の本から作り直さず、原本と照合した資料を使う。

目次がある原本は `toc` に `kind:"source"` と `rows` を記す。各行は掲載元の原本番号 `source`、`label`、**印刷どおりの文字列** `number`、実際に開く原本番号 `target`、該当する場合の `view` と `destinationSelector` を持つ。原本に目次がない場合は `kind:"source-absent"`、空の `rows`、根拠の `basis` を指定する。本ごとに印刷ページとスキャン番号の対応を設定できる。

標準読書画面と小説画面は標準のAPIで試験する。それ以外の既存形式は `ui.position` と `ui.scan` に実画面の数値を読む `selector`、必要なら `attribute` とキャプチャ付き `pattern` を指定する。`ui.goto` は本の正規の移動操作を `click`、`fill`、`select`、`wait` で指定する。値とセレクタ内の `{scan}` は対象の原本番号になる。`ui.frame`、画面別の `textSelector,figureSelector,originalSelector,contentsSelector`、目次の `toc.ui.show,row,label,number` も指定できる。これらは実際の画面要素を選ぶための設定であり、倍率や合格結果を指定する欄はない。

独自の画面で境界試験に使う要素は、必要に応じて `ui.turns.body`（紙面）、`number`（ページ番号全体）、`next` と `prev`（前後ボタン）のCSSセレクタで指定する。総ページ数は `ui.turns.total`、同じ画面が複数の原本にまたがる場合の出典一覧は `ui.turns.sourceScans` に指定できる。どちらも `position` と同じ形式の抽出設定を使う。番号表示が「現在 / 総数」以外の形式なら、`ui.turns.numberPattern` の第1・第2キャプチャに現在番号と総数をそれぞれ指定する。
