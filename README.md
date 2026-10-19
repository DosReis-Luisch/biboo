# Biboo — Bilingual Books

Biboo is a local-first Progressive Web Application for bilingual families. It provides an installable, offline-capable book library: create a book, choose its languages, set page dimensions, and add photographs of its pages. Milestone 2A adds local file/camera import, thumbnails, larger viewing, reading-order management, and page deletion.

All metadata, original images, and thumbnails stay on the device. Milestone 2B adds manual, non-destructive four-corner perspective correction; Milestone 3 adds portable `.biboo` book backup and restore. Milestone 4A adds temporary local OCR with word-coordinate overlays for Dutch and Portuguese. Translation, sticker positioning, printable labels, and PDFs are future work.

## Stack

Uses the existing dependencies: React 19, TypeScript 6, Vite 8, MUI 9 with Emotion, React Router 7, Dexie 4, dnd-kit, vite-plugin-pwa 2, Workbox, @vite-pwa/assets-generator 2, @zip.js/zip.js 2.24, Vitest/fake-indexeddb, and Tesseract.js 7 with the installed Dutch/Portuguese trained-data packages. No backend, accounts, telemetry, external fonts, or paid services.

## Development commands

Run from the repository directory with the already installed dependencies:

```powershell
npm run dev
npm run lint
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Development runs on the URL printed by Vite. The development server intentionally does not register a service worker. `build` runs the TypeScript project build, bundles the application, generates installation assets and the manifest, and produces the service worker in `dist`. `preview` serves that production output for local inspection; it is not a production hosting service.

Milestone 4A has not been built, linted, tested, or browser-verified during implementation. Run the manual checks below; no successful execution is claimed for these changes. `predev` and `prebuild` run the local OCR asset packager automatically; direct Vite invocations require `npm run prepare:ocr` first.

## Local Wi-Fi testing with HTTPS (Windows and iPhone)

`http://localhost` is suitable on the computer running Biboo; `http://192.168.…` on a phone is not a secure context. UUID creation, service workers and OCR preparation need browser security capabilities. Biboo now shows an explicit insecure-connection warning and guards native `crypto.randomUUID()` without substituting weaker IDs. Database/quota/access failures retain their storage diagnostics; validation and unexpected application failures are not all labeled IndexedDB errors.

Preview accepts **both** `BIBOO_HTTPS_CERT` and `BIBOO_HTTPS_KEY` from the PowerShell process environment. These are server-side variables; do not prefix them with `VITE_`. With neither set, preview remains HTTP. With only one set, preview stops with a configuration error; unreadable files or invalid TLS pairs also fail instead of silently falling back to HTTP. These settings affect `vite preview` only, not production hosting or the development server. OCR packaging, existing Workbox caches and update behavior are unchanged.

