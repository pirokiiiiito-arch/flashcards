# 範囲付き校正稿の確認版 v3

## 使う対象と判定

`reader-preview-consent-v3` は、原本と比較した校正稿があるものの、独立全文二稿・原本QA全体・正規60項目などが未完了の確認版を扱う。未校正OCRのv1、独立全文二稿の照合済み途中稿のv2、通常版のprepare/release/deployed/deviceの条件は変更しない。

v3は`reviewed_partial_canonical`と実際の比較範囲を記録する。独立見出し調査、担当範囲ごとの本文比較、独立全文第2転記は別の実績である。原本を見て既存本文と比較した記録を「初稿を見ない全文第2稿」に変換しない。校正済み本文をraw OCRへ戻して旧v1の文言に合わせることもしない。

成功時も`unverified_preview_only`、`contentCertified:false`、`sourceQAComplete:false`、`deviceVerified:false`である。正規60 ID・通常版・iPhoneの基準を緩めない。

## 同意より先に確定するもの

1. 最終HTMLのバイト・書籍ID・範囲・SHAを固定する。表示や状態文言を変更したら新しいSHAとして扱い、古いDOM観測を転用しない。
2. 実原本ZIPのsource preflight、原本の全対象SHA、校正稿、既存レビュー、raw OCRを私有領域で固定する。subset ZIPの来歴を元の全書籍ZIPまで拡張しない。
3. 実レビュー内の原本SHA・ページ・比較済み本文と、最終canonicalの該当部分をJSON pointerで一致照合する。レビューのscopeを保存する。
4. 実24条件の状態・証拠と正規60項目assessmentを固定する。未実施、途中、実行エラー、完了観測、監査を伴う合格を区別する。
5. 最終loader/SWを固定し、対象版と残る項目を実際に開示する。その直後の実際の肯定返信が存在して初めて同意を作成する。

一般的な作成依頼やURL希望から質問文・肯定返信を作らない。利用者の発言時刻と記録作成時刻を混同しない。これらの記録は運用者の証跡であり、サービスによるメッセージ署名・人間の視認証明ではない。

## 私有 manifest の追加参照

既存の`reader-private-bundle-v2`で、`raw/canonical/originalIndex/template/profile/lock/corrections/artifact`の同一性検査を維持する。`raw`を既存校正稿のreplay seedとして移行する場合は、`replaySeedMeaning:reviewed_canonical_snapshot`と明記し、本来のOCRを`genuineRawArchive`で別保存する。

追加のpinは`sourceDiscovery`、`genuineRawArchive`、`scopedReview`、`previewDisplay`、`assessment`。いずれも私有領域内の`{path,sha256}`である。

`scopedReview`のschemaは`reader-scoped-source-review-v1`。`bookId/range/artifactSha256/canonicalSha256`、`state:reviewed_partial_canonical`、`fullIndependentSecondTranscription:false`、`sourceQAComplete:false`、`sourceReviewTruthAuthenticated:false`を持つ。

各`comparisons`レコードは、実レビューへの`evidence`、`scanPointer`、`sourceShaPointer`、`reviewerPointer`、`statusPointer`と、`bindings`の`evidencePointer/canonicalPointer`を指定する。canonical側の指定先は同じ原本ページの本文ブロック・図説等に限定される。別ページ・別原本・変更された文字列・校正稿自身を根拠とする見せかけのレビューは拒否する。

有文ページは`kind:source_text_comparison`。白紙は`kind:source_blank_comparison`を使い、実レビューの`blankPagePointer`と`sourceObservedPointer`がtrue、canonicalのblocks/figuresが空であることを検査する。空の配列を本文比較と呼ばない。比較対象と未比較対象の原本番号は`comparedScans/uncomparedScans`へ正確に列挙する。独立見出し調査等はscope付きの`additionalEvidence`で保持できるが、それだけで全文二稿済みと判定しない。

## 24条件の状態

`previewDisplay`は`reader-preview-display-v1`。状態は次のいずれかで、観測報告から再計算する。

| status | 意味 |
|---|---|
| `not_run` | 当該HTMLの観測をまだ行っていない |
| `in_progress` | 一部条件・ページの観測がある |
| `stopped_on_error` | 実行がエラーで停止した |
| `observed_awaiting_audit` | 24条件の観測は揃ったが見出し完成監査がまだない |
| `completed_failed` | 全条件の観測に不一致が残る |
| `completed_passed` | 全24条件・全ページの照合と、同じ入力に対する見出し監査が合格 |

