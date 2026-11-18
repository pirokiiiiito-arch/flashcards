# 全書籍共通・再校正の修復エンジン v2

本書は **現行60項目の検査61番ではなく、完成まで進める実行手順**。既存60項目のID・順序・合格条件は変更しない。小説用 `novel` と『世界の歴史1』用 `world_history_1` の表示基準は独立したまま。`text`、`image`、`mixed` は修復の内容種別であり、既存書籍の表示テンプレートを勝手に入れ替えない。

## 書籍・ページごとの作業分岐

| 実際の内容 | 必要な校正・検査 |
|---|---|
| 小説（novel） | 地の文・会話文・挿絵を領域ごとに照合。会話開始の縦列、字下げを確認 |
| 歴史・解説書（world_history_1） | 本文・注記・図版・キャプション・地図・囲みを分離。説明文の関連、非隣接ページをまたぐ本文を確認 |
| 文字中心（text） | 本文・見出し・目次の文字を独立照合。目次項目と原本ページ番号を確認 |
| 写真・画像中心（image） | JPEG/PNG元バイトと画像の配置を照合。文字がなければ架空のOCRを要求しない。ラベルがあれば文字として校正 |
| 文字と画像の混合（mixed） | 写真・キャプション・注記・本文を個別に照合し関連付けを保持 |

## PRIVATE進捗フォーマット

`reader-repair-progress-v2` は `bookId`、`range`、`profile`、対象作業HTMLの `artifactSha256`、`pages`、`boundaries`、任意の `bridges` を持つ。原本を確認して全領域を記録した `inventory` に画像サイズ、文字の有無、画像SHA、根拠SHAを残す。各 `region` は `id`、`kind`、元画像内の `box`、元画像SHAで識別する。

文字領域（本文・会話・目次・注記・キャプション・図中文字など）は、一次稿を見ずに独立転記した `transcription` と原本に基づく差分解決 `comparison` の両方が必要。画像領域は `imageReview` に元画像バイトの同一性・関連を記録する。各ページに必要な書籍別の作業を `profileChecks` に保持する。

読める文字がない画像ページでも、全領域を実際に確認した証拠は必要。読める文字がある画像（ラベル付き写真、図中文字など）を文字なしとして省略することは不合格。画像やOCR本文をAIで描き直さない。

隣接する原本ページの関係は `boundaries` に、非隣接の文章接続（例：原本163→165で164の図版を挟む）は `nonAdjacentContinuation` と `bridges` に、双方の原本画像SHAと根拠を保持する。ページ数は20枚固定ではない。

## 校正状態の遷移

対象の `pendingDraft.reviewStatus` は以下の順でのみ進める：

`visual_first_pass_only` → `second_pass_in_progress` → `second_pass_completed` → `source_resolved` → `awaiting_canonical_60`

状態の移動には、同一書籍ID・原本範囲・作業HTML SHA・PRIVATE進捗SHA・現行台帳version・対応する根拠が必要。`second_pass_completed` は全適用領域の独立照合完了、`source_resolved` は差分・画像・関連・境界と既知欠陥の解決を意味する。文字がないと原本で確認された画像本では、文章転記を必須にしないが画像の独立照合は必須。

校正文を変更して新しいHTML SHAになった場合は、旧稿と履歴を保持し、初期状態へ戻して影響する校正・組版・文字列の証拠を再作成する。旧版のSHAや過去の画面検査だけで新稿を合格にしない。

実行例（PRIVATE側の入力と結果のみを使う）：

```sh
node tools/reader-repair-plan.cjs --book BOOK_ID \
  --ledger reader/quality/work-ledger.json \
  --progress PRIVATE/repair-progress-v2.json \
  --output PRIVATE/repair-queue.json

node tools/reader-repair-transition.cjs --action advance \
  --ledger PRIVATE/current-ledger.json --expected-revision 1 \
  --book BOOK_ID --progress PRIVATE/repair-progress-v2.json \
  --to second_pass_in_progress --output PRIVATE/next-ledger.json
```

`transition` は新しいPRIVATE台帳候補を生成するだけで、GitHubの共有台帳を直接上書きしない。確認したメタデータだけを正式なPR等で反映する。修正されたHTMLの新規SHAへ移る場合は、`--action revise --prior-sha OLD --new-sha NEW --first-pass-report-sha REPORT` を使い、旧進捗ファイルをそのまま新稿へ流用しない。

## 納品と検査の区別

修復キューがすべて処理済みでも正式合格ではない。**現行60項目の独立原本照合・文章連続性・図版と注記・実配布HTML表示検査・Drive同一ID読戻し・公開HTTP/SHA・iPhone実機**の正規ゲートを通す。修復プログラムは常に `releaseEligible:false` を返す。

自動テストでは小説、歴史書、写真のみ、目次、図文混合、ラベル付き画像、1・2・5ページ、非隣接接続、誤ったページ分類、ハッシュ不一致、状態飛ばし、独立転記の省略、校正後のSHA変更を合成データで検証する。合成テストの成功を実在する書籍の全文字校正やiPhone確認と混同しない。