Run these steps manually; none were executed during implementation. If mkcert is absent, install the Windows tool (not an npm dependency) using [its Windows package](https://github.com/microsoft/winget-pkgs/tree/master/manifests/f/FiloSottile/mkcert), then reopen PowerShell if PATH has changed:

```powershell
winget install --id FiloSottile.mkcert --exact
```

Find the IPv4 address of the active Wi-Fi adapter. Ignore VPN/virtual adapter addresses and replace the example IP below with the actual address:

```powershell
Set-Location C:\workspace\active-projects\biboo
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object InterfaceAlias,IPAddress
$bibooLanIp = '192.168.1.42'
New-Item -ItemType Directory -Force .certs | Out-Null
mkcert -install
mkcert -cert-file .certs\biboo-cert.pem -key-file .certs\biboo-key.pem localhost 127.0.0.1 "::1" $bibooLanIp
$env:BIBOO_HTTPS_CERT = (Resolve-Path .certs\biboo-cert.pem).Path
$env:BIBOO_HTTPS_KEY = (Resolve-Path .certs\biboo-key.pem).Path
npm run build
npm run preview -- --host 0.0.0.0 --port 4173 --strictPort
```

`mkcert -install` may request Windows trust-store permission. The certificate includes the exact LAN IP as well as localhost names; regenerate it and restart preview if that IP changes. The existing prebuild hook packages local OCR assets. Keep the terminal running and use `https://192.168.1.42:4173` on the phone (substitute your chosen IP). On the PC, `https://localhost:4173` tests the same certificate. Both devices must share reachable Wi-Fi; guest-network client isolation or VPNs can block access. See [mkcert's usage and mobile guidance](https://github.com/FiloSottile/mkcert).

If Windows Firewall blocks access, allow Node on the **Private** network. Alternatively, in a separate Administrator PowerShell, add this narrowly scoped rule only for the local test:

```powershell
New-NetFirewallRule -DisplayName 'Biboo HTTPS preview (private LAN)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4173 -RemoteAddress LocalSubnet -Profile Private
```

For iPhone trust, obtain **only the public root CA** in another terminal:

```powershell
Set-Location C:\workspace\active-projects\biboo
$bibooCaRoot = (mkcert -CAROOT).Trim()
Copy-Item -LiteralPath (Join-Path $bibooCaRoot 'rootCA.pem') -Destination .certs\mkcert-rootCA.cer
```

Transfer `mkcert-rootCA.cer` to the test iPhone through a method that opens the certificate profile, such as a mail attachment or Safari download. Open it, then install it in **Settings → Profile Downloaded** (or **General → VPN & Device Management**). Next go to **Settings → General → About → Certificate Trust Settings** and enable **full trust** for the mkcert root. Installing the profile alone does not enable TLS trust. Reopen Safari and visit the HTTPS LAN URL without a certificate warning. [Apple's full-trust instructions](https://support.apple.com/en-us/102390).

Never transfer `rootCA-key.pem` or `biboo-key.pem`, put keys under `public/`, or commit them. `.certs/` and common certificate/key file extensions are ignored. This CA is for your own development devices; remove its profile/trust when no longer needed.

Manual checks:

1. On trusted HTTPS, create a book, import a page, save a correction and restore a backup. Confirm UUID creation works and real failures still receive the appropriate diagnostics. Wait for installation, reload under service-worker control, prepare the selected OCR language online, then test it offline as described in Milestone 4A.
2. At phone width, check that idle screens have no reserved loading gap or empty status margin. Slow navigation should still show the delayed loading indicator; initial entry keeps its immediate fallback. Buttons retain their existing touch sizing.
3. Stop HTTPS preview and clear both variables below to verify the HTTP localhost default. An HTTP LAN visit should show the secure-context explanation; attempted book/page creation must not show a misleading storage error. Setting only one TLS variable must stop preview. Use a disposable origin/profile for failure checks.
4. Changing scheme, host or port creates a **different origin** with a separate IndexedDB library, service worker and OCR cache. An empty HTTPS phone library does not mean the localhost/HTTP library was deleted. Transfer projects with `.biboo` export/restore; do not clear existing site data to fix origin differences.

Stop preview with Ctrl+C, then return to default HTTP in that terminal:

```powershell
Remove-Item Env:\BIBOO_HTTPS_CERT -ErrorAction SilentlyContinue
Remove-Item Env:\BIBOO_HTTPS_KEY -ErrorAction SilentlyContinue
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

If you added the firewall rule, remove it afterward in Administrator PowerShell:

```powershell
Remove-NetFirewallRule -DisplayName 'Biboo HTTPS preview (private LAN)'
```

## Source structure

- `src/app/`: MUI theme, PWA lifecycle, and fallback page.
- `src/App.tsx`: responsive navigation, shared layout, update prompt, and editing state.
- `src/features/books/`: book types, validation, language and dimension catalogues, repository, library, detail, and editor screens.
- `src/features/pages/`: page/asset types, transactional repository, browser image preparation, reactive page gallery, and image URL lifecycle.
- `src/features/correction/`: separately lazy-loaded correction editor, normalized-coordinate conventions, pure projective geometry/pixel sampling, worker, and transactional correction persistence.
- `src/features/backup/`: lazy backup screens, versioned manifest types/validation, pure serialization/remapping, consistent snapshots/atomic restores, and dynamically imported ZIP handling.
- `src/features/ocr/`: lazy OCR screen, read-only source selection, verified optional asset caching, bounded working-image preparation, disposable worker integration, and pure coordinate/text mapping.
- `scripts/prepare-ocr-assets.mjs`: deterministic packaging of the installed OCR worker, core and language files into ignored `public/ocr-assets/` output.
- `src/data/database.ts`: typed Dexie schema and database version.
- `src/main.tsx`: theme and React Router routes.
- `public/biboo.svg`: original book-mark icon and source for generated installation assets.
- `vite.config.ts`: manifest, generated assets, and application-shell caching policy.

Database access stays in the repository; components do not read or write Dexie tables directly. Routes are `/`, `/books/new`, and `/books/:bookId`. Unknown routes show a useful fallback. The data router supports unsaved-change navigation blocking, including browser Back. Native unload protection covers reloads and tab closure where supported by the browser.

## PWA architecture and offline behavior

The production build uses vite-plugin-pwa's `generateSW` strategy. The manifest identifies Biboo with tagline Bilingual Books, standalone display, root scope/start URL, warm background, and forest-green theme. Hosting assumes the origin root. Deploy `dist` over HTTPS; localhost is suitable for desktop development. Configure the host to rewrite application routes to `index.html`, and serve service-worker and manifest files with their correct content types. Serve `sw.js` and `index.html` with revalidation rather than long immutable caching; hashed assets can use immutable caching.

The existing asset generator consumes `public/biboo.svg` during build. Its `minimal-2023` preset generates 192/512-pixel application icons, a 512-pixel maskable icon, a 180-pixel Apple touch icon, and favicons. The plugin injects manifest icon entries and HTML icon links. Generated PNG/ICO assets are build products; they have not been generated or checked in during this implementation.

Workbox precaches only build-owned HTML, JavaScript, CSS, icons, and fonts. Navigation fallback serves the cached shell for library/book routes. There are no runtime caching rules, data endpoints, or service-worker caches of user book data or images. User metadata and image Blobs live exclusively in IndexedDB. Imported images are displayed through temporary object URLs, never uploaded or written into `public`/`dist`.

After a successful first online production visit finishes precaching, the shell and all implemented library actions work offline. A status message reports when the first offline cache is ready. Initial access requires connectivity, and an interrupted installation may leave offline support unavailable.

Updates use prompt mode with `skipWaiting` and `clientsClaim` disabled. A waiting worker produces an explicit **Update and reload** action. That action is disabled while there are unsaved changes or a save in progress. Only a tab that explicitly requests an update may reload itself through the PWA lifecycle; another tab activating a worker does not forcibly reload an editing session. Closing all tabs can naturally activate a waiting worker without an in-page reload. Updates are checked by the browser when registering on app startup; there is no background polling service.

## Lazy loading and code splitting (Milestone 1B)

The existing React Router data router uses `route.lazy` for `/books/new` and `/books/:bookId`. Both dynamically import the same `BookPage` module, so creation, details, editing, deletion dialogs, and form-specific MUI controls share one on-demand boundary. The creation route retains its key to preserve form-reset behavior. No router migration, manual chunk groups, warning-limit changes, or new dependencies are needed; Vite 8/Rolldown determines the output chunks automatically.

The shell, theme, PWA lifecycle, library/home screen, database/repository used by the library, loading/error screens, and small not-found screen remain eager. The shell imports no feature screen. Material components use supported component subpaths and icons already use individual subpaths; theme APIs use the supported `@mui/material/styles` entry. Avoid feature barrel files that re-export heavy modules into eager code.

Client navigation keeps the current screen visible while the next route module loads. A reserved status area displays a loading indicator only after 200 ms to avoid flicker on cached transitions. Direct entry into a lazy route immediately displays the shell and startup fallback through `hydrateFallbackElement`. Static route error elements remain available even when the lazy module fails, offering Library and an explicit Reload action. There is no automatic reload or retry loop. Existing form navigation guards and PWA update-consent behavior remain unchanged.

Expected benefit: editor-only code and its exclusive dependencies can move out of startup evaluation on the library route. This is not a measured size or speed improvement. React/React DOM, React Router, MUI/Emotion, and Dexie remain likely contributors to the eager graph, and the initial chunk may still exceed Vite's warning threshold. Inspect actual emitted entry/shared chunks before considering further splitting.

**Heavy features:** Correction and OCR use separate lazy feature routes and worker bundles. Keep future AI translation, intelligent sticker layout, and PDF generation similarly isolated. Load a feature's entry with `import()` from its action handler, or a new `route.lazy` boundary when it has its own route. Keep each engine's dependencies inside that module; never statically re-export them through the shell, library, or a shared barrel. No placeholder engines or loading framework are introduced.

**Offline contract:** Workbox precaches emitted current route, shared and application-worker chunks, including routes not yet visited. Lazy loading defers module evaluation/use; it does not remove those chunks from the initial offline installation download. Library/correction/backup operations work offline after the application cache is installed. OCR runtime binaries/models under `public/ocr-assets/` are excluded from precaching and prepared explicitly per language; see Milestone 4A below. A narrow same-origin CacheFirst rule serves only these packaged assets. User images/data are never service-worker-cached. Future optional resources still belong under the excluded `public/optional-resources/` directory and require their own deliberate download policy; do not bundle model contents into application JavaScript.

### Manual validation for Milestone 1B

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run lint
npm run build
Get-ChildItem .\dist\assets\*.js | Select-Object Name,Length
Select-String -Path .\dist\sw.js -Pattern 'BookPage|assets/|optional-resources'
npm run preview -- --host 127.0.0.1 --port 4173
```

1. Record Vite's entry/shared/route chunk sizes and compare with the previous approximately 679 KB minified / 214 KB gzip entry. Account for all startup shared chunks rather than comparing a single file. Confirm an emitted book-route chunk and a dynamic import in the entry graph. Chunk names and exact factoring are bundler-dependent.
2. In a fresh browser profile at `http://127.0.0.1:4173`, use Network's Initiator column to distinguish application module loads from service-worker precache requests. The worker intentionally downloads lazy chunks during installation; those requests alone do not indicate eager application imports. For a clearer view of the application graph, temporarily use Service Workers > Bypass for network and reload `/`. Open Create book and verify the route import occurs then. Throttle the network to observe the delayed indicator and preserved shell. Restore the normal worker setting afterward.
3. Test direct loads of `/books/new` and a saved `/books/:bookId`, creation defaults, edit/save/cancel, unsaved navigation/Back, delete confirmation, unknown books, and unknown routes. Navigate between detail and creation to confirm form state resets.
4. In that disposable profile, enable service-worker Bypass for network, disable the HTTP cache, and block the emitted book-route chunk URL with DevTools Request blocking. Reload `/`, then open Create book. Confirm a readable error inside the shell and a working Back to library action. Unblock the URL and use the explicit Reload action to recover; failed module fetches may remain cached for the life of the document. Turn off request blocking/bypass before offline checks.
5. Using the normal worker, wait for offline readiness and reload once for control. Inspect `sw.js`/Cache Storage to confirm the book-route and all referenced shared chunks are precached. Before visiting Create book in that document, switch DevTools to Offline. Create, save, edit, and delete books, and reload both direct book URLs and `/books/new` while offline. Saved metadata must persist. An interrupted first installation is not an offline-ready state.
6. Repeat the existing two-tab update test below, including an unsaved editor. New split chunks must not bypass update consent. Do not clear IndexedDB or site storage belonging to your real library while testing.

## Local persistence

The `biboo` IndexedDB database is schema version 3. The unchanged version 1 and 2 declarations preserve all existing books, pages, originals, and thumbnails; version 3 adds separate correction stores without rewriting old records. The `books` store uses UUID `id` as primary key and indexes `updatedAt` for newest-first listing. Each book stores:

- `id`, `title`, `sourceLanguage`, `targetLanguage`
- `widthMm`, `heightMm`
- ISO `createdAt` and `updatedAt` timestamps

Creates use `crypto.randomUUID()` and canonical BCP 47 language tags. Edits preserve IDs and creation dates and update the modification timestamp inside a transaction. Future schema changes must add Dexie versions and migration logic rather than rewriting version 1.

Defaults are Dutch (Netherlands), `nl-NL`, and Portuguese (Portugal), `pt-PT`. A small language catalogue can be extended without schema changes. Titles are required and limited to 200 characters; each dimension must be a finite value from 1 to 2,000 mm, including decimal measurements. Presets include A5, A4, small and standard square books, and a landscape picture book. Measurements always describe one page. Width and height can be swapped or entered directly.

Records survive reloads and application updates on the same origin and browser profile. Browser storage can still be evicted; clearing site data, uninstall behavior, private browsing, or changing browser/origin can remove or isolate the library. Milestone 3 provides portable `.biboo` backups; download and retain them outside browser storage. Storage failures are surfaced in the UI; failed saves retain the form values for retry. Forms save only after explicit submission. Delete requires confirmation.

## Page capture and local storage (Milestone 2A)

Open an existing book's **Pages** section. **Import pages** opens a multiple-file image picker. **Take a photo** uses a standard single-file input with `accept="image/*"` and `capture="environment"`. Browsers decide whether to offer the rear camera, a picker, or a choice; Import pages is always available as the regular-picker fallback. There is no camera stream or custom camera interface. Choose Cover, Interior (default), or Back cover before importing; that role applies to the next selected batch.

Images append in file-selection order, not filename order. The gallery shows the current page count and reading-order numbers, thumbnails, page type, pixel dimensions, a dedicated Reorder handle, Move earlier / Move later controls, and Delete page. Open a thumbnail to view the original at a larger size. Page deletion requires confirmation and closes gaps in the remaining reading order. UUID identity remains unchanged when reordering. Deleting a book explicitly confirms removal of all pages and images too. Book timestamps describe edits to book metadata; adding/reordering pages does not rewrite those timestamps.

### Page gallery layout and sorting (Milestone 2A.1)

The global `MuiCardActionArea` height of `100%` could consume a page card's available height and push its sibling metadata/actions into the clipped area. That theme override is removed. Only library cards, whose entire contents are a single action area, retain a locally scoped full-height action. Page cards use a column layout with a natural-height thumbnail action, a compact 160-pixel image area, and separate content/actions. The page number, type, dimensions, and controls no longer compete with a full-height thumbnail button.

- **Mouse:** Drag the Reorder handle at least 8 pixels to begin. Move over the desired card, including cards in other grid rows, and release.
- **Touch:** Hold the Reorder handle for 250 ms, then drag. Moving more than 8 pixels before activation cancels that attempt. Only the handle has `touch-action: none`; scroll normally from elsewhere on the card or page. The regular thumbnail remains a viewing action, not a drag activator.
- **Keyboard:** Tab to a Reorder handle, press Space or Enter to pick up, use arrow keys to move spatially across the grid, then Space or Enter to drop. Escape cancels. Screen-reader instructions and announcements describe pickup, target positions, drop, and cancellation.
- **Alternatives:** Move earlier / Move later remain available, including on mobile. Boundary moves are disabled. A single-page gallery does not enable dragging.

The existing dnd-kit packages provide MouseSensor, TouchSensor, KeyboardSensor with `sortableKeyboardCoordinates`, `rectSortingStrategy`, and closest-center collision detection. The dragged card receives an outline, elevation, and reduced opacity; the current target has a contrasting outline/background. No drag overlay or full-resolution preview is created: the mounted thumbnail moves, keeping its existing object URL. Native image dragging is disabled. Thumbnail viewing, moving, and deletion are unavailable during a drag, with brief trailing-click suppression on release so dropping over a control cannot trigger it accidentally.

`pageRepository.reorder(bookId, pageIds)` requires exactly the complete current page-ID set for that book. It copies the request, verifies the parent, rejects duplicates, missing/foreign IDs, omitted pages, and a list made stale by concurrent additions/deletions, then writes one-based reading order for the entire result in a single transaction. Other metadata, stable IDs, roles, and both asset stores remain untouched. The existing adjacent-move operation remains available. There is no schema migration for Milestone 2A.1.

During a drag, dnd-kit shows a positional preview. After dropping, the gallery continues to derive its order from the Dexie live query rather than installing an optimistic list. Saving feedback is displayed and other page operations are disabled until the write settles. Failure displays an error and refreshes metadata from storage; no uncommitted order is retained. Depending on storage speed, cards can briefly return to their prior positions before the committed order arrives. Concurrent reorder-only requests use the last committed ordering; a changed page membership is rejected. Canceling a drag makes no database write.

All sorting code is imported by `PagesSection` under the existing lazy book route. The library/shell do not import dnd-kit. Existing application-chunk precaching and image object-URL cleanup remain unchanged; no user image is service-worker-cached.

### Manual verification for Milestone 2A.1

No validation commands were executed during implementation. Run:

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run lint
npm run build
Get-ChildItem .\dist\assets\*.js | Select-Object Name,Length
npm run preview -- --host 127.0.0.1 --port 4173
```

At `http://127.0.0.1:4173`:

1. Use a disposable book with at least seven pages. At phone and desktop widths, confirm every card shows its thumbnail, page number, type, pixel dimensions, Reorder handle, both move buttons, and Delete page. Check portrait, landscape, missing-thumbnail, and one-page cases. Library cards must remain fully clickable.
2. Drag by mouse within a row and across rows; try first-to-last and last-to-first. Verify active/target feedback, saved confirmation, page numbering, and persistence after reload. A click or movement below the activation distance on a handle must not start sorting or open a viewer.
3. On a real phone, hold and drag the handle across rows and near the viewport edge. Check normal scrolling outside handles, quick taps/canceled holds, and that releasing over an image or delete button does not open a viewer or delete dialog. Separately verify ordinary thumbnail taps and delete confirmation still work.
4. With a keyboard, use Space and Enter pickup/drop, arrow keys in both grid directions, and Escape cancellation. Verify focus and screen-reader announcements, then verify Move earlier / Move later. Canceled/no-position-change drags must not alter stored reading order.
5. Inspect IndexedDB: page IDs, filenames, roles, dimensions, timestamps, and original/thumbnail records must remain unchanged except for metadata `readingOrder`. Repeated drags must not load originals or refetch thumbnail assets merely because their indices changed.
6. Exercise a failed/stale reorder in a disposable profile (for example, remove or add a page in another tab during a pending request). The transaction must reject a stale membership set and show an error with the actual persisted gallery order. A transaction failure must not leave partially updated numbering.
7. For explicit repository rejection checks, run `npm run dev` separately and use its printed URL. In that app's DevTools console, import `const { pageRepository } = await import('/src/features/pages/pageRepository.ts')`; obtain a disposable book ID and its current IDs with `await pageRepository.list(bookId)`. Call `reorder` with duplicate IDs, an omitted ID, a nonexistent ID, and an ID from another book, each in an otherwise full list. Each promise must reject without any writes. Re-read `list(bookId)` after each attempt. Use real IDs and a disposable library only.
8. In the production preview with the normal worker, wait for offline readiness, reload for worker control, switch Offline, and repeat sorting, reload persistence, viewing, and deletion. Confirm the book module remains a dynamic import and no image appears in Cache Storage. Existing PWA update/navigation protection should remain active during a drag or save.

### Version 2 stores

| Store | Primary key | Indexes | Contents |
| --- | --- | --- | --- |
| `books` (unchanged) | `id` | `updatedAt` | Existing book metadata |
| `pages` | `id` | `bookId`, `[bookId+readingOrder]` | Parent book ID, one-based order, optional original filename, ISO creation timestamp, decoded original pixel dimensions, MIME type, optional role |
| `pageOriginals` | `pageId` | `bookId` | Parent book ID and original image Blob |
| `pageThumbnails` | `pageId` | `bookId` | Parent book ID and thumbnail Blob |

Original images are preserved byte-for-byte as Blobs, with no resizing, compression, base64 encoding, or EXIF stripping. Pixel dimensions are those reported by the browser decoder, which may apply EXIF orientation; encoded-file coordinate interpretation belongs to future geometric processing. Thumbnail generation draws the decoded image to a browser canvas with a maximum 480-pixel longest edge (never upscaling), a white transparency background, and JPEG quality 0.8. The original retains its original format, transparency, and metadata. Animated formats produce a single rendered thumbnail frame.

Decode and thumbnail creation happen outside transactions. Each append atomically saves metadata, original, and thumbnail, checks that the parent still exists, and allocates its order inside a transaction. Move earlier/later swaps adjacent orders transactionally; drag sorting validates and writes the complete order in one transaction. Page deletion atomically removes both assets and metadata and compacts order. Book deletion atomically removes the book and every matching page/original/thumbnail using indexed book-ID queries. Concurrent append/reorder/delete operations are serialized by IndexedDB transactions; there is no general conflict-resolution UI.

### Performance, offline operation, and failures

Page UI and processing are imported only by the existing lazy book route. The eagerly loaded library/database schema references page types only; it does not import the page-management UI or image processor. No dependencies or PWA cache rules were added for this milestone. The existing precache covers the emitted lazy code, so page import, viewing, ordering, and deletion can work offline after a successful application installation. The images themselves remain in IndexedDB and are never service-worker-cached.

The gallery uses the existing Dexie React hooks dependency to observe ordered metadata. Each stable thumbnail component reads only its small thumbnail asset on mount, rather than refetching originals or rereading thumbnails on every reorder/progress update. An original is read only when its viewer opens. Object URLs are revoked on component cleanup; import decode URLs and canvases are also released. Thumbnails are read for mounted cards, so exceptionally large libraries may eventually benefit from gallery virtualization.

Imports decode and save sequentially to limit working memory. There is a 50 MiB per-file and 60 megapixel decoded-image limit. JPEG, PNG, and other raster formats are accepted when the browser can decode them. Empty, non-image, SVG, corrupt, oversized, and unsupported images receive useful errors. Empty file MIME types use a known-image filename-extension fallback, followed by actual decoding. HEIC/HEIF, TIFF, and other format support varies: export to JPEG or PNG when decoding fails. Full-resolution decoding still depends on device memory and browser limits.

Progress reports files processed and pages saved. Invalid images fail independently and later files continue. Database/quota failures stop the remaining batch; earlier committed pages remain saved and the current failed transaction leaves no partial assets. **Stop import** stops between images (an in-flight decode/save must settle); reports distinguish saved, failed, and not-imported files. Retry only failed/skipped files to avoid duplicates. There is no duplicate detection or resumable import queue.

While saving/importing, book edits/deletion and other page mutations are disabled. Router navigation waits for the operation to finish; tab close/reload uses native unload protection where available. PWA updating is disabled during these operations as well. An abrupt browser/process shutdown can abort the current page transaction, but cannot roll back earlier successful imports. Mobile unload protection is best-effort.

Where supported, `navigator.storage.estimate()` displays approximate site usage/quota and warns below 50 MiB estimated headroom or when selected originals appear to exceed headroom. Estimates are advisory and shared with other storage for this origin; actual quota errors still govern each transaction. There is no permanent-storage guarantee, persistence permission request, or cloud copy. Keep source photos and downloaded `.biboo` backups elsewhere.

### Manual verification for Milestone 2A

Run these commands yourself from PowerShell (none were executed for this change):

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run lint
npm run build
Get-ChildItem .\dist\assets\*.js | Select-Object Name,Length
Select-String -Path .\dist\sw.js -Pattern 'BookPage|assets/|optional-resources'
npm run preview -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173` and verify:

1. **Migration:** Before upgrading, retain a version 1 book on this exact origin/browser profile. Close older Biboo tabs and open the new build. Confirm its ID, languages, dimensions, and timestamps survive and it initially has zero pages. Inspect IndexedDB stores/indexes; Dexie may encode its logical schema version differently in the browser's native database version display. Use a disposable profile for destructive/error scenarios, not your real library.
2. **Import:** Import multiple JPEG/PNG images with different orientations and filenames. Confirm selection order, count, pixel dimensions, MIME type, role, progress, thumbnails, and larger viewing. Reload the book and reopen the installed app. Compare the stored original Blob byte length/content with the source file via browser developer tools if validating byte preservation.
3. **Camera:** On a real phone using an HTTPS deployment, try Take a photo (rear-camera hint). Also verify Import pages as the fallback and cancel/reselect the same file. Desktop localhost testing does not validate a phone camera chooser.
4. **Validation/partial failures:** Select a valid image, a corrupt `.jpg`, and another valid image. The valid pages should persist in order and the corrupt one should be reported. Try a renamed non-image, an empty file, SVG, HEIC/HEIF on a browser without support, a file over 50 MiB, and an image above 60 megapixels. Inspect memory responsiveness on target phones; don't use production libraries for stress tests.
5. **Management:** Move first/middle/last pages using keyboard and touch. Boundary buttons should be disabled; numbers should follow reading order while IDs and asset links stay fixed. Cancel and confirm a page delete; verify remaining order is contiguous and both associated assets disappear. Try Cover and Back cover imports. Check narrow-screen layout and accessible control names.
6. **Atomic/cascade behavior:** In a disposable profile, simulate quota exhaustion using browser tooling if supported, or an intentionally limited-storage environment. Confirm a failed append leaves neither lone metadata nor orphan assets; previously imported pages remain and remaining files are reported as not imported. If the browser offers no safe quota simulation, record that case as unverified. Delete a multi-page book and confirm no matching records remain in any of the seven stores, including derived correction data. Another book's records must remain untouched.
7. **Offline/lazy loading:** Wait for successful precaching and reload once under worker control. Switch to Offline before first opening a book route in that document. Import local files, view originals, reorder, delete, and reload/direct-load the book route. Confirm persistence. Cache Storage may contain application assets and explicitly prepared OCR runtime/models; user image Blobs belong only in IndexedDB. Network Initiator should distinguish service-worker chunk precaching from application imports; processing/UI code must remain outside the eager library graph.
8. **Lifecycle/protection:** Open/close larger views and reorder repeatedly; check that thumbnail assets aren't refetched on every reorder and that object URLs are revoked when views/cards unmount. During a multi-image import, try Library/Back, edit/delete book, and a PWA update. Verify guards, Stop import, and the final saved/failed/skipped report. Do not enable developer-tool forced worker activation when checking update consent.
9. **Storage caveat:** Confirm approximate usage appears where supported, unavailable estimates degrade cleanly, and low-space warnings do not promise permanent storage. Clearing site storage in a disposable profile should remove books and images; there is no recovery/export yet.

## Non-destructive page correction (Milestone 2B)

Choose **Correct page** on a gallery card or in the original-photograph viewing dialog. This opens the separate lazy route `/books/:bookId/pages/:pageId/correct`. It loads only that page's original and saved settings. Existing uncorrected pages need no migration work and still show their original thumbnails.

Drag the four 44-pixel handles to the paper corners. TL/TR/BR/BL mean Top-left/Top-right/Bottom-right/Bottom-left of the intended corrected page. Handles support mouse/touch Pointer Events, pointer capture, and keyboard arrow adjustments (0.5% steps, or 0.1% with Shift). Only handles disable touch scrolling; the rest of the editor/page can scroll normally. Rotate left/right in 90-degree steps, adjust corners, then choose **Preview correction**. The corrected result and actual output dimensions appear before **Save correction** becomes available. Changing any point or rotation invalidates that preview.

Reopening restores the saved selection/rotation and always regenerates from the original image. **Reset selection** restores the full unrotated photo as an unsaved draft; preview/save to apply it. **Use original / remove correction** instead confirms atomic deletion of the persisted settings and both derived images, returning the gallery to the imported thumbnail. Cancel does not alter saved data. Selection changes, unsaved previews, and processing/saving protect router navigation, browser unload where supported, and PWA update activation. Stop processing cancels a preview; saving must finish before leaving.

The gallery prefers the corrected thumbnail and labels corrected pages. Clicking a thumbnail still opens the explicitly labeled **original photograph**, keeping the original accessible at all times. Sorting, IDs, roles, import order, and original dimensions remain unchanged. Metadata live queries join correction revision IDs without loading image Blobs. A thumbnail is reread when its correction revision changes; ordinary reordering retains its existing URL and does not fetch originals.

### Version 3 storage and concurrency

| New store | Primary key | Index | Contents |
| --- | --- | --- | --- |
| `pageCorrections` | `pageId` | `bookId` | Four normalized source corners, rotation, decoded source pixel dimensions, actual target pixel dimensions, physical width/height used, ISO update timestamp, UUID revision |
| `pageCorrectedImages` | `pageId` | `bookId` | Derived JPEG Blob and matching correction revision |
| `pageCorrectedThumbnails` | `pageId` | `bookId` | Derived thumbnail JPEG Blob and matching revision |

Settings, corrected image, and corrected thumbnail are saved in one transaction after processing/encoding finishes. Neither `pageOriginals` nor imported thumbnails are written by correction code. Quota, processing, or revision failures preserve the entire prior correction. Saving checks that the parent/page/original still exist, that physical book dimensions have not changed, and that the loaded correction revision is still current. Concurrent edits/removals in another tab are rejected instead of silently overwriting them. Reopen the editor after such a conflict or after physical dimensions change. Existing corrections are not automatically regenerated when a book's size changes; the editor warns and uses the current book ratio for its next preview.

Page deletion and book deletion include all derived stores in their existing cascade transactions. Removing a correction also validates its loaded revision. Close older Biboo tabs when upgrading the database schema. Portable backups are available in Milestone 3; browser storage still has no permanence guarantee.

### Projective geometry and coordinate conventions

`geometry.ts` contains pure functions with no React, DOM, IndexedDB, or worker dependencies. A correction is a four-point projective rectification, not CSS projection or rectangular cropping. Coordinates use x rightward, y downward, normalized to `[0,1]` in the browser-decoded original photo. Corner-array indices always correspond to destination TL, TR, BR, BL. Positive cross products represent clockwise winding in this coordinate system.

For clockwise display rotation, original `(x,y)` maps to `(1-y,x)`; counterclockwise maps to `(y,1-x)`. Drag positions are converted back through the inverse display rotation before storage. A clockwise step cycles correspondence to `[old BL, old TL, old TR, old BR]`; a counterclockwise step uses `[old TR, old BR, old BL, old TL]`. The pixel engine uses that correspondence directly, so it does not apply rotation a second time.

The engine solves eight homography parameters with partial-pivot Gaussian elimination, fixing the inverse map's `h33` to 1. It solves from the unit destination rectangle to the four source points, whose destination origin maps to a finite source corner. Matrix inversion supplies the corresponding source-to-destination map. Solving in this direction avoids assuming the forward map must be normalizable at the original photo's origin. Each output pixel is inverse-mapped to the source, then bilinearly interpolated from four neighboring pixels. Pixel indices span `0..width-1` and `0..height-1`. Alpha is interpolated in premultiplied form and composited onto white; derived output is JPEG. This is encoded-color-space interpolation, not linear-light color reconstruction.

Validation rejects nonfinite/out-of-bounds coordinates, reversed winding, concave/self-intersecting selections, normalized edges shorter than 0.01, cross products below 0.0001, and areas below 0.005 of the full photo. Singular/unstable systems, near-zero projective denominators, and mappings outside the source also fail without writes. These deliberate thresholds reject very small crops/extreme perspectives rather than producing misleading results.

Output matches the book's physical width-to-height ratio to integer-pixel rounding, with a longest edge of 2400 pixels and a minimum of two pixels per axis. Extremely narrow physical ratios that cannot meet those limits are rejected. The actual pixel size and physical dimensions used are stored. Paper curvature, lens distortion, motion blur, missing image detail, and incorrect physical dimensions cannot be corrected by a planar homography and may still distort results. There is no automatic corner detection.

### Memory, performance, and browser limitations

Only the dedicated correction route imports its editor/processing engine. Native canvas decoding/resampling creates a working source of at most 3000 pixels on its longest edge. The sampling worker receives that pixel buffer by transfer and returns a transferred result; it is terminated on completion, failure, cancellation, or editor unmount. No per-pixel object/array allocations are made in the sampling loop. When workers are unavailable or construction fails, a native main-thread fallback processes 16 rows at a time and yields between batches. Asynchronous worker load/runtime failures are reported rather than silently changing processing paths after the source buffer has been transferred.

A square working buffer can occupy about 36 MB and a square output about 23 MB before canvas/encoding/display overhead. The original browser decoder may additionally retain up to roughly 240 MB for a 60-megapixel import, and canvas operations can have transient copies. These bounds do not guarantee success on memory-constrained phones. The editor rejects decoded originals above 60 megapixels; source decoding, canvas readback, and encoding may still briefly block the UI or fail on individual devices. Stop processing terminates worker sampling; native decode/readback/encoding steps must settle before cancellation is observed. Preview can enlarge a low-resolution crop but cannot restore lost detail.

Canvases are cleared, worker buffers are released on termination, original/preview object URLs are revoked, and decoded original references are released when the editor closes. Browsers may retain internal image caches until memory pressure. The normal gallery never decodes all originals, and drag previews still reuse thumbnails.

Compatibility depends on native `Image.decode`, Canvas/ImageData/JPEG encoding, SVG image display, Pointer Events/pointer capture, CSS aspect-ratio, transferable ArrayBuffers, and (preferably) module Web Workers. HEIC/HEIF and other decoding support remains browser-dependent. Browser EXIF orientation/color handling can vary. If decoded dimensions differ from the saved settings, the editor explicitly starts a fresh selection while preserving the saved correction until an explicit save/removal. JPEG derivatives do not retain original metadata, transparency, or guaranteed original color profiles; the untouched original does.

Workbox still precaches only application assets. Its existing JavaScript glob includes the correction route and emitted worker bundle; navigation fallback now also permits direct correction-route loads. Corrections, previews, originals, and thumbnails are never service-worker-cached or uploaded. All correction features can work offline after the complete application cache is installed, including when this editor has not previously been visited. A failed/incomplete first installation is not an offline-ready state.

### Manual verification for Milestone 2B

No builds, lint, tests, browser validation, or mathematical test execution were performed for this milestone. Run manually:

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run lint
npm run build
Get-ChildItem .\dist\assets\*.js | Select-Object Name,Length
Select-String -Path .\dist\sw.js -Pattern 'CorrectionPage|correction.worker|assets/'
npm run preview -- --host 127.0.0.1 --port 4173
```

1. **Migration/non-destruction:** Upgrade a profile containing version 1 books and version 2 pages. Confirm all old data, filenames, IDs, roles, timestamps, order, original Blobs, and imported thumbnails survive. Inspect the three new stores. Compare original bytes/hashes before and after preview/save/edit/reset/remove. Use a disposable library for destructive/failure checks.
2. **Editor:** Correct a photographed rectangular grid/book page from an oblique angle. Try all four handles on desktop and a real phone, keyboard steps, scrolling outside handles, and viewport resizing. Check visible labels and stored normalized points; resizing the UI must not change them.
3. **Rotation/ratio:** Check 0/90/180/270 degrees, repeated clockwise/counterclockwise steps, and rotation after arbitrary corner adjustments. The preview must rotate once with consistent labels and no mirroring. Test square, portrait, landscape, and custom physical dimensions; verify output ratio within pixel rounding and longest edge 2400. Incorrect dimensions should visibly distort geometry, not be silently ignored.
4. **Preview/save:** Preview must be visible before saving. Change a corner after preview and confirm Save becomes unavailable until regeneration. Save, reload/reopen, adjust again, and confirm regeneration uses original data. Reset selection and Cancel should retain the saved correction; confirmed Use original should remove all three derived records while preserving imported assets.
5. **Failures/concurrency:** Test a missing original, unsupported browser format, invalid points, failed worker load (block its script in a disposable profile), and safely simulated quota errors if supported. Prior settings/images/thumbnails must remain intact. Save from two editor tabs and check the second rejects a stale revision. Change physical dimensions in another tab and check stale saving is rejected. Unverifiable quota/device cases should be recorded as unverified.
6. **Lifecycle:** Navigate Back/Library or reload with adjusted points and with an unsaved preview. Verify discard protection, Stop processing, blocked navigation while saving, and disabled PWA updating. Check cancellation during sampling and repeated preview/close cycles for released URLs/workers and bounded memory growth. Native unload prompts remain best-effort on mobile.
7. **Gallery/cascades:** Confirm corrected thumbnails/indicators update, original viewing remains available, and drag/keyboard/button reordering does not load originals or refetch unchanged thumbnails. Delete a corrected page/book and confirm all associated records across seven stores are removed atomically; another book must remain untouched.
8. **Offline/lazy:** Let the production worker finish installation, reload under its control, and switch Offline before first opening a correction route. Direct-load/reload that route, generate/save a correction, return to the gallery, and remove it offline. Verify route and worker chunks are cached application assets while user images remain exclusively in IndexedDB. Restore normal worker settings after any request-blocking checks.

**Geometry aspects that particularly need testing:** In the development app (`npm run dev`), pure helpers can be imported from `/src/features/correction/geometry.ts` and coordinate helpers from `/src/features/correction/correction.ts` in DevTools or a future test harness. Verify identity and forward/inverse corner residuals for rectangles and skewed convex quads; all four rotations and display/inverse-display round trips; bow-tie/concave/reversed/collinear/near-collapse rejection; matrix pivot/singularity and projective-denominator boundaries; and pixel-edge clamping. A 2×2 opaque source should remain identical under full-rectangle 2×2 sampling. With TL red, TR green, BR blue, BL white, a 3×3 full-rectangle output's center should bilinearly average to approximately `(128,128,128)`. Verify the clockwise result starts with original BL at output TL, transparency has no dark fringes, output ratio rounding is correct, and worker/fallback sampling agrees. Also inspect a photographed calibration grid: a planar selection should yield straight rectangular edges, while curvature should remain visibly uncorrected. These are required manual/future test targets, not claims of verified numerical accuracy.

## Portable book backup and restore (Milestone 3)

From an existing book, choose **Export book**, then **Create .biboo backup**. The read-only snapshot includes the complete book, ordered pages, original images, imported thumbnails, correction settings, and both derived image types. After packaging finishes, tap **Download .biboo file**. This explicit tap supports mobile browser download/share behavior better than an automatic download after a long asynchronous operation. Check the browser's Downloads/Files location; Biboo cannot confirm that the file was actually saved. The generated in-memory download is released when this screen closes or another export starts.

In the library, choose **Import Biboo backup**, select a `.biboo` file, and choose **Restore as a separate book**. Restore preserves the title and relevant metadata, so two separate library entries can have the same title. Use **Open restored book** to identify the new copy. Each restore gives the book/pages fresh IDs and correction settings/assets a fresh matching revision. Repeating restore deliberately creates another independent copy; it never merges with, replaces, or clears an existing book.

**Archives contain original book images, may contain camera/EXIF metadata, and are not encrypted.** Store/share downloaded files accordingly. Everything is processed on-device without network services or image re-encoding. There is no background synchronization or automatic backup.

### Format, validation, and transactions

The format is a ZIP with `manifest.json`, identifier `biboo-book`, archive version `1`, complete book/page metadata, and explicit image references under `pages/<page-id>/{original,thumbnail,corrected,corrected-thumbnail}`. Correction entries are present only as a complete settings/image/thumbnail triple. MIME types and byte lengths are preserved explicitly; photographs are stored unchanged with ZIP STORE and never base64-embedded. Archive version 1 is independent of the existing Dexie schema version 3; no database upgrade is introduced.

See [the version 1 archive specification](docs/biboo-archive-v1.md) for a full manifest example, fields, coordinate conventions, paths, limits, and restore mapping rules.

Export reads all seven stores in a single read-only IndexedDB transaction, then validates relationships/assets and creates the ZIP outside that transaction. A concurrent edit cannot create a mixture of record versions in the snapshot. Missing or orphaned local assets stop export rather than silently dropping part of the project. The saved project is unchanged.

Import validates manifest shape/version, UUID uniqueness, language tags, timestamps, dimensions, ordered page ownership, correction geometry and revisions, canonical paths, exact referenced entry membership, MIME metadata, byte lengths, CRC checksums, strict local/central ZIP structure agreement, and actual stream output limits. It rejects missing/extra/duplicate files, directory/link/executable/special/encrypted entries, unsafe or ambiguous paths, unsupported compression, malformed metadata, truncated streams, and decompression/checksum failures. Image internals are not decoded during validation: receiving browsers can retain originals they cannot display (for example HEIC on a browser without HEIC support).

Only after validation and extraction succeed does one transaction `add`/`bulkAdd` the remapped project into all seven existing stores. Failure rolls back the whole addition. There are no temporary partially imported records. Cancel is available before the final database write; once committing, wait until it finishes. Native unload protection and router/PWA-update guards protect active operations where supported. An abrupt browser shutdown can leave either the entire restored book or none, never an intentionally partial restore; inspect the library before retrying if completion was not reported.

### Memory, offline behavior, and limitations

The already installed `@zip.js/zip.js` dependency is imported dynamically only when an operation starts, within the separate lazy backup feature. Its native/JS codec entry is configured without ZIP web workers or an external WASM download. Blob readers/writers and bounded writable streams process one asset at a time, with no bitmap decoding or full-project `ArrayBuffer`. Existing Workbox JavaScript precaching includes emitted backup/ZIP chunks. Direct `/backup/import` and `/books/:bookId/backup` routes have application-shell fallback. Downloads/archives and imported images are never service-worker-cached.

This is **not** constant-memory or direct-to-disk streaming: export retains the snapshot's Blob references and final ZIP Blob, and restore collects validated image Blobs before the atomic write. ZIP buffers, per-entry chunk copies, Blob backing storage, IndexedDB cloning, and browser download handling can substantially exceed the project size. Current safeguards are 500 pages, 2001 entries, 2 MiB manifest, 64 MiB per image, 256 MiB total expanded data, and 300 MiB archive file size. These are caps, not a guarantee of success on mobile. A native read/snapshot or ZIP finalization step may take time to settle after cancel. Very large books require a future streaming/staging design or smaller separately managed projects; automatic archive splitting is not implemented.

Modern browser Blob/Web Streams, typed arrays, UTF-8 decoding, and local download support are required. Native compression streams are preferred with zip.js's JS codec fallback; only ZIP methods STORE/DEFLATE are accepted. iOS/Safari may open a share/save sheet or limit large Blob downloads; use its Files/Downloads UI and verify the file was retained. Image/EXIF decoding limitations remain those of the existing viewer/editor. Byte/MIME/CRC validation does not prove a correctly checksummed image is internally decodable, nor provide cryptographic authenticity. Device/browser memory exhaustion may terminate a tab without a recoverable error. Keep original photos and backups safely outside the browser.

### Recovery and manual verification

If restore fails, keep the original `.biboo` file and existing library. Free site/device space if quota is reported, close other heavy tabs if memory is tight, and retry. An invalid or unsupported archive is not partially restored; do not clear site data to fix it. If the file is damaged, re-export from the source device when available. There is no automatic archive repair. You can inspect a copy with a trusted local ZIP tool, but manually repacking files can introduce unsupported paths/directory entries or invalidate metadata. If a browser closed during the final write, check for the complete new book before restoring again to avoid creating another copy. Never delete the source book until the downloaded archive has been restored and checked.

No build, lint, tests, or browser verification were run for Milestone 3. Run manually:

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run lint
npm run build
Get-ChildItem .\dist\assets\*.js | Select-Object Name,Length
Select-String -Path .\dist\sw.js -Pattern 'BackupPage|archive|assets/'
npm run preview -- --host 127.0.0.1 --port 4173
```

1. **Primary acceptance:** Create a book with multiple originals, several corrected pages (including rotation), and reordered pages. Export/download it, restore it as a separate book, refresh, and inspect both entries. Confirm all images, imported/corrected thumbnails, roles, dimensions, filenames, languages, timestamps, corner coordinates, rotation, and reading order survive. Verify the restored correction can reopen/re-preview from its restored original. IDs must differ and every derived revision must match its new settings revision. Export must not modify the source book.
2. **Bytes and independence:** In a disposable profile inspect all seven stores and compare source/restored Blob MIME types, byte lengths, and SHA-256 hashes (read one Blob at a time with developer tools if computing hashes). Revisions should differ; image hashes must not. Edit/delete a restored page/correction and verify the source remains unchanged. Restore the same archive again and confirm it creates another copy.
3. **Offline/another device:** Let the production PWA finish precaching, reload under worker control, then switch Offline before first visiting backup routes. Export, download, restore, refresh, direct-load both backup routes, and view/edit restored pages offline. Transfer the file manually to another device with Biboo already installed and cached; restore with networking disabled. Cache Storage may contain application chunks and prepared OCR assets; user images remain in IndexedDB.
4. **Manifest/path failures:** On copies in a disposable profile, try unsupported format/version, invalid JSON, duplicate IDs/revisions, nonconsecutive order, foreign book/page relationships, invalid corners/dimensions, missing images or correction halves, incorrect lengths/MIMEs, extra entries, traversal/absolute/backslash paths, raw-name aliases, duplicate ZIP names, directory/symlink/special/encrypted entries, and unsupported compression. Each must fail before any book is added. Existing books/store counts must remain unchanged.
5. **Corruption/limits:** Try truncated ZIPs, modified entry bytes (CRC mismatch), inconsistent headers, overlapping entries, excessive page/entry counts, over-limit declared sizes, and decompressed output larger than declared/allowed. Use trusted fixtures and a disposable profile; do not stress your real library. Confirm no partial restored records remain.
6. **Storage/cancel/downloads:** Where safely supported, simulate quota failure during the final write and confirm all seven-store additions roll back. Cancel extraction/export and try navigation, reload, and a PWA update while busy. The final write disables cancel. Verify keyboard access, progress/error/success announcements, phone layout, and iOS/desktop download behavior. Cancellation and quota cases that cannot safely be exercised should remain recorded as unverified.
7. **Edge cases/lazy boundary:** Export/restore an empty book, an uncorrected book, unknown but valid language tags, original formats the receiving browser cannot decode, and a correction whose saved physical dimensions differ from the current book. Existing warnings/thumbnail fallback behavior should remain meaningful. Inspect the emitted dependency graph/Network initiators to confirm ZIP is dynamically imported; distinguish service-worker precaching from eager module execution.

## Local OCR proof of concept (Milestone 4A)

Choose **Recognize text** on a page card. `/books/:bookId/pages/:pageId/ocr` is a separate `route.lazy` screen. It reads a coherent snapshot of the book/page and prefers the saved corrected image with its matching revision; otherwise it uses the original. Missing/inconsistent corrected assets raise an error instead of silently changing sources. Neither image is overwritten. Reopen the screen to use changes made in another tab.

The default model is Dutch (`nl-NL` → `nld`) or Portuguese (`pt-PT` → `por`), including other locales of those same languages. Other source languages display an unsupported-language warning and require an explicit Dutch/Portuguese choice. Switching language clears the prior result. There is no automatic language detection or combined-model loading.

### Packaging and offline preparation

`scripts/prepare-ocr-assets.mjs` reads only an explicit list from the installed packages, without a network request: Tesseract's minified browser worker, the baseline LSTM-only core JS/WASM pair, and `4.0.0_best_int` Dutch/Portuguese trained-data gzip files. It resolves the core dependency from Tesseract's own package directory. Baseline WASM is deliberately selected by an explicit core-file path for deterministic packaging across SIMD variants; this prioritizes compatibility over maximum recognition speed. Selected package notices/readmes are copied alongside the assets.

The script replaces only its owned `public/ocr-assets/` output, naming its runtime directory with a SHA-256-derived content fingerprint. A generated JSON manifest records each immutable local URL, exact size and SHA-256. Nothing under that directory is committed. The Vite virtual-manifest plugin embeds this small metadata into the lazy OCR feature; it fails if packaging was skipped, rather than allowing a CDN fallback. `npm run dev`/`npm run build` invoke packaging through `predev`/`prebuild`. For direct Vite commands or to inspect assets separately, run `npm run prepare:ocr` first. Deploy the complete output directory, including OCR assets, not just application JS.

OCR model/core binaries are **excluded from Workbox precaching**. Installing the application shell alone does **not** make OCR ready offline. In the OCR screen, select a language and choose **Prepare OCR assets** while online. Preparation validates and caches the three shared runtime files plus that language's model sequentially. It does not request the other model. Already cached valid shared resources are reused. Fetches use same-origin mode, reject redirects, and bypass the OCR runtime cache with a preparation query; sizes and SHA-256 are verified before caching canonical URLs. Failed/canceled preparation retains any verified files but does not report completion; retry to finish.

A narrow same-origin Workbox CacheFirst rule serves only content-fingerprinted `/ocr-assets/<hash>/…` resources from `biboo-ocr-v1`. Its entry cap bounds retained asset versions; quota failures may purge this optional cache. OCR application route/supervisor chunks are ordinary precached application JS. Native worker/core/lang paths are always explicit local URLs, `workerBlobURL` is disabled, and Tesseract's separate trained-data IndexedDB cache is disabled. No CDN/cloud URL is used at runtime. User images/working copies/text never enter the service-worker cache.

The screen checks cache membership and revalidates required bytes before each recognition. Cached assets still require **the current production service worker controlling the page** to serve them offline. Finish installing/accept any pending app update, reload under worker control, prepare each desired language, then verify fully offline. A newer deployment uses different fingerprinted asset URLs and needs preparation again. Keep old deployment assets available for already-open older app versions where practical. Missing models, browser cache eviction, cleared site data, unsupported/private storage, or incomplete first preparation can prevent offline OCR. Development mode has no service worker and still needs its local server. HTTPS or localhost, Cache Storage, WebAssembly, Web Crypto, and nested dedicated workers are required.

### Diagnosing model preparation failures on iPhone

The four resources are, in order: the local worker JS, LSTM core JS, LSTM WASM, and **only the selected language's `.traineddata.gz` model**. The generator hashes the actual packaged file bytes. The virtual module embeds that manifest; paths are root-relative under `/ocr-assets/<fingerprint>/`. Preparation reuses a cached entry only after byte-length/SHA-256 verification, or fetches the same path with `?prepare=1` to bypass Workbox's canonical-URL CacheFirst route. Only verified bytes are saved under the canonical URL. `ocrRepository.ts` selects the page image separately in a read-only IndexedDB transaction; it does not fetch these runtime resources.

**Established serving defect:** Inspection of the running HTTPS preview returned `HTTP 200`, `Content-Length: 3005696`, an empty Content-Type, and `Content-Encoding: gzip` for the Dutch model. Vite's installed static-server code derives that encoding header from the `.gz` suffix. The model's installed/package/build copies have identical compressed-file SHA-256 values; packaging did not corrupt them. A single-gzip model body labeled as HTTP gzip is decoded by Fetch, so verification compares expanded model bytes with a compressed-file manifest. This affects the serving contract, not just Safari. WebKit has also had [gzip Fetch differences](https://bugs.webkit.org/show_bug.cgi?id=247421); no Safari-specific byte behavior is assumed here without an iPhone diagnostic.

`scripts/ocr-model-middleware.ts` now serves the exact allowlisted Dutch/Portuguese model files **before** Vite's dev/preview static middleware: `application/octet-stream`, no Content-Encoding, gzip-file Content-Length, and `nosniff`. GET, HEAD, canonical worker URLs and preparation-query URLs use the same representation. Missing model files return a real 404 instead of SPA HTML. HTTPS configuration, asset paths/fingerprints, compressed language bytes, Tesseract's gzip support and Workbox rules are unchanged. Other static hosting must likewise deliver these model files as opaque payloads, rather than assigning HTTP gzip encoding to the single-gzip file body.

Current inspected build (`4373ab842e5cbfd7`):

| Model | Packaged bytes | Packaged SHA-256 prefix | Expanded bytes (diagnostic only) | Expanded SHA-256 prefix |
| --- | ---: | --- | ---: | --- |
| nld | 3005696 | `a2d904b6ddc4feb0` | 6065224 | `363c360db9838838` |
| por | 1392239 | `dacebc1386ddaaf8` | 2422444 | `42fab1f017aedab6` |

If an iPhone diagnostic reports the expanded size/hash instead of the packaged size/hash, it directly confirms HTTP decoding on that device. These are inspected artifact values, not OCR/test success claims; a dependency change can change them. The preview stopped before a follow-up raw-versus-decoded HTTP body comparison could complete, so the browser body and the fix's end-to-end result still need manual validation.

Diagnostics now identify asset role/path, fetch versus verification versus cache stage, HTTP status/type/encoding where available, expected/actual byte counts and SHA-256 prefixes, and bounded underlying browser exception details. They never include response bodies, images or recognized book text. Hash-API failures are distinguished from corrupt cached bytes. Valid resources are reused without network requests; only invalid individual entries in `biboo-ocr-v1` are removed and refreshed. Legacy encoding headers are repaired when the cached bytes are valid. Verified cached responses have headers consistent with their stored entity bytes. Cache membership alone no longer enables recognition. A failed attempt resets progress/readiness and displays a failure status; a late initial cache probe cannot overwrite that outcome.

Focused new tests in `tests/ocrAssets.test.ts` cover the HTTP-decoded gzip mismatch, checksums, HTTP/read/digest/cache errors, valid reuse, metadata repair, individual model refresh and cancellation. `tests/ocrModelMiddleware.test.ts` covers both models' unchanged gzip bodies, header contract, GET/HEAD/query handling, missing assets and path allowlisting using tiny fixtures and streams. **These new tests were not run.**

To validate on iPhone, first stop the old preview with Ctrl+C. In PowerShell:

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run test:types
npm test
npm run lint
npm run build
$env:BIBOO_HTTPS_CERT = (Resolve-Path .certs\biboo-cert.pem).Path
$env:BIBOO_HTTPS_KEY = (Resolve-Path .certs\biboo-key.pem).Path
npm run preview -- --host 0.0.0.0 --port 4173 --strictPort
```

Restarting preview is necessary to load the new server middleware; rebuilding alone does not update an already-running preview process. In another terminal, inspect both model responses (use the IP covered by your certificate):

```powershell
Set-Location C:\workspace\active-projects\biboo
$bibooPreviewOrigin = 'https://192.168.1.183:4173'
$bibooOcrManifest = Get-Content .\dist\ocr-assets\manifest.json -Raw | ConvertFrom-Json
curl.exe --silent --show-error --dump-header - --output NUL "$bibooPreviewOrigin$($bibooOcrManifest.languages.nld.path)?prepare=1"
curl.exe --silent --show-error --dump-header - --output NUL "$bibooPreviewOrigin$($bibooOcrManifest.languages.por.path)?prepare=1"
```

Both should report HTTP 200, `application/octet-stream`, their packaged Content-Length, and **no Content-Encoding**. Also inspect canonical URLs without `?prepare=1`. Do not bypass iPhone certificate validation; retain the trusted mkcert setup above.

On iPhone, reopen the same HTTPS origin, finish the app update via **Update and reload** when offered, and ensure the current worker controls the page. Prepare Dutch, recognize a page, then switch to Portuguese and prepare/recognize again. Valid shared assets should be reused. Retry normally first: invalid model entries are repaired automatically without clearing any library or IndexedDB. After successful preparation, disable networking and retry/reload both languages offline.

If preparation still fails, retain the **full new diagnostic**, selected language, iOS version and whether the path had `?prepare=1`. Where Safari inspection is available, capture that resource's status, Content-Type, Content-Encoding, actual byte length and checksum prefix. The currently relevant paths are `/ocr-assets/4373ab842e5cbfd7/nld.traineddata.gz?prepare=1` and `/ocr-assets/4373ab842e5cbfd7/por.traineddata.gz?prepare=1`; use the generated manifest after any package update. Never clear all website data as a troubleshooting step. If optional-cache reset is necessary, deleting **only** `biboo-ocr-v1` in Cache Storage leaves the IndexedDB library intact; then prepare again online.

### Results and coordinates

Recognition explicitly requests `{ text: true, blocks: true }`; image, PDF, hOCR and TSV outputs are not requested. Automatic OCR rotation is disabled. `ocr.ts` maps the structured block → paragraph → line → word traversal into temporary arrays of blocks, lines and words, with full recognized text, optional confidence on a 0–100 scale, sequential one-based reading order, transient IDs, block/line relationships and paragraph order. Engine reading order is retained rather than sorting boxes geometrically. CRLF/CR become LF and NUL characters are removed; accents and other whitespace remain. Missing structured output is an error; a genuinely blank page is valid.

The screen creates a **separate in-memory PNG working copy**, composited on white and scaled down only if needed to a longest edge of 2400 pixels. The exact same PNG is displayed and sent to OCR, avoiding discrepancies between browser and engine EXIF/orientation/codec handling. Stored original/corrected bytes remain untouched. Input limits are 50 MiB and 20 megapixels (stricter than general page import); the decoded dimensions are checked too. A saved correction often provides a smaller, flatter source. The original decoded dimensions and actual working-image dimensions are shown.

Coordinates use a top-left origin with x rightward/y downward, referenced to the exact working-image width and height. Pixel edges `(x0,y0,x1,y1)` become `{x:x0/width, y:y0/height, width:(x1-x0)/width, height:(y1-y0)/height}` after clipping to the image. Empty, inverted or nonfinite boxes are omitted while their words/text are retained and counted in a warning. Full-image edges normalize to 0 and 1. Applying normalized values to the corresponding decoded saved image scales them back to that image plane; corrected-image coordinates are **not original-photograph coordinates** and would need the saved correction geometry for any future inverse mapping. No sticker-placement transform is implemented here.

The image has a responsive natural-aspect container and boxes use percentage positions/sizes without letterboxing. Toggle overlays, hover/focus/tap a box, or use the keyboard-accessible word selector to inspect text, order, confidence, relationships and normalized coordinates. Full text appears in a readable panel. Confidence is an engine estimate, not a guarantee of correctness.

### Worker lifecycle, limits and regression coverage

Opening the library creates no OCR engine. Recognition starts a single disposable supervisor worker, which loads the Tesseract client and creates one native Tesseract worker for the selected language. The supervisor tracks its own native child by a worker-local constructor wrapper because the installed engine's public `createWorker` handle arrives only after initialization. It explicitly terminates the child on cancel/error and acknowledges stopping; this does not change the browser page's Worker constructor. Normal completion terminates the engine before returning mapped data, and the supervisor is then terminated. Pending initialization errors are forwarded directly through the engine error handler. A five-minute recognition timeout and one-second stop-acknowledgment fallback prevent an indefinitely locked UI; a browser crash or suspended worker can still delay cleanup under browser control. Cancellation/navigation suppresses late results. PWA updates are disabled while an operation is active.

Only one recognition runs at a time per tab. Different tabs can still compete for device memory. Source decode, canvas, engine copies and WASM heap can substantially exceed compressed image size; the limits are safeguards, not a mobile-memory guarantee. Images larger than 20 megapixels should use a saved correction or be imported smaller. The working raster is at most 2400 × 2400; mapped output is capped at 5000 words. Temporary canvas dimensions are cleared, decode/display object URLs revoked, and workers released. No engine pool, batch OCR, OCR database records, database upgrade, or archive-format change is introduced. Source selection uses read-only transactions against the existing schema version 3/seven stores; `.biboo` version 1 backups continue to contain saved images/corrections, not temporary OCR output.

Recognition quality varies with print size, typography, page curvature, glare, illustration backgrounds, rotation, blur and language. Downscaling and the compact integer language models can lose fine detail. Handwriting, decorative fonts, reading order on complex layouts, punctuation and diacritics may be inaccurate. Browser-native formats such as HEIC/TIFF remain limited by the receiving browser; a successful import/restore does not guarantee OCR decoding. This is traditional local OCR, with no translation, AI recognition, automatic correction, text editing, or persisted results. Milestone 4B will handle editable persistence and archive evolution.

`tests/ocr.test.ts` adds pure mapping/text/language/box tests with synthetic inputs, edge clipping, invalid geometry, scale consistency, hierarchy/reading order, missing structured output, blank pages and the word cap. `tests/ocrPersistence.test.ts` uses isolated fake-indexeddb state to check corrected/original selection, matching revision/ownership, unchanged source records, and unchanged schema/store count. These tests do not initialize Tesseract or establish recognition accuracy/offline behavior.

### Manual validation for Milestone 4A

No preparation script, tests, type checks, build, lint or browser verification was executed during implementation. Run manually:

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run prepare:ocr
npm run test:types
npm test
npm run lint
npm run build
Get-Content .\public\ocr-assets\manifest.json
Get-ChildItem .\dist\ocr-assets -Recurse | Select-Object FullName,Length
Select-String -Path .\dist\sw.js -Pattern 'ocr-assets|ocr.worker|biboo-ocr-v1'
npm run preview -- --host 127.0.0.1 --port 4173
```

1. **Initial online preparation:** Open `http://127.0.0.1:4173` in a disposable profile, finish service-worker installation, reload under its control, and accept any pending update. Create Dutch and Portuguese books with clear printed pages, including at least one saved correction. Before preparing OCR, check that only application assets are precached and no model download/engine initialization happened on Library. Open Recognize text; verify corrected/original source labels, language defaults and preparation-required status. An unsupported source language must not silently choose a model.
2. **Download isolation:** Prepare Dutch with Network recording. Confirm worker/core/WASM and `nld.traineddata.gz` are requested only from the current origin; `por.traineddata.gz` must not be requested yet. Verify the selected files appear in `biboo-ocr-v1`. Recognize text and inspect the two worker contexts. Confirm no CDN, API, third-party or user-image upload requests. Then select Portuguese and verify only its missing language data is fetched (shared valid assets reused). Leave/reopen and verify cached status.
3. **Fully offline:** After successful preparation, disable all networking or stop the preview server (leave the installed controlled app open), reload/direct-load `/books/<bookId>/pages/<pageId>/ocr`, and recognize both prepared languages. Inspect text/boxes and refresh/retry. A language never prepared must fail clearly offline without claiming its assets are ready. Clearing only the optional OCR cache in a disposable profile must preserve the library but require preparation again. Restore normal networking/server afterward.
4. **Visual/coordinate checks:** Try a calibration page with separated words, accents and multiple lines. Hover/tap boxes and use Tab/word selector. Resize desktop/phone viewport and toggle overlays: boxes must remain on the displayed word, including the right/bottom edges. Verify working dimensions, one-based order and confidence/details. Try a blank page and illustrations with no text. Compare corrected and original pages; OCR must not change their saved bytes or correction revision.
5. **Failures/cleanup:** Cancel during preparation, engine initialization and recognition; immediately navigate away and retry, ensuring no stale text appears on the next page. Verify worker contexts disappear and repeated runs do not accumulate URLs/workers. Try unsupported decoding, an oversized photograph, interrupted asset downloads, a missing deployed asset and safely simulated Cache Storage quota failure. Preparation errors must not alter saved books. Reload/update while busy should retain existing unload/update protections; mobile unload dialogs remain best-effort. Record unexercised device/memory cases as unverified.
6. **Regressions:** Create/edit/reorder/delete pages, correct/reset a page, and export/restore an independent book with original and corrected images. Refresh and use those features offline. Existing seven-store data and archive version 1 must remain unchanged. OCR results should disappear on leaving/refreshing and never appear in exports. Inspect emitted chunks/Network initiators to distinguish service-worker precaching from engine initialization: OCR screen/engine code must stay outside the library's eager graph.

## Automated regression tests (Milestone 3.1)

The existing Vitest and fake-indexeddb development dependencies run a small Node-only suite. Use a Node version supported by the installed Vitest 5 (Node 22.12+, 24, or 26+ in its supported release ranges). No browser, running app, service worker, image codec, or external service is needed. `vitest.config.ts` is separate from the production Vite/PWA configuration, and tests live outside `src` and the production TypeScript project. No test setup is imported by application code. The separate test TypeScript configuration checks the tests and the production helpers they import; Vitest itself transpiles tests without type-checking them.

From PowerShell, run manually:

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run test:types
npm test
```

Optional watch mode (stop with Ctrl+C), or run one suite:

```powershell
npm run test:watch
npm test -- tests/geometry.test.ts
npm test -- tests/backup.test.ts
npm test -- tests/archive.test.ts
npm test -- tests/persistence.test.ts
```

Coverage is organized around the existing production functions:

- `tests/geometry.test.ts`: identity and known trapezoid coordinates, skewed forward/inverse mappings, deterministic grid round trips, all display rotations and corner-order round trips, invalid/degenerate/crossed corners, singular matrices and projective denominators, physical-ratio rounding, RGBA edges/center sampling, alpha compositing, and chunked rendering.
- `tests/backup.test.ts`: empty, original-only and corrected snapshots; complete metadata and Blob preservation; fresh book/page/revision IDs with consistent ownership; missing/extra/mismatched assets, invalid metadata/references/corners, duplicate IDs, unsupported versions, and declared per-image/total/page limits.
- `tests/archive.test.ts`: real small ZIP STORE round trips using the production dynamically loaded zip.js implementation, preserving all bytes and MIME types; invalid JSON/UTF-8, unsafe paths and missing/extra entries, CRC corruption, truncation, cancellation, and file/manifest size guards. No ZIP implementation mock or large binary fixture is used. An oversized file guard is exercised with a mocked size getter; an oversized manifest uses a patched ZIP header. These checks do not allocate hundreds of megabytes or simulate a full decompression bomb.
- `tests/persistence.test.ts`: real Dexie operations against fake-indexeddb, schema/index checks, version 1/2 upgrades, book create/update/reopen, complete independent restores, a forced final-store write failure rolling back all seven stores, canceled/invalid restores, stable-ID reordering and rollback, accessible move operations, and page/book cascades preserving another book.

`tests/setup.ts` installs fake-indexeddb before Dexie imports. Each persistence test deletes and reopens the fake database, and cleanup deletes it again. Failure-injection hooks are removed in `finally` blocks. Fixtures have fixed IDs/timestamps and tiny, distinct binary payloads; archives intentionally retain opaque image bytes rather than decoding them. Geometry tests use separate tiny synthetic RGBA buffers and numeric tolerances. New restore IDs are checked for uniqueness and correct relationships rather than fixed random values.

This foundation does not exercise React UI, browser image decoding/EXIF, real device quota limits, worker execution, downloads, or PWA installation/offline caching. Continue using the manual browser checks above for those behaviors. It does not exhaustively cover every adversarial ZIP encoding or browser storage failure. No production defect has been established and no production behavior has been changed in this milestone. **Tests, type checks, builds, and lint were not executed during implementation; results remain unverified until you run them.**

## Manual production and installation verification

From PowerShell:

```powershell
Set-Location C:\workspace\active-projects\biboo
npm run lint
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Then open `http://127.0.0.1:4173` and check:

1. Start with an empty library. Create a book using the default languages, then try another using a square preset, a swapped landscape preset, and custom decimal dimensions.
2. Open details, edit and save, reload, and confirm every field persists. Creation time should remain unchanged; modification time should change. Newest edited books appear first.
3. Submit an empty title and invalid dimensions. Check inline errors, focused invalid controls, keyboard access, narrow-screen layout, and usable touch controls.
4. Change a form and click Library, browser Back, or Cancel. Confirm the discard dialog protects changes. Reload an edited page and check the browser's unload protection.
5. Cancel a delete and confirm the book remains. Confirm a delete and reload to verify permanent removal. Visit an unknown book URL and an unknown route.
6. In browser developer tools, inspect Application > Manifest and Service Workers. Confirm standalone metadata, 192/512 icons, maskable purpose, Apple touch link, and an active service worker. Check `dist/index.html` and `dist/manifest.webmanifest` if needed.
7. Wait for library offline readiness, reload once so the page is controlled, then enable developer-tools Offline. Reload both `/` and a saved `/books/:bookId` URL. Create, edit, and delete books offline, then reload to verify persistence. Cache Storage may contain application assets and separately prepared OCR resources; book records should exist under IndexedDB > biboo > books, and user images must never be cached by the worker.
8. Install using the browser's install UI when available. On iOS Safari, use Share > Add to Home Screen from an HTTPS deployment. Confirm icon appearance and standalone launch. For physical-phone testing, deploy to HTTPS; a phone accessing a LAN HTTP address generally does not qualify as a secure origin.
9. For the update flow, keep the installed production app open, edit a book without saving, change visible application copy in a second terminal, and run `npm run build` again. Keep preview serving the same directory. In developer tools click the worker's Update action (leave **Update on reload** and **Skip waiting** overrides off). Confirm the prompt appears without reloading, and updating is disabled until saving/discarding. Click **Update and reload** and verify the new copy and preserved library. Repeat with two tabs: accepting an update in one must not reload the other's unsaved form.

The worker does not run under `npm run dev`; use the production preview for PWA checks. Browsers may hide installation prompts for already installed apps or apply platform-specific eligibility rules.

## Known limitations and future milestones

- Milestone 4A has not been compiled, linted, tested, or browser-verified during delivery. Run the checks above before deployment.
- Library queries refresh when their screens mount, not live across tabs. Concurrent edits use last successful save wins; there is no conflict-resolution UI.
- No autosave, undo after deletion, storage-persistence request, automatic backups, or background cross-device synchronization. Manual `.biboo` archives provide portable backup/restore. Browser unload prompts are best-effort, especially on mobile.
- UI copy is English. Stored language tags support a broader future language catalogue.
- Icons and service-worker output are generated during the production build; validate the generated assets on target devices.
- Root-origin hosting only in this milestone. A deployment under a subpath needs coordinated Vite base, router, manifest, and worker-scope changes.
- OCR is currently temporary and read-only, limited to Dutch/Portuguese and explicit offline asset preparation. Future milestones may introduce editable/persisted OCR, automatic page detection, AI translation, suitable sticker placement, and printable translated labels/PDFs. Authentication, cloud services, and a backend are not included.
