# Biboo — Bilingual Books

Biboo is a local-first Progressive Web Application for bilingual families. It provides an installable, offline-capable book library: create a book, choose its languages, set page dimensions, and add photographs of its pages. Milestone 2A adds local file/camera import, thumbnails, larger viewing, reading-order management, and page deletion.

All metadata, original images, and thumbnails stay on the device. Perspective correction (Milestone 2B), OCR, translation, sticker positioning, printable labels, and PDFs are future work.

## Stack

Uses the existing dependencies without version changes: React 19, TypeScript 6, Vite 8, MUI 9 with Emotion, React Router 7, Dexie 4, vite-plugin-pwa 2, Workbox, and @vite-pwa/assets-generator 2. No backend, accounts, telemetry, external fonts, or paid services.

## Development commands

Run from the repository directory with the already installed dependencies:

```powershell
npm run dev
npm run lint
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
```

Development runs on the URL printed by Vite. The development server intentionally does not register a service worker. `build` runs the TypeScript project build, bundles the application, generates installation assets and the manifest, and produces the service worker in `dist`. `preview` serves that production output for local inspection; it is not a production hosting service.

Milestone 2A.1 has not been built, linted, or browser-tested during implementation. Run the manual checks below; no successful execution is claimed for these changes.

## Source structure

- `src/app/`: MUI theme, PWA lifecycle, and fallback page.
- `src/App.tsx`: responsive navigation, shared layout, update prompt, and editing state.
- `src/features/books/`: book types, validation, language and dimension catalogues, repository, library, detail, and editor screens.
- `src/features/pages/`: page/asset types, transactional repository, browser image preparation, reactive page gallery, and image URL lifecycle.
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

**Future heavy features:** Keep OCR/image processing, AI translation, intelligent sticker layout, and PDF generation in separate feature modules. Load a feature's entry with `import()` from its action handler, or a new `route.lazy` boundary when it has its own route. Keep each engine's dependencies inside that module; never statically re-export them through the shell, library, or a shared barrel. Add local loading/error states when those features exist. No placeholder engines or loading framework are introduced in this milestone.

**Offline contract:** Workbox's existing JavaScript/CSS glob precaches all emitted current route and shared chunks, including chunks not yet visited. Lazy loading defers module evaluation/use; it does not remove those chunks from the initial offline installation download. Core create/edit/delete operations must work offline immediately after the application cache is installed. Future optional model files, OCR language packs, worker payloads, and other large downloads belong under `public/optional-resources/` (emitted as `dist/optional-resources/`) or an external download URL. `optional-resources/**` is explicitly excluded from precaching, with no runtime caching added. Do not bundle model/pack contents into application JavaScript or import them as build assets that relocate them outside this directory. Optional downloads will require a deliberate download/storage policy when implemented; they are not promised offline availability by this milestone.

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

The `biboo` IndexedDB database is schema version 2. The unchanged version 1 declaration and book records are preserved by an additive version 2 declaration. The `books` store uses UUID `id` as primary key and indexes `updatedAt` for newest-first listing. Each book stores:

- `id`, `title`, `sourceLanguage`, `targetLanguage`
- `widthMm`, `heightMm`
- ISO `createdAt` and `updatedAt` timestamps

Creates use `crypto.randomUUID()` and canonical BCP 47 language tags. Edits preserve IDs and creation dates and update the modification timestamp inside a transaction. Future schema changes must add Dexie versions and migration logic rather than rewriting version 1.

Defaults are Dutch (Netherlands), `nl-NL`, and Portuguese (Portugal), `pt-PT`. A small language catalogue can be extended without schema changes. Titles are required and limited to 200 characters; each dimension must be a finite value from 1 to 2,000 mm, including decimal measurements. Presets include A5, A4, small and standard square books, and a landscape picture book. Measurements always describe one page. Width and height can be swapped or entered directly.

Records survive reloads and application updates on the same origin and browser profile. Browser storage can still be evicted; clearing site data, uninstall behavior, private browsing, or changing browser/origin can remove or isolate the library. There is no backup/export yet. Storage failures are surfaced in the UI; failed saves retain the form values for retry. Forms save only after explicit submission. Delete requires confirmation.

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

