/**
 * Stable test-case IDs: `TC-<TICKET>-NN`. One id threads a case through
 * plan → spec → run → bug — the traceability backbone of the casebook.
 */

const CASE_ID_RE = /^TC-(.+)-(\d{2,})$/;

function slugify(ticketId: string): string {
  return ticketId
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function makeCaseId(ticketId: string, n: number): string {
  return `TC-${slugify(ticketId)}-${String(n).padStart(2, "0")}`;
}

export interface ParsedCaseId {
  ticket: string;
  n: number;
}

export function parseCaseId(id: string): ParsedCaseId | null {
  const m = id.match(CASE_ID_RE);
  if (!m) return null;
  return { ticket: m[1]!, n: Number.parseInt(m[2]!, 10) };
}

/** Next free case number for a ticket, given the ids already in the casebook. */
export function nextCaseNumber(existing: string[], ticketId: string): number {
  const slug = slugify(ticketId);
  let max = 0;
  for (const id of existing) {
    const parsed = parseCaseId(id);
    if (parsed && parsed.ticket === slug) max = Math.max(max, parsed.n);
  }
  return max + 1;
}
