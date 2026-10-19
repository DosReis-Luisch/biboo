# Biboo portable book archive, version 1

This is an application interchange format, independent of IndexedDB/Dexie schema version 3. A `.biboo` file is a single ZIP containing exactly one UTF-8 `manifest.json` plus every image referenced by that manifest. The format identifier is `biboo-book`; `archiveVersion` is the integer `1`. Unknown versions are rejected instead of guessed or partially restored.

## Entry layout

```text
manifest.json
pages/<page UUID>/original
pages/<page UUID>/thumbnail
pages/<page UUID>/corrected             # only with saved correction settings
pages/<page UUID>/corrected-thumbnail   # only with saved correction settings
```

The extensionless image entries contain the original encoded file bytes. MIME types and byte lengths are explicit in the manifest. Original filenames are metadata only and never form ZIP paths. All paths are case-sensitive ASCII; IDs are canonical lowercase UUIDs. No directory entries, unrelated files, duplicate paths, absolute paths, dot components, backslashes, percent-encoded alternatives, links, executables, special files, or encrypted entries are accepted. Unicode/raw-name aliases, ambiguous ZIP structures, local/central header disagreement, overlapping entries, checksum failures, and truncated/decompression-failed entries are rejected.

Biboo writes all entries with ZIP STORE (method 0), avoiding redundant compression of already encoded photos. ZIP DEFLATE (method 8) is also accepted on import. Neither operation re-encodes, resizes, decodes, or regenerates image data. ZIP64 structures may be read when within the application limits. There is no encryption, signature, or cryptographic authentication. ZIP CRC32 checks detect accidental content corruption, not a deliberately forged archive.

## Manifest example

The following illustrates one corrected page. Byte lengths are examples, not a downloadable fixture; real entries must contain exactly their declared number of bytes.

```json
{
  "format": "biboo-book",
  "archiveVersion": 1,
  "exportedAt": "2026-10-19T12:00:00.000Z",
  "book": {
    "id": "11111111-1111-4111-8111-111111111111",
    "title": "A family story",
    "sourceLanguage": "nl-NL",
    "targetLanguage": "pt-PT",
    "widthMm": 210,
    "heightMm": 297,
    "createdAt": "2026-10-19T10:00:00.000Z",
    "updatedAt": "2026-10-19T11:00:00.000Z"
  },
  "pages": [
    {
      "page": {
        "id": "22222222-2222-4222-8222-222222222222",
        "bookId": "11111111-1111-4111-8111-111111111111",
        "readingOrder": 1,
        "originalFilename": "page-photo.jpg",
        "createdAt": "2026-10-19T10:30:00.000Z",
        "widthPx": 3000,
        "heightPx": 4000,
        "mimeType": "image/jpeg",
        "role": "interior"
      },
      "original": {
        "path": "pages/22222222-2222-4222-8222-222222222222/original",
        "mimeType": "image/jpeg",
        "byteLength": 1000000
      },
      "thumbnail": {
        "path": "pages/22222222-2222-4222-8222-222222222222/thumbnail",
        "mimeType": "image/jpeg",
        "byteLength": 25000
      },
      "correction": {
        "settings": {
          "pageId": "22222222-2222-4222-8222-222222222222",
          "bookId": "11111111-1111-4111-8111-111111111111",
          "corners": [{ "x": 0, "y": 0 }, { "x": 1, "y": 0 }, { "x": 1, "y": 1 }, { "x": 0, "y": 1 }],
          "rotation": 0,
          "sourceWidthPx": 3000,
          "sourceHeightPx": 4000,
          "targetWidthPx": 1697,
          "targetHeightPx": 2400,
          "widthMm": 210,
          "heightMm": 297,
          "updatedAt": "2026-10-19T11:00:00.000Z",
          "revision": "33333333-3333-4333-8333-333333333333"
        },
        "image": {
          "path": "pages/22222222-2222-4222-8222-222222222222/corrected",
          "mimeType": "image/jpeg",
          "byteLength": 500000
        },
        "thumbnail": {
          "path": "pages/22222222-2222-4222-8222-222222222222/corrected-thumbnail",
          "mimeType": "image/jpeg",
          "byteLength": 20000
        }
      }
    }
  ]
}
```

