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

制作再開の現行入口は [WORK_RESUME_PROCESS.md](WORK_RESUME_PROCESS.md)。
PRIVATE manifestにscoped reviewがある場合、plannerへ`--manifest`を渡して
原本比較・既存canonical・部分検査・残要件を読み戻す。manifestのない状態で
校正済み原稿を旧公開版と推定して初稿を作り直してはいけない。

公開版とは別の`pendingDraft`を持たない既存の私有校正稿は、
`reader-repair-transition.cjs --action adopt-current --manifest PRIVATE/manifest.json`
により検証後の`currentWork`として採用する。採用はPRIVATE台帳候補への記録で、
本文・原本・公開版の履歴を変更しない。採用済みの範囲確認を独立第二稿完了とせず、
不足する原本作業を継続する。`pendingDraft`と`currentWork`を同時に現行扱いしない。

対象の `pendingDraft.reviewStatus` は以下の順でのみ進める：

`visual_first_pass_only` → `second_pass_in_progress` → `second_pass_completed` → `source_resolved` → `awaiting_canonical_60`

範囲ごとの原本比較を保持した`currentWork`は、`retained_scoped_review`から
`second_pass_in_progress`へ進み、その後の段階と根拠は共通である。
進捗の更新にはその作業版のmanifestを指定し、元の原本比較SHAと新しい進捗SHAを
別に保持する。採用、進捗、改版の操作はいずれも読書HTMLの内容を自動生成しない。

状態の移動には、同一書籍ID・原本範囲・作業HTML SHA・PRIVATE進捗SHA・現行台帳version・対応する根拠が必要。`second_pass_completed` は全適用領域の独立照合完了、`source_resolved` は差分・画像・関連・境界と原本に関係する既知欠陥の解決を意味する。配布承認・配信・実機の待ちだけでこの原本状態を止めない。未分類の欠陥を安易に外部待ちへ移さない。文字がないと原本で確認された画像本では、文章転記を必須にしないが画像の独立照合は必須。

書籍IDを中央台帳へ初めて登録した後、既存の私有校正稿も `pendingDraft` もない場合は、別のSHAで作った作業稿を `reader-repair-transition.cjs --action start --new-sha NEW --first-pass-report-sha REPORT --source-image-count N` からPRIVATE初期化する。すでにある作業稿は採用・再開し、上書きや初稿への戻しを行わない。レビュー済み通常版へ直接変換しない。

二次転記の完了と差分解決は別の判定。`second_pass_completed` は原本を見た独立再転記・文字がないページの画像照合が全対象領域で完了した状態。原本と一次稿の文字差分や図版・注記の関連・ページ境界に未解決が残っていても、この段階までは進められる。ただし `source_resolved` へ進むには全差分・関連・ページ境界・原本関係の既知欠陥の解決を必須とする。配布・実機の未解消状態は別に保持し、通常納品のゲートから除かない。

すでに校正済みの別の本で、新しい内容・レイアウトの修正を行う場合も、旧公開版の `artifactSha256` と `reviewed/candidate` 状態を保持したまま、異なる SHA の非公開 `pendingDraft` を開始してよい。新しい作業版の独立校正や実機検証が未完了であることは旧版の完了証明にしない。問題が新たに判明した旧版は、不具合を隠さず既存の品質台帳にも記録し、誤って公開済みの正本を上書きしない。
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

`currentWork`の本文や表示を修正した場合は`--action revise-current --prior-sha OLD
--manifest PRIVATE/new-manifest.json`を使う。実際の新manifestと採用HTMLを検査し、
旧currentWorkは履歴へ保全する。新HTMLのSHAで原本比較・独立校正・表示証拠を判定し、
旧SHAの24条件合格を新しい版の合格へ付け替えない。

旧形式のmanifestに校正済みcanonicalがあるのに、現行作業の状態・進捗を新しい
入口で解釈できない場合は、`connect_existing_canonical_context`で必要な対応付けを
示す。独立二稿済みの旧稿をv3の独立第二稿未完へ変更せず、原稿を作り直さずに
書籍固有の既存進捗と証拠を接続する。未対応形式を自動移行済みと報告しない。

## 校正完了後に通常版候補へ進む正式な出口

`currentWork`で原本側の作業が`awaiting_canonical_60`に達した場合は、実際の
独立第二稿・領域・境界・検査証拠を持つ正式manifestを用意し、
`reader-repair-transition.cjs --action bind-formal --manifest PRIVATE/formal-manifest.json`
を使う。正式`prepare`ゲートが通るまでは切り替わらない。旧v3の3つの参照は
`retainedScopedReview`、`retainedScopedAssessment`、`retainedScopedManifest`として
元のSHAのまま保存する。独立第二稿未完を前提にした旧scopedReviewとassessmentを
現行の正式評価として使い続けない。正式判定の正本は従来どおりmanifestの`checks`である。
実際に独立第二稿が未完了の作業を、この操作だけで完了へ進めてはいけない。

`awaiting_canonical_60` で作業を終わらせない。現行60項目の対象版の全文字・図版・注記・表示・独立原本照合を実際に検査し、同一Drive IDの読戻し、Productionの**非プレビューURL**でHTTP 200と配信SHAが一致し、iPhone実機証拠が揃った場合だけ次の操作を使う。

```sh
node tools/reader-repair-finalize.cjs \
  --book BOOK_ID --ledger PRIVATE/current-ledger.json \
  --expected-revision N --artifact PRIVATE/corrected.html \
  --manifest PRIVATE/manifest.json \
  --source-proof PRIVATE/source-preflight.json \
  --ocr-review PRIVATE/ocr-review.json \
  --public-evidence PRIVATE/production-pages-http-evidence.json \
  --output PRIVATE/verified-candidate-ledger.json
```

この処理は既存の `reader-unified-handoff.cjs --mode normal` と元の60項目ゲートを**実際に再実行**する。全検査を通ったときだけ `pendingDraft` を台帳候補から退避し、`qualityState: reviewed` と `releaseStatus: candidate` を持つPRIVATE台帳を作る。旧版のSHA・校正履歴は消さない。なお、この操作でGitHubやDriveの実ファイルを更新・公開したり、古い読書URLを転送したりはしない。ログを確認し、正式な公開操作は別に行う。

独立全文字校正・60項目の合格・実機証拠・非プレビュー公開HTTPが欠ければ失敗する。ユーザーの同意や検査者名を書いただけで証拠とは扱わない。GitHubとチャット外で誰かが直接書き込む行為を完全に封鎖する機能ではない。
## 納品と検査の区別

修復キューがすべて処理済みでも正式合格ではない。**現行60項目の独立原本照合・文章連続性・図版と注記・実配布HTML表示検査・Drive同一ID読戻し・公開HTTP/SHA・iPhone実機**の正規ゲートを通す。修復プログラムは常に `releaseEligible:false` を返す。

自動テストでは小説、歴史書、写真のみ、目次、図文混合、ラベル付き画像、1・2・5ページ、非隣接接続、誤ったページ分類、ハッシュ不一致、状態飛ばし、独立転記の省略、校正後のSHA変更を合成データで検証する。合成テストの成功を実在する書籍の全文字校正やiPhone確認と混同しない。
