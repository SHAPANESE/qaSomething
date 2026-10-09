# Writing the Evidence section

Read this before writing Evidence. The one-line rule is in SKILL.md: Evidence is a tangible
artefact and nothing else. This file is why, with the table of where everything else goes and
the counter-example to recognise in your own draft.

## Writing the Evidence section — only artefacts, never provenance

**Evidence is a tangible artefact and nothing else.** An image, a console excerpt, a payload, a
query result — something the reader can look at and check for themselves:

```markdown
![<alt text stating the defect>](<assetUrl>)

<console excerpt / payload / query result, when the defect is invisible in a capture>
```

**Never write a provenance line as evidence.** A build line like

```
Preview `shop-web-git-feature-sso` @`a1b2c3d` · backend `staging-api` · 2026-09-16
```

is not evidence. It is a note about the session that produced it, and to a reader it looks like
tool exhaust rather than proof. The same goes for describing your method in place of the artefact
— "read from the live DOM", "measured via `getComputedStyle`", "confirmed with a sweep". Show the
output, not the fact that you ran something.

If the build or host genuinely matters to reproduce it, it belongs in **Steps** as the URL the
reader opens, not in Evidence.

Pick the artefact by what the defect is:

| The defect is… | The artefact |
| --- | --- |
| Visible on screen (layout, colour, wrong value, missing control) | an image |
| An absent or wrong attribute, a DOM shape, a computed style | a console excerpt showing the read |
| A wrong request, response or status code | the payload, fenced |
| A wrong row, count or total | the query and its result |

Format a console excerpt the way DevTools shows it — the expression, then the returned value —
so it reads as something a reader can paste and re-run:

```
> [...document.querySelector('nav > ul.w-full').children].map(c => c.tagName)

[ "DIV", "DIV", "DIV", "DIV" ]
```

Nothing else belongs here — and "nothing else" is the part that keeps getting ignored.

**Everything you are tempted to add goes somewhere else, or nowhere:**

| Tempted to write | Where it goes |
| --- | --- |
| The values the screen showed | **Actual** |
| The payload, status code or query that proves the mechanism | **RCA** |
| Which other routes or screens do the same | one clause at the end of **RCA** |
| Who owns the record, ids, names | **Steps**, in the step that opens it |
| "Nothing was written, verified after" | the casebook, or a comment — not the ticket |
| "[V] verified live / [I] inferred" | the casebook. Say the uncertainty in **Description** if it changes what the dev does |
| Why the finding survives objection X | nowhere. Nobody raised X |

Those last three are QA housekeeping. They matter to the run, not to the person fixing the bug.

The failure mode to recognise in your own draft: five short paragraphs, each true, none of them the
artefact. That is investigation notes wearing the Evidence heading.

### The counter-example

This is the shape to recognise and not repeat: an Evidence paragraph that buries four facts in
prose.

```markdown
Found by an API contract run with Schemathesis 4.4.4 over the 41 read-only GET endpoints of
`/api/orders/*`, then confirmed by a valid-parameter sweep of the same 41: 6 leak, 33 return a
clean 200, 2 do not return 200. Leaking endpoints: `order-entry/order-scope`, ...
```

Same facts, reshaped — nothing cut, and now scannable:

```markdown
6 of 41 read-only `GET /api/orders/*` endpoints leak; 33 return a clean 200, 2 never return 200.

Leaking: `order-scope`, `payment-types`, `get-discount-type`, `get-valid-dates`,
`get-valid-dates-by-store`, `review-items`.

Found with a Schemathesis 4.4.4 contract run, confirmed by a valid-parameter sweep of the same 41.
```

The methodology drops to one line at the end, where a developer can ignore it. The count and the
list — the two things they act on — are on their own lines at the top.

