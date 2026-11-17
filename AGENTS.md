# Scan-book production: persisted execution contract

Scope: scan-book readers, not plants/colors/word or other applications.

Read the [current canonical sixty-item standard](reader/quality/README.md), **`reader/quality/BOOK_CREATION_PROCESS.md`**, `reader/quality/RELEASE_PROCESS.md`, and the persisted private manifest before continuing. Keep the same sixty IDs. A new chat or 'next 20 pages' is not permission to omit proofreading.

- When creating or revising a scan book, use `templates/reader/v2` as the current WH1-based text/image/mixed reference. `templates/reader/v1` is legacy and must not be silently reused. Do not migrate an existing book to v2 without full template-layout/gesture/pinch/figure regression, exact private HTML readback, and version-specific evidence. The public demo is never the private book.
- Keep original images and raw OCR immutable. Resume canonical revisions and correction history; never fall back to raw OCR when a corrected revision exists.
- Actually reread the source independently, inventory all text regions and edges, resolve differences/numbers/anomalies and page boundaries, then test the exact deliverable. Do not invent evidence, reviewer actions or PASS results.
- Use `reader-private-pipeline.cjs` for corrections/build/plan/export and `reader-release-control.cjs` for evidence validation. Schema PASS is not OCR certification.
- Preserve normal swipe/pinch, 20px default, 1.50 line-height and approved number orientation. Do not rebuild the UI during a text correction. Engine changes require distinct versioned evidence.
- Current v2 heading standard is shared by world-history text and novels: 1.12em (22.4px at a 20px body), font-weight 700, letter-spacing 0, margin-bottom .82em; color is the only heading-style difference (`#925341` history / `#000` novel). Always use the v2 CSS and correct `template_profile`. Older 1.08em proofreading drafts must never be used as template references; real-device and published-book checks are separate.
- Use create-only private staging. Read back before loader publication. Record deployment separately. Promote only after validating the current target; read back the exact written ID and bytes afterward. Execute verify-plan before a connector write and complete-plan afterward. A plan is not delivery.
- Preview requires a specific explicit unverified-preview request, a dedicated preview route and create-only storage. Do not overwrite normal reading files with drafts.
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
