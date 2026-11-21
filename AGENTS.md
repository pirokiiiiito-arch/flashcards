# Scan-book production: persisted execution contract

## 全チャット共通：納品前に統一ゲートを必ず使う（既存60項目は不変）

対象：スキャン本の新規作成、次の20枚、OCR再校正、読書HTML再作成、
Google Drive 保存、Chrome公開、ファイルリンクの提示、既存版の修正。
チャットが変わっても「作って」は未校正プレビューの依頼ではない。

制作の再開は [Work/Chat 共通の再開入口](reader/quality/WORK_RESUME_PROCESS.md)
を使う。PRIVATE の現行 entry が、制作工程の選定台帳・現行ルール・実行版と、
原本/校正/60項目の評価・現在の作業HTMLを結び付ける。公開URLや公開版の
台帳だけを現行制作原稿の根拠にしない。Chromeで一冊が表示できることは
全体の運用点検や通常完成の代用にならない。

制作担当は、再開資料を選ぶ前に依頼から書籍ID・原本の開始／終了番号を確定し、私有の `request.json` に記録する。共通の再開入口と旧形式用の作業計画には毎回 `--request PRIVATE/request.json` を渡す。別の本・別範囲・依頼記録欠落で停止したときは依頼に合う資料を探す。

統合を依頼された場合は、同じ私有 `request.json` を使い、`tools/reader-merge-work.py` の `stage`（確定入力の選定）と `merge`（4工程の統合出力）を順に実行する。配布済み実行版の照合方法とコマンドは [統合手順](reader/quality/BOOK_CREATION_PROCESS.md#workでの統合) に従う。

統合保留時には、同じ依頼の工程台帳に登録済みでSHAが一致する候補を使う。正しい候補が一つなら入口がそのまま選定・統合を実行する。複数候補の採用判断や変更済み入力の承認は採用記録で確認する。合格済み原稿を作り直さない。
採用済みの制作再開entryがある書籍は、両コマンドに `--entry PRIVATE/current-work.json --expected-entry-sha256 ENTRY_SHA` を付ける。ENTRY_SHAは選定記録の外部固定値を使う。統合が保留になったらWorkは結果の `nextAction` と `diagnostics` の該当箇所を処理する。個別ファイルの読み取り照合結果は `inputAudit` に出る。依頼範囲内の前提が整った作業は `nextProductionTask` と `readyTasks` を参照し、同じターンで着手して実際の証拠を記録する。原本・根拠・権限を必要とする判断は制作の既存手順に従う。依頼・入力・環境が変わるまで同一失敗の統合を反復しない。継続できる作業が尽きた時に、不足している資料または判断を具体的に伝える。

1. 常にこのリポジトリの現行 AGENTS.md と
   `reader/quality/work-ledger.json`（書籍ID・ページ範囲・SHA・未解決不具合）
   および該当する**非公開**の原本台帳・校正履歴・証拠を取得してから着手。
   台帳にない書籍・SHAが異なる書籍は `blocked`。過去の回答を証拠にしない。
2. 原本ZIP、各原本画像、OCR、全文字独立校正、見出しと本文の関係、
   ページ境界、既存60項目、実配布HTML、Drive同一ID読戻し、
   公開HTMLの HTTP 200 とSHA、実際のiPhone実機確認を独立に検証。
   途中の成功を後段の成功に読み替えない。
3. 直接 sandbox リンク、Google Drive リンク、公開URLを通常の
   「完成版／読書用通常版」として渡す前に、ユーザーに渡す**そのHTML本体**で
   `tools/reader-unified-handoff.cjs` を `--mode normal`（省略時もnormal）で
   実行し、`handoffAllowed:true` かつ `status:verified_release` の
   専用検査報告がない限り通常版の納品を停止。原本照合、全60項目の
   対象版の証拠、iPhone実機、Drive、公開配信の検証が揃わなければ停止。
4. 確認用ファイルは、ユーザーが**明示的に**その書籍・版の未完成状態を
   理解して受領を求めた場合だけ、`--mode preview` の
   `unverified_preview_only` として許可する。未校正OCRの既存v1は従来の
   明示文言を維持する。独立二稿の照合済みでも全原本QA・表示等が未完了なら、
   v2はその実態を記録し、虚偽の「未校正OCR」表明を要求しない。
   担当範囲ごとの原本比較済み校正稿で独立全文二稿が未完了なら、
   `reader/quality/PREVIEW_V3_PROCESS.md`のv3を使う。実レビューの範囲と
   動的24条件状態を固定し、見出し独立採録を本文の独立全文二稿へ
   拡張しない。実際の開示・直後の実返信・同一ID読戻しが必要であり、
   v1/v2・通常版・60項目・iPhone条件は変更しない。
   正確な対象SHA・範囲と残る検査を明示した直前の受領確認質問に対する
   実際の肯定短答・確認用URL依頼は、質問原文・対象表示・返信原文を
   同じハッシュ付き記録に結び付けて検査する。返信を水増ししない。
   開示を伴わない単なる「41-60を作って」「URLをくれ」、否定、別版への
   同意は許可にならない。private manifest / original-source preflight /
   work ledger / preview-consent は同じartifact SHAに紐付け、両validatorは
   同一consentファイルを照合する。全60項目・通常版・実機の合格条件は不変。
5. OCR中の英字断片、縦棒 `|`、代替文字などは**推測で書き換えず**、
   原本で確認した例外以外を未解決として通常版の完成判定を止める。
   第4項の明示的な確認版では未解決を残して開示し、解決済みに変えない。reviewer の自己申告
   だけで独立照合済みとせず、既存60項目の証拠を再検証する。
6. 作業報告には `原本画像` `OCR独立校正` `60項目`
   `Drive読戻し` `Chrome公開HTTP` `実機` の各状態を別々に表示。
   進められないときは未完の理由と現在のSHAを示し、完成を主張しない。

実行例（入力・レポートは**GitHub公開リポジトリ外**）：
```sh
node tools/reader-unified-handoff.cjs \
  --mode normal --artifact PRIVATE/reader.html \
  --ledger reader/quality/work-ledger.json \
  --manifest PRIVATE/manifest.json --source-proof PRIVATE/source-preflight.json \
  --ocr-review PRIVATE/ocr-anomaly-review.json --public-evidence PRIVATE/pages-http.json \
  --report PRIVATE/20261118_1232_unified-result.json
```

正式な私有制作パイプラインの最終 `attach` / `promote` 操作にも
この共通ゲートを接続する。リクエストには `workLedgerFile`、
`sourceProofFile`、必要なら `ocrReviewFile`、
`publicEvidenceFile` を指定する。欠落・不一致があれば
`UNIFIED_CROSS_CHAT_HANDOFF_BLOCKED` で停止する。
`stage` は未配布の私有中間ファイル、`pages` は既存公開承認と
HTTP検査の別段階であり、どちらも完成・通常納品の証拠ではない。

この統一ゲートは外部のGoogle Drive操作やチャット添付を自動的に
傍受・禁止できるものではない。ChatGPT全体のシステム設定を変えた
とは絶対に主張しない。公式制作手順とGitHub公開は自動テストで制御し、
その他の手作業ではこのゲートを義務化する。より強い組織横断強制には
認証された納品APIと送信権限の集約が別途必要。


## 全書籍の修復エンジン v2（ページ内容に応じて作業を切り替える）

現行の [全書籍共通修復プロファイルと校正遷移](reader/quality/REPAIR_PROFILES_AND_STATES.md) を使用する。
小説 `novel` と歴史 `world_history_1` は別の表示基準のまま、
`text`／`image`／`mixed` は内容の修復作業分類として扱う。
画像ページに文字がない場合は必ず原本でその事実を確認し、
架空のOCR本文や不要な第二転記を作らない。文字ラベルやキャプションが
存在すれば文字領域として独立照合する。

新規書籍の修復進捗は `reader-repair-progress-v2` に出典画像SHA、
各領域・説明文・注記・ページ境界の証拠を持たせる。過去の小説v1進捗は
互換保持するが、歴史書／画像本へ推測で当てはめない。
校正は `visual_first_pass_only` → `second_pass_in_progress` →
`second_pass_completed` → `source_resolved` → `awaiting_canonical_60` の順で
確認し、進行ごとに `reader-repair-transition.cjs` によるPRIVATE候補を作る。
新しいHTML SHAでは旧証拠を完成扱いせず、原本照合記録と差分を検証し直す。
キューや状態が最後に達しても、既存60項目とiPhone実機の本当の証拠なしに
通常納品しない。自動テストは複数の合成書籍の分岐を確認するだけである。
## 長時間一括テスト禁止：私有読書HTMLの表示検査はSHA付きの分割方式

小説 `novel` のHTMLが `window.NovelReader.inspect()` を使う場合、
現行 [高速分割検査手順](reader/quality/FAST_LAYOUT_QA.md) に従い
`python3 tools/reader-fast-layout.py --html PRIVATE/book.html --report PRIVATE/layout.json`
を実行。320/390/430px×8文字サイズ＋高さ5条件を幅別に実行し、
合格済みの同一SHA条件は再検査せず、失敗・未実施条件のみ再実行する。
HTMLまたは検査コードが1バイトでも変更された場合は旧キャッシュを失効。
前回の原本照合や校正成果は勝手に破棄せず、表示検査だけを再実施する。
他書籍エンジンに `NovelReader` を偽装してPASSにしない。
29/29表示PASSでも独立全文字校正、現行60項目、実機iPhoneのPASSとは別。

## 納品停止後も作業を止めない：修復キューを必ず実行

読書HTMLの通常納品ゲートが不合格になったら、そこで毎回「できない」
だけを返して終了しない。共有台帳の最新書籍ID・対象SHAを検証して
現行entryがある場合は `reader-work-resume.cjs` から両台帳の一致を確認し、
まだ統合entryがない既存作業は `node tools/reader-repair-plan.cjs --request PRIVATE/request.json --book BOOK_ID` を実行する。scoped reviewを採用した作業には必ず
`--manifest PRIVATE/manifest.json --ledger PRIVATE/current-ledger.json` を指定し、必要なら
`--progress PRIVATE/repair-progress.json` によりページ別二次転記・差分
・前後境界の証拠を引き継ぐ。この一覧から優先度が一番高い未完了作業を
**同じ作業で実際に着手**し、原本を再読して修正・記録・再検査する。
完成まで工程を積み重ね、チャットが変わっても実証済み部分を再利用する。

既存の校正済みcanonicalを、pendingDraft欄がないという理由で初稿作成へ
戻さない。60項目の未完了行は、必要な作業・残要件・完了根拠へ展開する。
`reader/quality/work-catalog.json` は既存60IDの作業案であり、品質合格を
追加・免除するルールではない。現在の評価にある部分合格と確認範囲を保ち、
記録済みというだけで全条文をpassedにしない。原本・構造・表示・配布・実機を
別の依存先として扱い、配布同意や実機待ちだけで原本作業を止めない。
白紙は原本確認の根拠と領域0件を記録し、架空の本文や図を作らない。

読書本文の不自然な英字、縦棒などの疑義は自動修正しない。
原本に存在する文字は根拠付きで残し、誤読は校正履歴付きで修正する。
第二稿は第一稿を流用せず原本を独立に読み、ページの各領域・内部境界・
分冊外の境界を実証する。作業キューの「記録済み」は正式60項目の
「passed」ではない。校正後に文字・原本・画像・組版・操作の影響範囲を
再検査し、同一SHAの納品ゲートを通してから正式納品する。

ユーザーが「作って」と頼んだときは、未校正プレビューの配布許可と
解釈しないが、作業用の**PRIVATE**草稿は作り続けてよい。
停止は「正式納品」に対してだけであり、校正の進行は止めない。
アクセス不能な原本や未解決の曖昧さがある場合はそのページを明示し、
別のページでできる作業を進める。完了を偽らない・背景で勝手に
作業を継続すると約束しない。キューを全件消しただけで完成とも
認定しない。最後は既存60項目の正式証拠が必要。

Scope: scan-book readers, not plants/colors/word or other applications.

Read the [current canonical sixty-item standard](reader/quality/README.md), **`reader/quality/BOOK_CREATION_PROCESS.md`**, `reader/quality/RELEASE_PROCESS.md`, and the persisted private manifest before continuing. Keep the same sixty IDs. A new chat or 'next 20 pages' is not permission to omit proofreading.

- When creating or revising a scan book, use `templates/reader/v2` as the current WH1-based text/image/mixed reference. `templates/reader/v1` is legacy and must not be silently reused. Do not migrate an existing book to v2 without full template-layout/gesture/pinch/figure regression, exact private HTML readback, and version-specific evidence. The public demo is never the private book.
- Keep original images and raw OCR immutable. Resume canonical revisions and correction history; never fall back to raw OCR when a corrected revision exists.
- Actually reread the source independently, inventory all text regions and edges, resolve differences/numbers/anomalies and page boundaries, then test the exact deliverable. Do not invent evidence, reviewer actions or PASS results.
- Use `reader-private-pipeline.cjs` for corrections/build/plan/export and `reader-release-control.cjs` for evidence validation. Schema PASS is not OCR certification.
- Preserve normal swipe/pinch, 20px default, 1.50 line-height and approved number orientation. Do not rebuild the UI during a text correction. Engine changes require distinct versioned evidence.
- Current v2 heading standard is shared by world-history text and novels: 1.12em (22.4px at a 20px body), font-weight 700, letter-spacing 0, margin-bottom .82em; color is the only heading-style difference (`#925341` history / `#000` novel). Always use the v2 CSS and correct `template_profile`. Older 1.08em proofreading drafts must never be used as template references; real-device and published-book checks are separate.
- Use create-only private staging. Read back before loader publication. Record deployment separately. Promote only after validating the current target; read back the exact written ID and bytes afterward. Execute verify-plan before a connector write and complete-plan afterward. A plan is not delivery.
- Preview requires a specific explicit acceptance of the exact disclosed unfinished edition, a dedicated preview route and create-only storage. A short affirmative reply can be bound to the immediately preceding artifact-specific disclosure; a bare URL request cannot. v2 keeps two-draft reconciliation separate from pending full source QA. v3 separately preserves scoped source comparisons and actual display evidence, without claiming a full independent second transcription; follow `reader/quality/PREVIEW_V3_PROCESS.md`. Do not overwrite normal reading files with drafts.
- Export public evidence receipts only after local validation. Receipts bind hashes and states but are NOT authenticated human-review signatures. No ephemeral private signing key is required or uploaded.
- Publish only the isolated tree created by reader-publish-stage.cjs after all generators. Unreviewed new assets stay in source, outside that tree. Do not expand the compatibility baseline to hide a failed review.
- Existing drafts remain unverified. Known defects must not be relabeled as not_run. iPhone-not-run is distinct from actual iPhone failure; Chromium does not certify an iPhone.
- Store raw/source/canonical/evidence/checkpoint files outside this public repository. Never publish source scans, book text, private evidence or secrets. Defect injection is permitted on synthetic test copies only.
- Do not claim all paths are technically intercepted: arbitrary manual Drive writes, direct chat attachments and administrator changes are outside this gate. Apply the same checked protocol rather than bypassing it.

Resume by restoring the entire private workspace, inspecting manifest and correction history, and verifying input hashes. Save the checkpoint before ending a long run. Preserve unresolved status honestly; stopping a bad release alone is not completion of the source proofreading task.

## Japanese fiction dialogue — separate layout, unchanged source

For novels (including Nine Stories), prefer the isolated `templates/reader/v2/novel.html` plus `novel-dialogue.js`, `novel.css`, and `novel.js`, keeping WH1's 20px, 1.50 line height, vertical right-to-left layout and all navigation. Every *top-level spoken* opening `「` starts a **new vertical column** with no dialogue indentation. Do not change literal OCR/canonical characters merely to create line breaks. Distinguish embedded terms/quoted titles that are not speech (`quoteMode:"inline"` with source-grounded justification). Confirm source-block round-trip equality and visual column starts with version-specific tests. Never migrate preexisting book files or resume paused scans just because the public fiction demo was built; use the complete evidence gates and a new, reviewed private artifact for actual book application.


## Evidence gates before advancing or claiming completion

For **every future scan-book** create/revise/rebuild task, use the execution-evidence progression in `reader/quality/BOOK_CREATION_PROCESS.md`. Run `node tools/reader-evidence-gate.cjs PRIVATE/manifest.json prepare` before private staging, `release` after actual same-ID Google Drive readback, `deployed` for production deployment evidence, and `device` only with real iPhone confirmation. The gate calls the existing canonical sixty-item validator. A failed/unknown prerequisite blocks promotion and any completion claim. The only exception is an explicitly requested, uncertified preview; its `preview` pass never counts as a full-book pass.

The Pages workflow performs **after-deploy HTTP 200 + served SHA-256** checks for every evidence-admitted reader entry and retains an Actions artifact. Always check that result, not merely GitHub source presence or a green deploy step, before saying a Chrome URL is live. If a live check cannot be done, mark it unverified; never fabricate success. Report the actual evidence, unresolved statuses and scope. Immutable matching evidence may be reused only when the current artifact/SHA and rule applicability allow it. These tools cannot enforce behavior outside the official workflow (for example a manually typed chat link); apply the same evidence gate when responding.

## Book creation / next 20 scans (automatic on every request)

For each new book, each further 20-scan set and each reader update, perform the production sequence in `reader/quality/BOOK_CREATION_PROCESS.md`. Before any public commit, use `node tools/reader-book-preflight.cjs BOOK_ID` and `node tools/reader-book-preflight.cjs --all`; GitHub Actions `.github/workflows/reader-book-creation.yml` runs on newly registered/modified preview records. Do not claim a preflight is source proofreading, device verification, or successful deployment. Historical preview issuer compatibility is exact per-book/per-receipt; it never applies to a normal reader release. Always report Drive HTML URL and dedicated Chrome URL in plain text with the actual observed publication status, including 404 or unpublished.

## Mandatory source discovery for NEW ZIP scan batches (before OCR or asking for re-upload)

Before saying a source archive is missing, check prior work records for its exact
Google Drive file/folder ID, source name, image count and SHA-256. Query an ID if
known, and **list the actual source folder directly with pagination**. Treat search
results, MIME filters and plain-text indexing only as hints: an empty result is
NOT proof of absence. With the Files mount confirm `/Google Drive` really has an
`external-gdrive:` ID, then list the exact known folder; if listing is incomplete,
continue its cursor or classify the source as `未確認`, not absent. ZIP MIME variants
include `application/zip` and `application/x-zip-compressed`; actual ZIP signature,
archive SHA, image count and requested ordered scan range must be checked from
the downloaded **private** original. Keep Google IDs and source text OUT of GitHub.

For new ZIP batches, create a private `reader-source-discovery-input-v1` snapshot
from provider results and run:

```sh
python3 tools/reader-source-preflight.py --snapshot PRIVATE/source-lookup.json --archive PRIVATE/original.zip --report PRIVATE/source-preflight.json
```

Use `node tools/reader-private-pipeline.cjs init-resolved PRIVATE/book.html PRIVATE/BOOK_ID BOOK_ID PRIVATE/loader.html PRIVATE/original-index.json PRIVATE/source-preflight.json`
when initializing the resulting private reader. Its gate compares the preflight
report's range and original page digests with the actual reader file. A missing,
mismatched or inconclusive report blocks this NEW entrypoint; the historic `init`
command remains unchanged for legacy workspaces. No new 61st quality item.

`source_ready_for_ocr` means **only** that the previous source fingerprint and
private ZIP bytes, direct-folder metadata and range are internally consistent.
It is NOT an authenticated Drive provenance certificate, a proofreading PASS,
a complete reader, a publicly deployed URL, or an iPhone test. An unresolved
result never authorizes claiming global absence or asking the user to re-upload
on search-zero alone. When a direct folder listing is not available, report the
unresolved dependency and try other authorized listing routes; never invent
matches. Source discovery is read-only and must not erase old files or receipts.

## Final private reader-file handoff check (supplement, not rule 61)

For each newly built **compatible v2 private reading HTML**, run the read-only
`tools/reader-handoff-check.cjs` against the **exact file being handed to the user**.
Supply the explicit book ID, scan range, profile (`novel` or `world_history_1`),
loader entry and Chrome URL. Filename must have valid `YYYYMMDD_HHMM_` prefix.
Use the pre-existing, separately preserved source-image SHA manifest when available;
**a hash repeated inside the same HTML is only a self-consistency check**, not
independent source fidelity. Keep both the original manifest and the report PRIVATE.

This is a *handoff guard only*; it does not replace, weaken, duplicate or certify
the 60 IDs, `reader-evidence-gate`, independent OCR review, Drive same-ID readback,
HTTP 200 + deployed byte check, actual Chrome import, or real iPhone testing.
Its highest state is `structural_pass_only` and `releaseEligible:false` even
if private HTML has self-declared `passed` fields. If the format is incompatible,
do not certify it by bypassing the checks; use the original canonical procedure.
Never retroactively fail or rewrite historical books solely because old filenames
lack timestamps. Timestamp naming is mandatory for **new/recreated files**.

Do not silently reuse a cached earlier HTML at the public Chrome entry. An import
URL is an importer, not a direct book URL. In the delivery message always give
both the copyable exact HTML location and the copyable `https://` Chrome entry
with separate statuses: artifact integrity, independent 60-rule source checks,
Drive readback, public served SHA, Chrome file-import test, and real iPhone test.
Where any evidence is missing, report `未検証` rather than `完了`.

## 全ページの原本照合と小説の作品・章の開始

作業開始時はライブラリ直下の現行正本とその運用版を参照する。各分冊・統合版では対象 HTML に対して `node tools/reader-source-pages.cjs PRIVATE/manifest.json --request PRIVATE/request.json` を実行し、原本番号・未解決の欄を引き継ぐ。独立転記との不一致は同じ原本・同じ領域で読み直して確定する。小説の作品・章の見出しは次ページの先頭に置き、後続本文を左列に続ける。実行手順と必要な記録は [書籍制作手順](reader/quality/BOOK_CREATION_PROCESS.md) に従う。
