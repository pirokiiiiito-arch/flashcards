# 読書制作・配布制御：実行手順

正本はGoogle Driveの全書籍共通60項目（ID `1CngvhZvJPQsGizwmaVKC_old4Vlvxzn2`）。この文書は実行手順であり、別の品質規則ではない。60のIDは増減しない。

## 保存する状態

原本画像・一次読取り・初期表示処理・設定はimmutableに保存する。校正版はcanonical/revision-*、訂正履歴はcorrections/*、検査証拠はreview/*に別保存する。継続作業はmanifest.jsonから再開し、再initや一次OCRへの差戻しをしない。全作業データは公開リポジトリの外へ保存する。

訂正は原本の領域・確認者・理由・前後文字・前版のSHAを必須にする。原本と一次稿を変更せず、新しい校正版を作る。生成元は校正版のみ。訂正時は旧合格を現行版から外し、旧証拠ファイルは履歴として残す。書込みロックと版照合により同時編集を拒否する。中断後のロックは、作業が走っていないことを確認してから回復する。

読書HTMLのスワイプ、ピンチ、20px・行間1.50、承認された数字の向きは文字訂正とは別の固定入力である。無断で作り替えない。意図的な表示処理変更では、新しい処理版とその変更理由を記録し、すべての影響する検査を実行する。

## 公開までの順序

| 段階 | 必須条件 | 可能な操作 |
|---|---|---|
| 作業中 | 初期値は60項目ともnot_run | 私有領域で作成・原本照合・訂正 |
| prepare | 制作側57項目。G8-03/04/08は後続工程 | 新規の非公開仮保存のみ。通常版の置換不可 |
| release | prepareとG8-08：仮保存の実ファイル再取得一致 | 読書入口を公開するための証拠記録出力 |
| deployed | releaseとG8-03：対象入口の公開成功・版確認 | 通常版への昇格、検査済み読書版の配布 |
| device | deployedとG8-04：実際のiPhone Chromeの確認 | 実機確認済みの独立表示 |
| preview | そのSHAの未校正版について明示的な確認依頼 | 専用preview入口・新規ファイルのみ。通常版置換不可 |

公開前に公開成功を要求しない。Driveの最初の読戻しは仮保存で実行する。iPhone未実施だけでは制作側完成を止めないが、既知の失敗を「未実施」と扱わない。prepareの出力名はSTAGING-NOT-RELEASEDであり、配布済み完成版ではない。

## 私有側の検査

`tools/reader-release-control.cjs check MANIFEST PHASE` は実ファイルを読み、ハッシュ・全ページ・領域座標・双方向の文字対応・独立第2稿・差分解決・全数値・異常文字の原本判定・分冊前後の境界・24条件の実HTML表示を照合する。チェック欄だけpassedでも、証拠実体がない、別版、別範囲、実測結果がfailedなら停止する。

原本JPEGの一致はOCR精度の証明ではない。二つの転記が一致しても、両方が列を落とす可能性があるため、全領域と四辺の独立確認が必要。原本の図中文字、本文、独立図説を区別する。英字や数字を異常候補として検出しても自動削除しない。巻頭・巻末には存在しない隣接画像のハッシュを捏造しない。

実画像の検査を軽量フィクスチャで代用しない。24条件の各結果を同一の実HTMLと全対象スキャンへ結び付ける。原本・校正版・表示コード・設定・入口のどれかを変えれば、古い証拠は一致しなくなる。

```sh
node tools/reader-private-pipeline.cjs init PRIVATE.html PRIVATE_WORK BOOK_ID reader/BOOK/RANGE/index.html SOURCE_INDEX.json
node tools/reader-private-pipeline.cjs correct PRIVATE_WORK/manifest.json SOURCE_CONFIRMED_EDIT.json
node tools/reader-private-pipeline.cjs build PRIVATE_WORK/manifest.json
node tools/reader-release-control.cjs check PRIVATE_WORK/manifest.json prepare
node tools/reader-private-pipeline.cjs plan PRIVATE_WORK/manifest.json REQUEST.json
node tools/reader-private-pipeline.cjs export PRIVATE_WORK/manifest.json NEW_EXPORT_DIR REQUEST.json
```

訂正要求の必須項目はexpectedCanonicalSha256、scan、pointer、before、after、sourceRegion、actor、reason、at。実データを使わないテスト内のfixtureがJSON形状の例だが、試験用の合格記録を実書籍に流用しない。

## 配布前後の検証

要求はoperation(stage/promote/attach/pages)、channel、expectedArtifactSha256を指定する。stageはcreateOnly:trueかつ更新対象なし。promoteはtargetFileIdと直前に読んだexpectedCurrentSha256が必須。

```sh
node tools/reader-private-pipeline.cjs verify-plan PLAN.json EXACT_ARTIFACT.html CURRENT_TARGET.html
# 検査した対象にだけコネクターで書込み、同じファイルIDから再取得する。
node tools/reader-private-pipeline.cjs complete-plan PLAN.json EXACT_ARTIFACT.html READBACK.html OBSERVED_FILE_ID
```

計画は15分で失効する。出力した計画やアップロード呼出しを完了扱いしない。別IDの再取得・異なるバイト列は完了記録を作れない。プロバイダーが条件付き更新を提供しない場合、読取りから更新までの競合を完全には排除できない。その場合は新規保存を優先し、上書きしたときも再取得を必須にする。

## 公開側の扱い

`issue MANIFEST REQUEST CONTEXT` は私有検査を再実行し、公開用の要約記録とダイジェストを作る。CONTEXTはentry、book、reportSha256、publicFiles。公開するのは判定・証拠のハッシュ・対象識別子だけであり、原本・本文・校正稿は含めない。この記録はファイル一致の検査用で、第三者の署名や目視実施の証明ではない。失われる一時署名鍵に後続工程を依存させない。

`release-policy.json` のreceiptsに記録を登録する。通常版は必要項目の全証拠ダイジェストと対象ファイルを照合する。確認版はreader/preview/以下のみ。1冊の記録で他書籍や共通ライブラリを書き換えられない。共通処理の改修は別途の機構変更としてレビューし、影響範囲の再検査を要する。

既存の80資産は公開済みの互換用スナップショットであり、校正合格とは扱わない。新規の未登録・未検査資産はソースに保持し、公開用ツリーからだけ除外する。公開済み資産を無根拠に変更・削除した場合は公開処理を止める。除外により既存の読書URLを削除することはない。

```sh
node tools/reader-publish-stage.cjs SOURCE NEW_PUBLIC_TREE
READER_AUDIT_ROOT=NEW_PUBLIC_TREE node --test tests/reader-*.test.cjs
node tools/reader-release-control.cjs repo NEW_PUBLIC_TREE
```

Pagesは全生成処理の後にこの公開用ツリーを作り、その実体を検査してからアップロードする。公開前検査の後に生成物を上書きする順序にはしない。旧ゲートの成功表示はSCHEMA PASS ONLYであり、本文60項目合格の意味ではない。

## 強制できる範囲

検査・書出し・公開ワークフローを通る処理は停止できる。一方、管理者による制御コードの書換え、手動Drive操作、ChatGPTの直接添付、虚偽の目視記録をこのプログラムだけで封鎖できない。公開記録のダイジェストも署名認証ではない。これらを保護できたと表現しない。接続ツールの作業者も毎回同じplan・verify-plan・complete-planを使い、原本照合を実際に行う。