観測済みの場合は`report/observations/model`を参照し、`reader-browser-qa-v1`と`reader-heading-dom-observations-v1`を照合する。3 viewport×8文字サイズ、条件ID、全ページ訪問、本文のコードポイント範囲・全文、モデルのcanonical SHAと生ファイルSHA、HTML内モデルが一致しなければならない。既知の`window.readerVerifiedStructure=JSON;`形式はJSON部分だけを厳密に取り出し、任意JavaScriptは実行しない。

`completed_passed`には、さらに`headingAudit/canonicalBookdata/inventory/approval`のpinが必要。監査結果は`heading_release_evidence_consistent`で、同一HTML・観測・原本・モデル・台帳を参照すること。`history`には過去の実報告を保持できる。同じHTMLの観測があるのに`not_run`へ戻すことは拒否する。観測の整合検査はブラウザー実行者の認証ではない。

## 正規60 assessment

`private-quality-assessment-60-v1`の正規60 IDを維持し、`checks`とmanifestの正式check mapの状態を一致させる。`sourceReviewSummary`、`display24`にはhelperが算出した実際の値をそのまま記録する。`statusCounts`は60件から再計算する。

v3では独立全文二稿を未完了と明示するため、G3-06/G3-07をpassed/対象外にしない。iPhone未確認ならG8-04はnot_run。表示が失敗した状態でG7-01を合格にしない。実24条件が進んだ後に`notPerformed.browser24Conditions=not_run`を残すことは拒否する。原本比較等の狭い実績はscopeとして保存し、全項目の合格へ拡張しない。

## 台帳と途中稿の選択

実在する直前版をトップレベルの`artifactSha256`、異なる新候補を既存`pendingDraft.artifactSha256`で記録する。同じSHAを両方へ入れない。`pendingDraft.privateProgressReportSha256`を今回の`scopedReview.sha256`へ結び付ける。既存の段階制約は維持し、存在しない全文独立二稿完了を設定しない。限定的に完了した作業は別のscopeとSHAで保持する。

v3 handoffでは`--preview-target-sha256`で対象を明示する。このSHAが、実HTML・manifest・同意および台帳の選択対象と一致すること。pendingDraftを選ぶ場合は、その実績pinと既存pendingDraft validatorも通ること。通常版で暗黙にdraftを選ぶ処理は追加しない。台帳自身を書き換えて一致させることもしない。

既存plannerは、正しい別SHAのpendingDraftがあれば初稿再生成を要求せず、残る原本領域確認へ進める。本文を再生成して旧形式に合わせない。私有baselineを公開済みと説明しない。

## 実際の同意を登録する

実会話の記録は`preview-conversation-acceptance-evidence-v2`。書籍・範囲・artifact/loader SHA、実質問、見える対象表示、実際の未完了開示、実返信、記録時刻とその意味を持つ。`assistantDisclosure`の`disclosedState/disclosedSourceScope/disclosedDisplayState/disclosedAssessmentSha256/disclosedAssessmentCounts`は固定済みの実態に一致させる。

```bash
node tools/reader-private-pipeline.cjs authorize-preview-v3 PRIVATE/manifest.json PRIVATE/actual-conversation.json PRIVATE/final-assessment.json
```

このコマンドは実証の原文を保存し、検査成功後だけmanifestに同意参照を追加する。v2の`authorize-preview`は従来の二稿条件を維持する。未知schemaをv1へフォールバックしない。歴史的なschema無しv1は、既知の5項目形式と従来条件に完全一致したものだけが対象。

## 保存・公開・配布

`stage`は`channel:preview/createOnly:true`とexact artifactで計画する。実ファイルを保存し、その同じIDから実バイトを読み戻した後に正規`complete-plan`を実行する。

公開前の`pages`と配布時の`attach`には`workLedgerFile/sourceProofFile/previewConsentFile/previewTargetArtifactSha256`、実際の`driveReadbackFile/driveFileId/driveCompletionFile`を渡す。completionのartifact SHA・実ID・plan SHAを検査する。v3にもv2と同じ同一ID条件を適用し、別IDの同じバイトだけで代用しない。

```bash
node tools/reader-unified-handoff.cjs --mode preview --artifact PRIVATE/reader.html --manifest PRIVATE/manifest.json --ledger PRIVATE/work-ledger.json --source-proof PRIVATE/source-preflight.json --preview-consent PRIVATE/actual-consent.json --preview-target-sha256 EXACT_ARTIFACT_SHA
```

新receiptを発行し、旧receiptは改変しない。public registryの書籍IDは埋込identityと一致させ、別の旧IDで上書きしない。receipt/registry/report/loader/SWを隔離publish treeで照合する。公開するのはローダー・コード・メタデータだけ。本文・原画像・レビュー本文・会話原文・私有パスを公開しない。配信後の実GET、保存先の到達性、iPhone確認はそれぞれ別に報告する。
