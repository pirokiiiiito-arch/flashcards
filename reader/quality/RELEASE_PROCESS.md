# 読書制作・配布制御 v2

正本はGoogle Driveの全書籍共通60項目（ID `1CngvhZvJPQsGizwmaVKC_old4Vlvxzn2`）。本書は既存IDを実行する手順であり、新たな品質項目や別の正本ではない。

## 何を変え、何を変えないか

`reader-release-control.cjs` は私有の原本対応表、領域、独立第2稿、訂正履歴、数値照合、表示検査および証拠ファイルの実体を読む。単にチェック欄をpassedにしても通さない。`reader-private-pipeline.cjs` は一次結果・原本を不変で保存し、校正版からのみ候補HTMLを作る。既存のHTML、スワイプ、ピンチ、数字の向きは本改修では変更しない。既存の45入口・80ファイルは互換用基準であり、OCR合格証ではない。

原本照合そのものを自動生成したり、OCRエンジンの認識精度を上げるプログラムではない。原本を実際に読む作業と、その証拠に対する責任は残る。

## 状態遷移（循環を作らない）

| 段階 | 必須の検査 | 許される操作 |
|---|---|---|
| 作業中 | 全60項目を初期not_runで保存 | 私有ワークスペース内の読取り・訂正・候補生成 |
| prepare | 制作側57項目。G8-03/04/08をまだ要求しない | 別名の新規・非公開仮保存だけ。通常ファイル上書き不可 |
| release | prepare＋G8-08（仮保存から再取得した実バイト一致） | 署名付きの公開入口更新。本文は非公開 |
| deployed | release＋G8-03（同じ入口のデプロイ成功と版確認） | 読書用完成の配布・通常版昇格。更新対象は直前読取りと競合検査し、保存後再読取り |
| device | deployed＋G8-04（実際のiPhone Chromeの証拠） | 実機確認済みの独立表示 |
| preview | 対象SHAを指定した明示的な未校正版確認依頼＋構造/原本不変性 | 専用preview入口と新規ファイル。通常版への上書き・完成表示は禁止 |

G8-03は公開前に成功を要求しない。G8-08の最初の読戻しは仮保存で実行できる。G8-04未実施だけを理由に読書用完成を永久停止しない。対象外は正本に基づく根拠を必要とし、成功件数には加算しない。原本自体の損傷は明示した原本注記として校正版へ収録し、通常の誤読や未実施の言い換えに使わない。

## 初回導入と再開

Node.js 20以上、外部パッケージ不要。すべての私有ファイルはリポジトリの外へ保存する。

```sh
node tools/reader-private-pipeline.cjs init PRIVATE_BOOK.html PRIVATE_WORK_DIR BOOK_ID reader/wh2/161-180/index.html SOURCE_INDEX.json
node tools/reader-release-control.cjs check PRIVATE_WORK_DIR/manifest.json prepare
```