Where supported, `navigator.storage.estimate()` displays approximate site usage/quota and warns below 50 MiB estimated headroom or when selected originals appear to exceed headroom. Estimates are advisory and shared with other storage for this origin; actual quota errors still govern each transaction. There is no permanent-storage guarantee, persistence permission request, backup/export, or cloud copy. Keep source photos elsewhere.

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
6. **Atomic/cascade behavior:** In a disposable profile, simulate quota exhaustion using browser tooling if supported, or an intentionally limited-storage environment. Confirm a failed append leaves neither lone metadata nor orphan assets; previously imported pages remain and remaining files are reported as not imported. If the browser offers no safe quota simulation, record that case as unverified. Delete a multi-page book and confirm no matching records remain in any of the four stores. Another book's records must remain untouched.
7. **Offline/lazy loading:** Wait for successful precaching and reload once under worker control. Switch to Offline before first opening a book route in that document. Import local files, view originals, reorder, delete, and reload/direct-load the book route. Confirm persistence. Inspect Cache Storage for application assets only, and IndexedDB for image Blobs. Network Initiator should distinguish service-worker chunk precaching from application imports; processing/UI code must remain outside the eager library graph.
8. **Lifecycle/protection:** Open/close larger views and reorder repeatedly; check that thumbnail assets aren't refetched on every reorder and that object URLs are revoked when views/cards unmount. During a multi-image import, try Library/Back, edit/delete book, and a PWA update. Verify guards, Stop import, and the final saved/failed/skipped report. Do not enable developer-tool forced worker activation when checking update consent.
9. **Storage caveat:** Confirm approximate usage appears where supported, unavailable estimates degrade cleanly, and low-space warnings do not promise permanent storage. Clearing site storage in a disposable profile should remove books and images; there is no recovery/export yet.

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
7. Wait for offline readiness, reload once so the page is controlled, then enable developer-tools Offline. Reload both `/` and a saved `/books/:bookId` URL. Create, edit, and delete books offline, then reload to verify persistence. Inspect Cache Storage: only application assets should be cached; book records should exist under IndexedDB > biboo > books.
8. Install using the browser's install UI when available. On iOS Safari, use Share > Add to Home Screen from an HTTPS deployment. Confirm icon appearance and standalone launch. For physical-phone testing, deploy to HTTPS; a phone accessing a LAN HTTP address generally does not qualify as a secure origin.
9. For the update flow, keep the installed production app open, edit a book without saving, change visible application copy in a second terminal, and run `npm run build` again. Keep preview serving the same directory. In developer tools click the worker's Update action (leave **Update on reload** and **Skip waiting** overrides off). Confirm the prompt appears without reloading, and updating is disabled until saving/discarding. Click **Update and reload** and verify the new copy and preserved library. Repeat with two tabs: accepting an update in one must not reload the other's unsaved form.

The worker does not run under `npm run dev`; use the production preview for PWA checks. Browsers may hide installation prompts for already installed apps or apply platform-specific eligibility rules.

## Known limitations and future milestones

- Milestone 2A.1 has not been compiled, linted, rendered, or browser-tested during delivery. Run the checks above before deployment.
- Library queries refresh when their screens mount, not live across tabs. Concurrent edits use last successful save wins; there is no conflict-resolution UI.
- No autosave, undo after deletion, backup/import/export, storage-persistence request, or cross-device synchronization. Browser unload prompts are best-effort, especially on mobile.
- UI copy is English. Stored language tags support a broader future language catalogue.
- Icons and service-worker output are generated during the production build; validate the generated assets on target devices.
- Root-origin hosting only in this milestone. A deployment under a subpath needs coordinated Vite base, router, manifest, and worker-scope changes.
- Future milestones may introduce perspective correction, OCR, AI translation, suitable sticker placement, and printable translated labels/PDFs. None of those features, authentication, cloud services, or a backend are included here.
