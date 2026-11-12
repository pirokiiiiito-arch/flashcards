# Scan-book production: persisted execution contract

Scope: scan-book readers, not plants/colors/word or other applications.

Read the canonical sixty-item Google Drive standard `1CngvhZvJPQsGizwmaVKC_old4Vlvxzn2`, `reader/quality/RELEASE_PROCESS.md`, and the persisted private manifest before continuing. Keep the same sixty IDs. A new chat or 'next 20 pages' is not permission to omit proofreading.

- Keep original images and raw OCR immutable. Resume canonical revisions and correction history; never fall back to raw OCR when a corrected revision exists.
- Actually reread the source independently, inventory all text regions and edges, resolve differences/numbers/anomalies and page boundaries, then test the exact deliverable. Do not invent evidence, reviewer actions or PASS results.
- Use `reader-private-pipeline.cjs` for corrections/build/plan/export and `reader-release-control.cjs` for evidence validation. Schema PASS is not OCR certification.
- Preserve normal swipe/pinch, 20px default, 1.50 line-height and approved number orientation. Do not rebuild the UI during a text correction. Engine changes require distinct versioned evidence.
- Use create-only private staging. Read back before loader publication. Record deployment separately. Promote only after validating the current target; read back the exact written ID and bytes afterward. Execute verify-plan before a connector write and complete-plan afterward. A plan is not delivery.
- Preview requires a specific explicit unverified-preview request, a dedicated preview route and create-only storage. Do not overwrite normal reading files with drafts.
- Export public evidence receipts only after local validation. Receipts bind hashes and states but are NOT authenticated human-review signatures. No ephemeral private signing key is required or uploaded.
- Publish only the isolated tree created by reader-publish-stage.cjs after all generators. Unreviewed new assets stay in source, outside that tree. Do not expand the compatibility baseline to hide a failed review.
- Existing drafts remain unverified. Known defects must not be relabeled as not_run. iPhone-not-run is distinct from actual iPhone failure; Chromium does not certify an iPhone.
- Store raw/source/canonical/evidence/checkpoint files outside this public repository. Never publish source scans, book text, private evidence or secrets. Defect injection is permitted on synthetic test copies only.
- Do not claim all paths are technically intercepted: arbitrary manual Drive writes, direct chat attachments and administrator changes are outside this gate. Apply the same checked protocol rather than bypassing it.

Resume by restoring the entire private workspace, inspecting manifest and correction history, and verifying input hashes. Save the checkpoint before ending a long run. Preserve unresolved status honestly; stopping a bad release alone is not completion of the source proofreading task.
