# Cross-chat scan-book delivery gate (operating contract)

**Scope:** all user-facing scan-book readers, regardless of the chat in which they
were made. The canonical **60 check IDs and two profiles** remain unchanged.
The private central ledger is in the user's own Google Drive, not this public repo.
Never store any scan, OCR text, private ledger, Google credential or book image here.

## One evidence boundary for every chat

An assistant may build private drafts, run OCR, save a checkpoint and report
progress. **Those are not finished reader deliveries.** A direct `sandbox:`
attachment, Google Drive link or GitHub Pages Chrome URL must not be described as
a normal verified reader without a successful verdict from
`tools/reader-unified-delivery-gate.cjs` on the **exact artifact bytes**.

Before every attempted handoff:

1. Read the **current** 60-rule canonical source and this repo's `AGENTS.md`.
2. Fetch the private central ledger `全書籍共通_読書品質中央台帳_PRIVATE.json` from
   Google Drive (look in the private bookshelf workspace; the initial file name
   includes a `YYYYMMDD_HHMM` prefix). Preserve its revision and Drive identity;
   do not substitute an old chat quote, empty search result or inferred status.
3. Read the private `reader-private-bundle-v2` manifest and original image index,
   corrections, independent pass, resolutions and the exact newly generated HTML.
4. For **production**, require the canonical 60-rule verifier, exact ledger
   artifact+source+canonical SHA, zero unresolved source defects, independent
   source-backed OCR anomalies, same-ID Google Drive byte readback, public HTTP
   200+SHA and actual iPhone evidence where a complete delivery is claimed.
   No unsupported `passed` flags. Unknown or failed prerequisite = **block**.
5. For an **unverified preview**, require separate, unmistakable **user-initiated**
   consent specifying *unverified OCR*, the exact book+artifact SHA and that this
   is merely a preview. "作って", "次へ", a legacy unverified upload, and a self-made
   JSON flag are **not** enough evidence that the user knowingly asked for a
   broken OCR preview. Default: no unreviewed preview delivery.
6. A completed stage/plan is never a completed delivery. Separate `stage` from
   `delivery`. All direct-host file links must be regarded as out-of-band unless
   their byte hash and the same final verdict are explicitly checked.
7. Record the result and unresolved work under the exact SHA in the private
   ledger. Keep old versions and failures. Never mutate `failed` into `not_run`
   merely to make a gate pass. Every new chat must resume from that state.

## Mandatory local invocation

After obtaining the actual PRIVATE manifest, artifact and latest Drive ledger,
run (paths shown are placeholders, never public repository paths):

```sh
node tools/reader-unified-delivery-gate.cjs \
 --manifest PRIVATE/manifest.json \
 --artifact PRIVATE/reader.html \
 --ledger PRIVATE/central-ledger.json \
 --channel production --step stage \
 --report PRIVATE/reports/preflight.json
```

This can only report `private_staging_only`; it is not a release. Before **final
delivery**, call again with `--step delivery`, plus the actual
`--drive-file-id`, `--drive-readback`, `--drive-receipt-file` and when claiming
a Chrome URL `--chrome-url`, `--public-evidence-file`, `--public-entry`,
`--public-book-id`. The private record and all hashes must be tied to the
current artifact. Production additionally calls the existing **device** phase
including 60 IDs and actual iPhone evidence. A normal release without that
evidence remains blocked, even when Chromium and GitHub Actions are green.

Preview-specific syntax is the same with `--channel preview`, a private
`--consent-file` conforming to `reader-unverified-preview-consent-v1`, and
the existing private manifest's `previewAuthorization`. A preview verdict can
only be `explicit_unverified_preview_only`; it never says source-correct,
completed or iPhone-certified. For a preview delivered through Drive, still
require same-ID readback. If a Chrome URL is claimed, the deployed URL hash must
also be evidenced. The checker does not manufacture or authenticate consent.

## Central ledger schema (PRIVATE)

`reader-central-quality-ledger-v1` with monotonic integer `revision` and an
`entries` array. Key every entry by **(bookId, range, artifactSha256)**.
Required per entry: `profile`, `originalIndexSha256`, `canonicalSha256`,
`quality.status`, `quality.openFindings`, `quality.independentReviewSha256`,
and source-backed `quality.anomalyResolutions` for any actual OCR alerts.
No registered exact artifact: block. A screenshot showing that Chrome can render
the HTML changes *none* of these fields.

Do not publicly print OCR findings' contents; the gate reports only counts,
kinds and hashes. Suspicious English/pipe/plus signs are **review triggers**,
not automatic edits: legitimate typography may be source-confirmed with exact
source-image and region evidence. OCR accuracy cannot be proven only from a
synthetic parser or a claimed human reviewer name.

## What code can and cannot enforce

The repository can prevent **managed** issuance and checked publication when
required inputs are missing. It can run synthetic negative tests on every
change. It cannot intercept arbitrary messages in all ChatGPT chats, direct
ChatGPT-generated attachments, external manual Google Drive uploads, owner
admin changes, or prove that a named human actually read every source character.
This is a platform limit, **not** a reason to skip the gate. Use the same
procedure for chat links, label `未検証` honestly and avoid offering a normal
reading file while the gate is blocked.

Do **not** weaken the old 60-item validator, change the legacy baseline, erase
existing versions, or reclassify `novel` as `world_history_1` to clear errors.