## Metadata and relationships

- `book` preserves complete current book metadata except that restore assigns a fresh ID. Titles are nonblank and at most 200 characters; languages are valid tags accepted by `Intl.getCanonicalLocales`; physical dimensions are finite, 1–2000 mm.
- `pages` is an ordered array, with `readingOrder` exactly 1 through its length. Empty books are valid. Book/page IDs and correction revision IDs must be unique. Every page's `bookId` matches the archive book.
- Page pixel dimensions are positive integers with at most 60 megapixels. `originalFilename` and `role` are optional; allowed roles are `cover`, `interior`, and `back-cover`. Absent optional fields are omitted, not `null`.
- Each page requires both its original and imported thumbnail. Every asset reference has exactly `path`, lowercase raster-image `mimeType`, and positive integer `byteLength`. The original MIME must equal `page.mimeType`. SVG is excluded. Arbitrary raster formats may be carried even when the receiving browser cannot decode them.
- Optional `correction` must contain the complete settings/image/thumbnail triple. The settings IDs refer to that page/book. Its revision applies to both derived assets. Four normalized original-image points are ordered by destination TL/TR/BR/BL; rotation is 0/90/180/270. Convexity, winding, area, and numerical thresholds match the correction editor.
- Source correction dimensions are positive integers (minimum 2 per axis), at most 60 megapixels. They can differ from imported page dimensions because browser EXIF decoding can differ. Target dimensions match the saved correction's physical ratio, rounded to a 2400-pixel longest edge. Saved physical dimensions can differ from the book's current dimensions if the book was edited after correction; restore retains that distinction.
- Timestamps are canonical ISO UTC strings, including milliseconds. Relevant creation/update dates, geometry, roles, filenames, dimensions, languages, and reading order are preserved. Export adds its own `exportedAt`.
- Unexpected JSON fields are rejected for version 1. JSON contains metadata and references only, never base64 image payloads. Parsing constructs whitelisted records rather than spreading unknown JSON into database objects.
- Every referenced asset must exist exactly once, have the declared size, and be inside its page's canonical directory/role. Extra entries and incomplete correction triples are invalid. CRC and actual streamed byte counts are checked before any write. Image formats themselves are not decoded as part of archive validation; a correctly checksummed but internally damaged image can still fail when displayed later.

## Safeguards

Current implementation limits (may be revised by later app releases): 500 pages, 2001 ZIP entries, 2 MiB manifest, 64 MiB per asset, 256 MiB total decompressed data including the manifest, and 300 MiB compressed file size. Declared sizes must be safe integers. Actual stream output is checked against declared sizes and the shared decompressed budget, independently of ZIP header claims. Metadata/image allocations still have browser-dependent overhead; these limits do not promise that a phone can process their maximum.

## Restore mapping and atomicity

The manifest and all assets are validated/extracted before starting a database write. Restore creates a fresh UUID for the book, each page, and each correction revision. Page `bookId`, correction `pageId`/`bookId`, and derived-asset revision references are remapped consistently. Asset paths are interchange references only; restored IndexedDB rows use the new IDs, not ZIP paths.

One read-write transaction adds the entire project to `books`, `pages`, `pageOriginals`, `pageThumbnails`, `pageCorrections`, `pageCorrectedImages`, and `pageCorrectedThumbnails`. `add`/`bulkAdd` are used, never replacement writes or clearing stores. Validation, extraction, cancellation before commit, quota failure, and write failures cannot leave a partial restored book. Export uses one read-only transaction across those same seven stores, then packages an immutable snapshot outside that transaction without modifying it.
