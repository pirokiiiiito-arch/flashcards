# 読書HTMLの高速分割表示検査（制作工程の追加手順）

**目的：** 全画面幅・全フォントを巨大な一括処理で検査して時間切れとなり、作業をやり直す問題をなくす。検査の合格条件は緩めず、対象ファイルごとにSHA-256でキャッシュする。

## 適用範囲

- `tools/reader-fast-layout.py` は **novel-v2 / `window.NovelReader.inspect()` がある小説読書HTML** 用。原本・OCR・レイアウトファイルを一切編集しない。Playwright (Python) と `/usr/bin/chromium` を使用する Linux 検査環境用。
- 小説以外の `world_history_1`・図鑑・画像主体・混合本では、対象の既存読書エンジンの検査を使う。小説専用の `NovelReader` チェックを通したことにしてはいけない。
- 入力は **PRIVATE** のHTML。公開GitHubに書籍の本文・元画像・私人の検査記録を入れない。

## 実行

```sh
python3 tools/reader-fast-layout.py \
  --html PRIVATE/20261119_0455_book_041-060.html \
  --report PRIVATE/20261119_0621_book_041-060_fast-layout.json
```

Linux Chromium/Playwright が準備できていないときは、実行不能を明示し、その環境で表示テスト済みと宣言しない。サンプルファイルのGitHub CI合格は私有HTMLの検査を代替しない。

検査の内訳：幅 `320/390/430` × 文字サイズ `16/18/20/22/24/26/28/30` の **24条件**と、幅390px・文字サイズ20px時の画面高 `568/650/700/812/926` の **5条件**で合計29条件。読書画面は同じChromium内で幅ごとに再利用し、文字サイズは実際の `A− / A＋` ボタンで変更する。画面の本文文字列一致、縦書きの警告、原本ボタンの有効性、表示幅・高さ・文字サイズ、JSエラーを確認する。

実行中の各条件の結果はPRIVATE JSONに**逐次保存**する。すべて一括実行し直さず、失敗した条件または未実施の条件のみ再実行する。すでに同一HTMLかつ同一プログラムのSHAで合格した条件は自動スキップする。

```sh
# 未実施・失敗条件のみ（通常）
python3 tools/reader-fast-layout.py --html PRIVATE/book.html --report PRIVATE/layout.json

# 明示的に失敗した条件だけ
python3 tools/reader-fast-layout.py --html PRIVATE/book.html --report PRIVATE/layout.json --only-failed

# 1条件だけ再検査（検査IDの表記は report の結果に一致させる）
python3 tools/reader-fast-layout.py --html PRIVATE/book.html --report PRIVATE/layout.json --case font-w390-f20-h700 --force
```

キャッシュの同一性を保証するキーは `artifactSha256` **と** `runnerSha256`。本文を1バイト変更した場合でも、プログラムを変更した場合でも、旧合格は無効。『文字内容の改修はCSSの検査に関係ない』と勝手に仮定して再利用しない。原本ZIP/画像のSHAとレイアウト検査のSHAは別途保持し、表示検査だけの成功を全文字OCR精度の合格に読み替えない。

## 前回の不具合の解消

11月19日 4:55版『ナイン・ストーリーズ』41〜60の私有HTMLに対して、29条件を **約47秒で実施し29/29合格**、同じHTMLの再実行では29件がキャッシュ再利用され **新規検査0件・約0.02秒**で返ることを確認。HTMLの末尾にテスト用改変を加えた別コピーでは、キャッシュが0件に戻ることも確認。これはその版の *Chromium表示条件* に限った結果であり、本文の独立全文字校正・現行60項目全合格・実機iPhoneの検証は未完了。

## 最終納品との関係

このプログラムは常に `eligibleForDelivery:false`。**29条件PASSだけで完成版を納品しない**。既存60項目はそのまま、原本独立校正・論理本文のページ接続・出典SHA・Drive同一ID読戻し・GitHub Pages HTTP/SHA・実機iPhone等を元のゲートで検査する。

同じ書籍の一次稿・二次稿の校正を、表示テストが遅いことを理由に巻き戻したり最初からOCRし直したりしない。まず対象HTMLのSHAを固定し、分割した表示テストだけを実行する。表示テストがPASSでも、未解決の校正箇所があるなら修復キューで差分のみ進める。
