# Work / Chat 共通の制作再開入口

`tools/reader-work-resume.cjs` は、採用済み読書 HTML を持つ私有制作作業を、別の Work / Chat へ引き継ぐための読み取り専用入口です。書籍名や更新日時から最新版を推測せず、明示選択された工程状態と品質台帳が同じ原稿を指すことを確かめ、次の不足作業を返します。

実際の entry・原本・本文・私有証拠は公開リポジトリへ保存しません。この文書とプログラムは全書籍で共用します。既存公開台帳の承認済みメタデータと、私有制作情報の保管先は区別します。

## 担当する範囲

| 機構 | 担当 | 再開入口との関係 |
|---|---|---|
| 既存 v9.2 runtime | 正本ルール、制作順序、凍結入力、検査の再利用、正式な制作着手条件 | `verify_active_release.py` と `workflow_handoff.py check` を実行する。70 ファイルのロックを書き換えない。 |
| 私有品質 bundle / work ledger | 原本来歴、校正範囲、品質評価、採用原稿、未解決作業 | entry の SHA で選択し、同じ書籍 ID・範囲・HTML と照合する。 |
| `reader-repair-plan.cjs` | 残る制作作業と配布・実機の待ちを分類 | 同じ manifest と ledger から計画を読み取る。既存レビューを初稿へ戻さない。 |
| `reader-work-resume.cjs` | 上記の接続と復帰資料の一覧 | 状態や原稿を更新せず、公開・保存・同意・合格の操作を実行しない。 |

`resume_consistent` は、この接続の整合が確認できたという意味です。制作側の着手には従来の `workflow_run_guard.require_workflow`、通常納品には従来の 60 項目・配布・実機のゲートが引き続き必要です。既存ルール ID を追加・省略しません。

## 毎回の開始手順

先に依頼文（「続き」の場合はその本の確定済み進捗も参照）から、依頼の書籍ID・原本の開始番号・終了番号を決め、私有の作業場所に依頼ごとの `request.json` を記録する。書名は既存の対応表でIDに解決する。書名や範囲が一つに定まらないときだけ確認する。次の例の値は対象依頼の値に置き換える。

```json
{"schema":"reader-work-request-v1","bookId":"example-book","scanRange":[41,60]}
```

その後に候補の再開資料を選ぶ。候補から依頼値をコピーしない。照合値の不一致を解消する目的で依頼記録を書き換えず、正しい範囲の資料に戻る。新規制作でも依頼を先に記録し、選定原本の本・範囲を確認してから初期化する。

1. 指定された私有 workspace と現行 entry を復元する。公開台帳・公開 URL・古い回答だけを制作原稿の選択根拠にしない。
2. 引継ぎの採用記録または配布索引にある **entry 自体の SHA** を取得する。ローカルで一番新しいファイルを選んで、その SHA を採用根拠にする操作は禁止する。
3. v9.2 runtime と、復元目録に固定されたリポジトリの commit / 各ファイル SHA を復元する。既存の `retained` / `history` は歴史資料として保存し、現行 selection に指定しない。
4. 次の読み取り専用コマンドを実行する。

```sh
node tools/reader-work-resume.cjs \
  --request PRIVATE/request.json \
  --entry PRIVATE/current-work.json \
  --expected-entry-sha256 ADOPTED_ENTRY_SHA256 \
  --surface work
```

5. 結果の `requestedScope` には依頼のID・範囲・記録SHAが残る。依頼欠落・別の本・別範囲では次作業を出さず停止する。`status: resume_consistent` を確認し、`nextAction` を既存の制作手順へ渡す。`adoptionRequired: true` の場合は、表示された現行原稿の採用手続きが先である。再開入口自身は採用・進捗更新を実行しない。
6. `productionPending` / `readyTasks` / `deferredTasks` と `externalWaiting` を区別する。配布同意や iPhone 実機の待ちだけを理由に、実行可能な原本照合・構造修正などを止めない。未確認の実機は合格にせず、従来どおり内容統合の停止条件とも混同しない。

`--surface chat` は同じ検査を実行します。表示面を切り替えても品質基準、原稿、既存証拠、未完了状態を変更しません。

統合entryのない既存稿は `reader-repair-plan.cjs --request PRIVATE/request.json --book BOOK_ID` に採用した台帳・私有manifestを渡す。古い検査結果の次作業を実行しない。`connect_existing_canonical_context` の場合は校正済み稿と根拠の接続から進める。旧commitのコマンド単独で現在の依頼照合を代用しない。

