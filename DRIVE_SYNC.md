# Private Drive synchronization

All three applications use the same public OAuth client ID in `drive-config.js` and the shared localStorage key `flashcards_gdrive_client_id_v1`. No client secret, access token or refresh token belongs in this repository. Access tokens are kept only in memory.

Status at implementation: Google Cloud Console returned “Site Unavailable” in the task browser. A Google Cloud project and OAuth client have **not** been created or verified. `clientId` is intentionally empty. Real Google authorization, migration and physical PC/phone testing remain outstanding. Tests using an in-memory Drive service are not evidence of a successful real OAuth connection.

Configure a Web OAuth client, enable Drive API, and authorize the JavaScript origin `https://pirokiiiiito-arch.github.io` without a path. The token client uses `https://www.googleapis.com/auth/drive.appdata` only, with no redirect URI. Set the issued public ID in `drive-config.js`. Do not add a client secret.

The appDataFolder is Google's private application data space, separate from ordinary My Drive folders. The existing “カード共通データ” and three child folders are preserved. This implementation does not request access to those ordinary folders, list unrelated Drive files or change any file's sharing permissions.

## Data and conflicts

`drive-core.js` uses immutable journal batches, separated by namespace:

- `word-flashcards`
- `plant-flashcards`
- `colors1000-review47`

Each batch carries schema, namespace, saved_at, device_id, materialized data, deleted tombstones and immutable revisions with parent revision IDs. A device never PATCHes a shared document. All matching journal pages and all duplicate legacy v2 filenames are read. Known checksums avoid repeated downloads. Uploads only happen when revisions are pending. Changes, foreground/visibility return and manual sync trigger synchronization; there is no unconditional Drive polling timer.

Revisions retain causal ancestry. Independent records and image slots merge. Concurrent changes to the same register converge deterministically and both values remain in the journal and downloadable conflict backup. Concurrent deletion takes precedence. A later deliberate restoration supersedes a known tombstone. Pending revisions, the last applied view and its causal basis are cached in IndexedDB. A first-migration local backup is retained before reconciliation. Connecting with a different Google account fails before uploading the previous account's cache.

Images are immutable authenticated Drive blobs with SHA-256 verification and content deduplication. Browser display caches are disposable. No private image is placed in a public URL or a service-worker cache.

## Supabase migration

The word app checks `word_drive_primary_v1` before initial legacy migration, polling, pulls and all writes. In-flight legacy requests settle before Drive migration. Supabase is then read only to reconcile existing IDs and timestamps. The old tables, sessions and data remain intact. Drive disconnect/expiry does not restart Supabase.

The plant app checks `plant_drive_primary_v1` before uploads and startup migration. Empty/deleted Drive image slots cannot fall back to an old Supabase image. Previously stored private Supabase image paths are enumerated read only and imported once; migration completion is itself synchronized. The original bucket is retained. Image cache references are immutable so replacing bytes is detectable even for the same card/slot.

## 1000 color cards

The source is `colors1000_review47_drive_sync.zip` (current application folder was named review43). The public application preserves the 1000 original fixed card IDs, names, HEX and source data, the research payload, 1047 photo registrations and 107 duplicate suppression records, all five photo roles including palette, links, origin editor, export/import and scroll-preserving navigation.

**The 940 original image files are not included in the public repository.** A manifest contains their original paths, sizes and hashes. After OAuth is configured, connect from the original PC and use “既存940写真を非公開Driveへ登録” to select the existing `assets` folder from review47. All 940 files are verified before the first upload. Uploads can resume and already uploaded content is reused. This initial transfer has not yet been performed. Until then, the HTTPS color application cannot display the private original photographs.

Manual images, deletion/restoration, origin edits with history, study progress and user settings use the separate color namespace. Research data is not overwritten by remote user preferences. The original full ZIP remains the source backup.

## Verification

Run `node --test tests/*.test.cjs` from the repository root. Tests cover the real three adapters in isolated JavaScript/DOM runtimes, bidirectional modifications, image replacement/deletion, original dataset invariants, concurrent edits, tombstones, offline reload, account mismatch, token failure, image cache eviction, duplicate legacy files, no-change upload suppression and service-worker cache isolation.

Service workers use new versioned caches, network-first same-origin app resources, skipWaiting/clients.claim and registration with updateViaCache:none. Each worker only removes its own old cache namespace. The root worker does not substitute the word application for the plant/color applications.

## Complete original-photo migration audit

The v2 private asset catalogue now maps all 1047 registrations to the original 940 SHA-256 hashes, including all 107 duplicate-suppression flags, MIME, byte size, dimensions and orientation. `scripts/build-private-catalogue.py` verifies the original bytes before emitting metadata; it does not alter or publish photographs.

`colors/asset-migration.js` validates every supplied source file before an upload. It discovers existing Drive blobs by SHA-256, uploads each unique image once, and then **bypasses IndexedDB** to download every image from Drive and verify MIME, byte length and SHA-256. A saved local upload or cached image cannot count as remote verification. Migration checkpoints are cached locally and written privately to Drive after each batch. Partial failures do not produce a completed result; restarting reuses verified server-side content. A separate full-verification button works on a device with no original files and no image cache.

Successful sync also writes a deduplicated private photo manifest containing original registrations, Drive file IDs, manual images, deletion/restoration tombstones and image conflict records. The result export separates uploaded, reused, verified, failed and pending counts. The test suite now includes 27 simulated checks, including interrupted migration and corruption of remote bytes while the cache remains correct.

Actual status remains **0/940 images transferred by this task, 0/940 downloaded and verified on real Drive**. Google Cloud Console still displays “Site Unavailable”; the public OAuth client ID is still empty. No existing Drive folders, source images, manual edits or study records have been deleted. Source-data verification and simulated tests do not satisfy real migration or physical PC/phone acceptance criteria.

Still required: real Google Cloud configuration; issued OAuth client ID; actual Google consent; original private image transfer; real existing Supabase/local/Drive migration validation; physical PC↔phone tests including Safari; existing manually edited data verification. Never report these as completed based on the simulated tests.