既存ワークスペースにinitを再実行して上書きしない。継続時は保存したmanifest.jsonを読んで、原本対応表、immutable/*、canonical/*、corrections/*、review/*、candidates/*を一組で復元する。読み込みや転記をやり直して既存校正を捨てない。各ファイル参照は相対pathとsha256。証拠を追加・変更したら実体からハッシュを再計算し、manifestの対応参照を更新する。証拠がない間はnot_runのままにする。

`correct MANIFEST EVENT.json` はexpectedCanonicalSha256、scan、文字フィールドのpointer、before、after、原本領域ID(sourceRegion)、actor、reason、atを要求する。原本画像と一次OCRを変更せず、連鎖ハッシュ付きの新しい訂正版を作る。現行実装は安全側に全60結果をnot_runへ戻す。以前の証拠ファイルは削除しないが、変更版の証拠として再利用しない。

```sh
node tools/reader-private-pipeline.cjs correct PRIVATE_WORK_DIR/manifest.json SOURCE_CONFIRMED_EVENT.json
node tools/reader-private-pipeline.cjs build PRIVATE_WORK_DIR/manifest.json
```

原本から独立して第2稿を作り、すべての本文・見出し・図説・囲み記事を領域と双方向対応させる。領域の重なりは見出しと本文の関連など原本に沿って記録する。単に２つのOCR文字列が一致しただけでは、両方が落とした列を検出できないため、四辺と全領域の再点検も必須。

## 実証ファイル

`inventory`：全ページの原本SHA・寸法・領域座標・種類・収録フィールド・独立した２回の点検記録。
`second`：第1稿とは別のrunId、先に第1稿を見なかった記録、原本対応表SHA、全フィールドの第2稿。
`resolutions`：2稿差分の原本による解決、未解決事項、数字の全出現位置と原本根拠、機械警告の原本確認。英字を一律削除しない。
`boundaries`：範囲内の全境界に加え、前分冊との入口・次分冊への出口。巻頭/巻末や写真介在も原本で理由を記録。
`display`：実配布HTMLのSHA、実画素使用、全収録フィールドと描画文字の一致、全スキャン×320/390/430px×16/18/20/22/24/26/28/30pxの結果。高さ・回転・操作の詳細ログは各項目証拠へ含める。
`checks`：正確に既存60ID。passed/not_applicableには存在する証拠ファイルのpathとsha256が必要。証拠はcheckId、artifactSha256、subjectSha256、reviewedBy、method、at、全scansを保持する。部分合格や異なる版の結果を全体合格にしない。

subjectSha256は書籍・範囲・原本・一次稿・校正版・表示処理・設定・入口・実HTMLの組み合わせを固定する。本文だけでなく表示コードや入口を変更しても古い証拠は一致しなくなる。実装例はテスト内のsynthetic fixtureを参照するが、テスト用証拠を実書籍へ転用してはならない。

## 配布と署名

```sh
node tools/reader-private-pipeline.cjs plan PRIVATE_WORK_DIR/manifest.json DELIVERY_REQUEST.json
node tools/reader-private-pipeline.cjs export PRIVATE_WORK_DIR/manifest.json NEW_EXPORT_DIR DELIVERY_REQUEST.json
```

要求にはoperation(stage/promote/attach/pages)、channel(preview/production)、expectedArtifactSha256を指定。stageはcreateOnly:true、上書き対象なし。promoteは直前に読んだtargetFileIdとexpectedCurrentSha256を必須とする。出力にはJST日時・書籍ID・状態・SHA断片を付ける。計画は15分で期限切れ、アップロード完了報告ではない。コネクター実行者は実行直前に計画・現行版・操作対象を照合し、仮保存または通常ファイル更新後に実体を再取得する。同じSHAでも別ファイルを確認したことにしない。

`issue MANIFEST REQUEST CONTEXT PRIVATE_KEY KEY_ID POLICY` は私有ファイルを再検証してからEd25519署名を作る。公開するのは匿名化した判定・ハッシュ・公開資産一覧だけ。CONTEXTはentry、全bookレコード、reportSha256、publicFilesの正確なハッシュを持つ。署名鍵は公開リポジトリにも配布ZIPにも入れない。CIには公開鍵だけを置く。

通常配布の入口・台帳・私有HTMLの変更には、対象一致の署名を `release-policy.json` のreceiptsから参照させる。previewは `reader/preview/` 以下のみ。既存基準や信頼鍵をJSONだけで増やして抜け道を作れない。機構自体の改修は別のコードレビュー・回帰試験対象であり、書籍の検査不合格を消すために使わない。

## 公開CIと限界

新しい検査は公開前の最終生成物に対しても実行する。旧ゲートのPASSは台帳形式確認であってOCR完成ではない。既存の未校正版を残すことと、新たな未校正版を通常版へ昇格することを区別する。

```sh
node --test tests/reader-release-control.test.cjs tests/reader-quality-gate.test.cjs tests/reader-artifact-audit.test.cjs
node tools/reader-release-control.cjs repo
```

機械的に強制されるのは、このプログラムを通る検査・書出し・公開ワークフローである。任意の手動Drive更新、ChatGPTによる直接添付、管理者によるCI改変をこのコードだけで禁止することはできない。したがって「すべての経路を技術的に封鎖した」と言わない。接続ツールから配布する作業にも同じ検査計画を必ず適用するが、その遵守は作業者側の責任境界になる。

署名は実施者の証拠提出を認証するものであり、目視が本当に行われたことや誤読ゼロを数学的に証明するものではない。原本照合と実機確認を実施していないのに署名を発行してはならない。
