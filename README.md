# Biboo — Bilingual Books

Biboo is a local-first Progressive Web Application for bilingual families. Milestone 1A provides an installable, offline-capable book-project library: create a book, choose its original and translation languages, set page dimensions, and edit or delete it later.

This milestone stores book metadata only. OCR, translation, photography, sticker positioning, printable labels, and PDFs are future work.

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

Milestone 1A was manually validated. The Milestone 1B changes have not been built, linted, or browser-tested during implementation; validate them using the commands and checks below.

## Source structure

- `src/app/`: MUI theme, PWA lifecycle, and fallback page.
- `src/App.tsx`: responsive navigation, shared layout, update prompt, and editing state.
- `src/features/books/`: book types, validation, language and dimension catalogues, repository, library, detail, and editor screens.
- `src/data/database.ts`: typed Dexie schema and database version.
- `src/main.tsx`: theme and React Router routes.
- `public/biboo.svg`: original book-mark icon and source for generated installation assets.
- `vite.config.ts`: manifest, generated assets, and application-shell caching policy.

Database access stays in the repository; components do not read or write Dexie tables directly. Routes are `/`, `/books/new`, and `/books/:bookId`. Unknown routes show a useful fallback. The data router supports unsaved-change navigation blocking, including browser Back. Native unload protection covers reloads and tab closure where supported by the browser.

## PWA architecture and offline behavior

The production build uses vite-plugin-pwa's `generateSW` strategy. The manifest identifies Biboo with tagline Bilingual Books, standalone display, root scope/start URL, warm background, and forest-green theme. Hosting assumes the origin root. Deploy `dist` over HTTPS; localhost is suitable for desktop development. Configure the host to rewrite application routes to `index.html`, and serve service-worker and manifest files with their correct content types. Serve `sw.js` and `index.html` with revalidation rather than long immutable caching; hashed assets can use immutable caching.

The existing asset generator consumes `public/biboo.svg` during build. Its `minimal-2023` preset generates 192/512-pixel application icons, a 512-pixel maskable icon, a 180-pixel Apple touch icon, and favicons. The plugin injects manifest icon entries and HTML icon links. Generated PNG/ICO assets are build products; they have not been generated or checked in during this implementation.

Workbox precaches only build-owned HTML, JavaScript, CSS, icons, and fonts. Navigation fallback serves the cached shell for library/book routes. There are no runtime caching rules, data endpoints, or service-worker caches of user book data or images. User metadata lives exclusively in IndexedDB. Do not place future user uploads in `public` or `dist`; future image storage needs its own IndexedDB design.

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

The `biboo` IndexedDB database is schema version 1. The `books` store uses UUID `id` as primary key and indexes `updatedAt` for newest-first listing. Each book stores:

- `id`, `title`, `sourceLanguage`, `targetLanguage`
- `widthMm`, `heightMm`
- ISO `createdAt` and `updatedAt` timestamps

Creates use `crypto.randomUUID()` and canonical BCP 47 language tags. Edits preserve IDs and creation dates and update the modification timestamp inside a transaction. Future schema changes must add Dexie versions and migration logic rather than rewriting version 1.

Defaults are Dutch (Netherlands), `nl-NL`, and Portuguese (Portugal), `pt-PT`. A small language catalogue can be extended without schema changes. Titles are required and limited to 200 characters; each dimension must be a finite value from 1 to 2,000 mm, including decimal measurements. Presets include A5, A4, small and standard square books, and a landscape picture book. Measurements always describe one page. Width and height can be swapped or entered directly.

Records survive reloads and application updates on the same origin and browser profile. Browser storage can still be evicted; clearing site data, uninstall behavior, private browsing, or changing browser/origin can remove or isolate the library. There is no backup/export yet. Storage failures are surfaced in the UI; failed saves retain the form values for retry. Forms save only after explicit submission. Delete requires confirmation.

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

- Milestone 1B has not been compiled, linted, rendered, or browser-tested during delivery. Run the checks above before deployment.
- Library queries refresh when their screens mount, not live across tabs. Concurrent edits use last successful save wins; there is no conflict-resolution UI.
- No autosave, undo after deletion, backup/import/export, storage-persistence request, or cross-device synchronization. Browser unload prompts are best-effort, especially on mobile.
- UI copy is English. Stored language tags support a broader future language catalogue.
- Icons and service-worker output are generated during the production build; validate the generated assets on target devices.
- Root-origin hosting only in this milestone. A deployment under a subpath needs coordinated Vite base, router, manifest, and worker-scope changes.
- Future milestones may introduce page capture, OCR, AI translation, suitable sticker placement, and printable translated labels/PDFs. None of those features, authentication, cloud services, or a backend are included here.
