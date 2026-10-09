# Capturing the evidence and posting it

Read this when you are ready to produce the capture and put the finding in the tracker.
Both halves already exist as tools — do not hand-roll either.

## Capturing the evidence — use the tools that already exist

Do not hand-roll either half of this. Both have been written once already, and the hand-rolled
version of the first one shipped a legend whose numbers were not checked against what actually
got marked.

**The annotated capture** — use `qa-explain/assets/annotate.js` via `browser_evaluate`, editing
only its CONFIG block (`title`, `marks`, `notes`). It returns a report of what it marked; read it
before writing the report. A `found: false` means a number in your legend points at nothing.

Its boxes are `position:fixed` and use viewport coordinates, so **re-annotate after any resize or
navigation** — never reuse an overlay across a viewport change — and screenshot the viewport, not
`fullPage`. Check the frame before you attach it: too narrow clips the layout, too wide pads it with
dead space, and both read as sloppy.

For a "the screen disagrees with the source of truth" defect, put BOTH values on the capture: the
rendered value and, beside it, what the API or DB returned at that same moment. Fetch it from
inside the page (`fetch(url, { credentials: 'include' })`) so it is provably the same session and
the same instant — a screenshot of the UI next to a separate terminal dump proves much less. The
`extra` lines in CONFIG are where that fetched value goes; do not build a panel by hand for it.

**Putting it in Linear** — the capture goes **inline in the Evidence section**, not as a bare
attachment row. An attachment is a link somebody has to choose to click; an inline image is read.

1. `prepare_attachment_upload` with the issue, filename, contentType and the **exact** byte size
   (`stat -f%z`). A wrong size 403s.
2. `PUT` the raw bytes to `uploadRequest.url` with `curl --data-binary @path`, sending **every**
   header from `uploadRequest.headers` verbatim, casing included. Do not base64 it. The signed URL
   expires in **60 seconds** — have the file on disk before step 1.
3. `create_attachment_from_upload` with the returned `assetUrl`.
4. Embed it in the comment body: `![<what it shows>](<assetUrl>)`. Use the **bare** assetUrl. Linear
   appends its own `?signature=` with a 5-minute expiry and re-signs it on every read, so pasting a
   signed URL back is both unnecessary and misleading to anyone reading the raw markdown.

Never batch step 1 for several files: earlier URLs expire while you prepare the later ones.

To add the image to an issue that already exists, `save_issue` with a `patch` op anchored on a line
of the Evidence section — cheaper and safer than re-sending the whole description.

The alt text is not decoration — it is what the reader sees if the image fails, so make it state
the defect ("Size column renders '-' while the API returns a size for each row"), not the filename.

