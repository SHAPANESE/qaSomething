# The bug format — the approved shape and how to write the RCA

Read this when writing up a finding. The six sections and the length limits are in SKILL.md;
this file is the worked shape behind them.

## The template

If `LOCAL.md` (next to `SKILL.md`) names an approved reference ticket, read the live ticket and
copy its structure. This is that structure, with the content replaced by what each section is for:

```markdown
**Description**

Three sentences at most. What is wrong, what record or screen it happened on, and the severity as
a clause — "High: another tenant's order pricing plus a write path, reachable by pasting a
URL."

**Steps to reproduce**

1. Sign in as <the persona, with the real ids>.
2. Open <the exact URL>. <What that record is, if it matters — owner, ids, names.>
3. <Read or do the thing.>
4. <The action that triggers the defect, and what to have open while doing it.>

**Actual**

What the app produced, in the words and numbers on the screen. If the defect is a set of requests
or values, they go in a fenced block:

```
PATCH /api/... {"field":value}
POST  /api/...
```

**Expected**

One sentence. The rule it broke, and where that rule is already honoured if it is honoured
somewhere — "the way `view-order` already refuses it."

**Evidence**

![<alt text stating the defect>](<assetUrl>)

<a console excerpt, payload or query result, if the defect is not visible in a capture>

**RCA**

The cause in one line, with the permalink — [`file.js:168-172`](<permalink pinned to the sha>):

```js
<the four lines that are actually wrong>
```

<One short paragraph: what that code does, and what it fails to do.>

<One short paragraph, if there is a control: where the same product does it correctly.>

<One line, if it is more than one route: the others with the same defect, so the fix is scoped.>
```

Six sections, exactly these, in this order. **Actual comes before Expected** — the reader meets the
defect first, then the rule it broke. Do not merge them into "Expected vs Actual". There is no
seventh section, and none of the six is optional.

What makes this shape work, beyond the headings:

- Every section is scannable. Nothing is a wall.
- The numbers live in **Actual**, where the reader is already looking for them.
- **Evidence is two lines** — the capture and where it came from.
- The **RCA opens with the broken code**, not with a narrative leading up to it.
- Nothing about how the run was conducted appears anywhere in the ticket.

**RCA is a link, not a citation.** A permalink pinned to the sha under test, so it still points at
the right lines after the next commit. "`route.js`, line 140" makes the reader go hunting and rots
on the next commit. Get the sha from the build you tested, not from `main`.

Shape it as: the cause in one line with the link, then the code, then what it means. Front-load —
the dev is scanning for the file and the broken line, so put those first.

```markdown
The `PATCH` is scoped by `order_id` alone — [`order-overview/route.js:168-172`](<permalink>):

```js
where_clauses: [
  { column: "order_id", value: order_id }
]
```

`tenant_id` arrives in the query string and in the payload, but never reaches that WHERE.

For contrast, `view-order` does pass the tenant through, which is why it answers `{"data":[]}`
for this caller on the same page that renders the order.
```

Two traps in that example, both real:

- **Do not write a contrast as a cause.** "…never reaches the WHERE, *which is why* `view-order`
  returns `{"data":[]}`" is backwards: `view-order` returns empty because it *does* scope by tenant.
  It is the control, not the consequence. Check the direction of every "which is why" you write.
- One short paragraph per idea. A four-sentence RCA block with the cause, the contrast and the
  blast radius fused together is the same wall as a bad Evidence section.

