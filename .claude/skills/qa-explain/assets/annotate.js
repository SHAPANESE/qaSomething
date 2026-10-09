// Injected into the live page with Playwright MCP `browser_evaluate`.
// Draws the numbered orange overlay + the legend panel, then returns a report of
// what it ACTUALLY marked. Read that report before you narrate anything: if a
// mark reports `found: false`, the number in your legend points at nothing.
//
// Edit only the CONFIG block. Everything below it is fixed.
//
// Call it as one self-contained function — do not try to keep state between
// screens, a navigation wipes it.

() => {
  // ======================= CONFIG — edit this per screen =======================
  const CONFIG = {
    title: 'Screen 1 - Order review',
    marks: [
      // { sel: '<css>' }            first match of a CSS selector
      // { text: '<visible text>' }  deepest element containing that text
      // { sel: '...', nth: 2 }      the 3rd match (0-indexed)
      { text: 'Order review' },
      { text: 'Needs attention' },
    ],
    // One line per mark, in order. Same count as marks[].
    notes: [
      'Queue of orders to review before they ship.',
      'NOT a status. It is a cross-cutting list.',
    ],
    // Extra lines with no box on screen. Optional.
    extra: [],
  };
  // ============================================================================

  const ORANGE = '#ea580c';
  const ID = 'qa-explain-overlay';

  document.getElementById(ID)?.remove();

  const layer = document.createElement('div');
  layer.id = ID;
  layer.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;' +
    'font:400 13px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif';
  document.body.appendChild(layer);

  const deepestWithText = (needle) => {
    const n = needle.toLowerCase();
    const hits = [...document.querySelectorAll('body *')].filter((el) => {
      if (layer.contains(el)) return false;
      const t = (el.innerText || el.textContent || '').trim();
      if (!t || !t.toLowerCase().includes(n)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)))[0] || null;
  };

  const report = [];

  CONFIG.marks.forEach((m, i) => {
    const num = i + 1;
    let el = null;
    if (m.sel) {
      const all = [...document.querySelectorAll(m.sel)];
      el = all[m.nth || 0] || null;
    } else if (m.text) {
      el = deepestWithText(m.text);
    }

    if (!el) {
      report.push({ n: num, target: m.sel || m.text, found: false });
      return;
    }

    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) {
      report.push({ n: num, target: m.sel || m.text, found: true, visible: false });
      return;
    }

    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;box-sizing:border-box;border:2px solid ' + ORANGE + ';' +
      'border-radius:6px;pointer-events:none;' +
      'left:' + (r.left - 3) + 'px;top:' + (r.top - 3) + 'px;' +
      'width:' + (r.width + 6) + 'px;height:' + (r.height + 6) + 'px';

    const badge = document.createElement('div');
    badge.textContent = num;
    badge.style.cssText =
      'position:fixed;width:22px;height:22px;border-radius:50%;background:' + ORANGE + ';' +
      'color:#fff;font:700 12px/22px ui-sans-serif,system-ui,sans-serif;text-align:center;' +
      'box-shadow:0 1px 4px rgba(0,0,0,.35);pointer-events:none;' +
      'left:' + (r.left - 14) + 'px;top:' + (r.top - 14) + 'px';

    layer.appendChild(box);
    layer.appendChild(badge);
    report.push({
      n: num,
      target: m.sel || m.text,
      found: true,
      visible: true,
      text: (el.innerText || el.textContent || '').trim().slice(0, 70),
      tag: el.tagName.toLowerCase(),
    });
  });

  // ---- legend -------------------------------------------------------------
  const legend = document.createElement('div');
  legend.style.cssText =
    'position:fixed;left:24px;right:24px;bottom:18px;background:#fff;' +
    'border:2px solid ' + ORANGE + ';border-radius:8px;padding:14px 18px;' +
    'box-shadow:0 4px 18px rgba(0,0,0,.18);pointer-events:none;color:#1a1a1a';

  const h = document.createElement('div');
  h.textContent = CONFIG.title;
  h.style.cssText = 'color:' + ORANGE + ';font-weight:700;margin-bottom:8px';
  legend.appendChild(h);

  CONFIG.notes.forEach((t, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'margin:3px 0';
    row.innerHTML = '<b>' + (i + 1) + '.</b> ';
    row.appendChild(document.createTextNode(t));
    legend.appendChild(row);
  });
  (CONFIG.extra || []).forEach((t) => {
    const row = document.createElement('div');
    row.style.cssText = 'margin:3px 0;color:#555';
    row.textContent = t;
    legend.appendChild(row);
  });

  layer.appendChild(legend);

  return JSON.stringify(
    {
      title: CONFIG.title,
      marks: report,
      missing: report.filter((r) => !r.found || r.visible === false).map((r) => r.n),
      noteCount: CONFIG.notes.length,
      markCount: CONFIG.marks.length,
      mismatch: CONFIG.notes.length !== CONFIG.marks.length,
    },
    null,
    2
  );
}