統合を依頼された場合は、同じ私有 `request.json` を使い、`tools/reader-merge-work.py` の `stage`（確定入力の選定）と `merge`（4工程の統合出力）を順に実行する。配布済み実行版の照合方法とコマンドは [統合手順](BOOK_CREATION_PROCESS.md#workでの統合) に従う。

統合保留時には、同じ依頼の工程台帳に登録済みでSHAが一致する候補を使う。正しい候補が一つなら入口がそのまま選定・統合を実行する。複数候補の採用判断や変更済み入力の承認は採用記録で確認する。合格済み原稿を作り直さない。
採用済みの制作再開entryがある書籍は、両コマンドに `--entry PRIVATE/current-work.json --expected-entry-sha256 ENTRY_SHA` を付ける。ENTRY_SHAは選定記録の外部固定値を使う。統合が保留になったらWorkは結果の `nextAction` と `diagnostics` の該当箇所を処理する。個別ファイルの読み取り照合結果は `inputAudit` に出る。依頼範囲内の前提が整った作業は `nextProductionTask` と `readyTasks` を参照し、同じターンで着手して実際の証拠を記録する。原本・根拠・権限を必要とする判断は制作の既存手順に従う。依頼・入力・環境が変わるまで同一失敗の統合を反復しない。継続できる作業が尽きた時に、不足している資料または判断を具体的に伝える。

各分冊と統合後の `sourceReview.queue` は依頼の原本全番号から算出する。原本と照合するページ・欄・理由を次の作業に引き継ぐ。記録の不足は該当ページを保留にし、同じ依頼で実行できる作業は続ける。確定入力の統合が終了したら、統合確認版の HTML に対しても [分冊・統合後の原本全ページ照合](BOOK_CREATION_PROCESS.md) を実行する。

## 私有 entry の形式

schema は `reader-work-resume-v1`、`purpose` は `private_work_resume` です。entry は私有領域に置き、公開リポジトリ内に置くと停止します。

| フィールド | 内容 |
|---|---|
| `workspaceRoot` | entry のあるディレクトリから workspace への相対位置。復元先の絶対パスを書かない。 |
| `bookId`, `scanRange`, `profile` | 一冊・一範囲の明示的な採用対象。 |
| `adoptedArtifact` | workspace 内の HTML の `path`, `sha256`, `bytes`。 |
| `workflow.root` | workspace 内の現行制作 workspace。 |
| `workflow.selection`, `state`, `handoff` | `workflow.root` からの相対 `path` と `sha256`。selection の内部参照もこの state / handoff と一致させる。 |
| `workflow.artifactId` | state の `freeze.artifacts` にある採用 HTML の ID。 |
| `workflow.runtime` | runtime の相対 `root`、`activeRelease` の参照、`releaseId`, `ruleSha256`。 |
| `quality.root` | workspace 内の私有品質 bundle。 |
| `quality.manifest`, `ledger`, `assessment` | `quality.root` 内の相対 `path` と `sha256`。assessment が manifest にある場合は同じものを必須指定する。 |
| `quality.ruleset` | ledger 側の既存ルール集合識別子。runtime の正本版とは役割を区別し、両側の 60 ID と順序を照合する。 |
| `quality.progress` | 任意。同じ ID・範囲・HTML SHA の進捗のみ指定できる。旧進捗を黙って無視して初期化しない。 |
| `toolchain.root`, `toolchain.files` | リポジトリの相対位置と、実行 CJS 依存・品質 `standard.json`・作業順序 `work-catalog.json` の `path`, `sha256`。使用する実装自身も固定する。 |

workspace の位置以外の参照は、それぞれのルートの内側に限定します。絶対パス、`..` による参照範囲の脱出、シンボリックリンクを認めません。私有 manifest が過去証拠を参照することは可能ですが、`retained` / `history` を現行 state や ledger の代替入口にはできません。

## 成功時に返す内容

- `workflow`: 正式な handoff 確認、現行 phase、停止記録、次の制作着手ゲート。
- `quality`: manifest / ledger / assessment の SHA、記録済み品質状態の件数。件数を合格へ変更しない。
- `productionPending`, `readyTasks`, `deferredTasks`: 制作側の不足。前提未完了のものはその理由を保持する。
- `externalWaiting`: 配布・保存読戻し・公開配信・実機など、制作作業と分けた待ち。
- `repairPlan`: 正式な planner の出力。v3 では採用原稿、再利用した検査、不足項目を保持する。旧 v1/v2 の計画を独自に合格へ読み替えない。
- `restoreRequirements`: 現行工程の依存ファイル一覧、ツールの復元区分、品質 workspace を完全復元する指定。リポジトリ管理コードは固定 commit / SHA から復元し、私有配布 ZIP へ重複して収録しない。

`readOnly: true` に加え、`stateChanged`, `artifactChanged`, `workStarted`, `productionAdmitted`, `qualityCertified`, `deliveryAuthorized`, `consentCreated` はすべて `false` です。証拠の SHA 一致は、レビュー担当者の行為を認証したことにはなりません。

## 停止時の扱い

終了コード 2 と `status: blocked` を返し、`errors` に原因を残します。たとえば採用 entry の外部 SHA 不足、selection 不一致、古い retained の選択、HTML の取り違え、共通 60 ID の不一致、未登録実行プログラム、正規 handoff の拒否、別版の進捗です。

不一致を消すために旧承認・証拠・同意を作り直したり、runtime のロックを再計算したりしません。必要な実体を正しい復元目録から取得するか、正規の新しい採用記録として別ファイルへ更新します。エラーを避けるために原本や HTML を再生成しません。

新規書籍で採用 HTML や工程 state がまだ存在しない場合、この再開入口を通すために架空の状態を作りません。既存の新規制作・原本探索・私有初期化手順を使い、実在する採用原稿と工程記録が揃った段階で entry を作成します。

## 検証と復元試験

```sh
node --test tests/reader-work-resume.test.cjs
```

専用テストは合成原稿と合成 Python 契約で、外部 pin、旧版拒否、依存ファイル、正式 verifier の呼び出し、別ルートへの移設、読み取り専用性を確認します。私有本の校正や表示検査を代用しません。

正式な引継ぎ一式を作るときは、別の復元ディレクトリで **実際の未変更 v9.2 runtime** と採用 entry を実行します。ZIP の CRC や個別 SHA の一致だけでは復帰成功としません。旧版の歴史記録が混在していても、明示した現行状態から同じ次作業が返ることを確認します。
