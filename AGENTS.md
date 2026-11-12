# Reader production instructions

These instructions concern scan-book production and reader releases only. They do not change the plant, color, word or other applications in this repository.

The normative checklist is the existing 60-item document, Google Drive file `1CngvhZvJPQsGizwmaVKC_old4Vlvxzn2`. Keep its IDs. Read `reader/quality/RELEASE_PROCESS.md` and the actual persisted private workspace before continuing a book. Conversation memory is not a production database.

## Mandatory execution

- Never publish book OCR, source scans, figure crops, private evidence or a signing private key in this public repository.
- Resume immutable inputs, canonical revisions and correction history. Do not regenerate from uncorrected OCR when a canonical revision exists. Do not invent source text, reviewers, evidence, device checks or PASS results.
- Use `tools/reader-private-pipeline.cjs` and `tools/reader-release-control.cjs` for candidate construction, actual-file validation and checked delivery. Old `reader-quality-gate.cjs` success is schema validation, NOT source correctness or delivery permission.
- A user request such as 'next 20 pages' does not authorize skipping source review or silently delivering a draft. Preparation requires every applicable production check, complete source inventory, independent rereading, resolved discrepancies/numbers/anomalies, boundaries and real-artifact 24-condition evidence.
- Source-image hashes alone do not certify OCR. Lightweight browser fixtures do not certify the full-resolution private deliverable. Chromium tests do not certify an actual iPhone.
- Preview requires an explicit, recorded user request for that exact unverified artifact, a distinct preview route/storage and create-only delivery. Never replace a normal edition with a preview.
- Stage a candidate as a new private Drive file; read it back and compare bytes before publishing its loader. Verify deployment separately. Only then promote the normal target using its observed current version/hash, followed by exact-target readback. Do not claim an upload or a plan as successful delivery.
- A passed private verifier may issue a signed receipt, with an approved key outside this repo. Public CI verifies the receipt, artifact/source/engine identities and every changed reader asset. Do not expand the frozen historical exception set or alter a trust anchor to make a failing book pass.
- Existing reader bytes are preserved for compatibility, not retroactively certified. Old drafts remain drafts. Explicit source/display/UI failures must be resolved, not hidden under an inherited exception.
- Book edits must not change working swipe/pinch logic, 20px defaults, 1.50 line-height or approved sideways multi-digit numbers. An intentional renderer change is a separately versioned change requiring new evidence. Do not update UI while doing OCR corrections.
- Use test copies for defect injection. Run the release-control regression suite and the final admission gate after all generators. Do not remove that final gate to obtain a green deployment.

## Trust boundary

This code cannot intercept arbitrary manual Google Drive uploads, direct ChatGPT attachments, administrator edits of CI, or prove that a person actually inspected an image. These are NOT automatically protected. For connector work, obtain a fresh checked delivery plan, verify its exact operation/target/hash/expiry immediately before the connector mutation, then read back the result. Never bypass that protocol and then describe it as enforced.

If review or tooling is incomplete, preserve the private workspace and explain the exact remaining work. Do not label the book completed or claim that all 60 requirements passed.
