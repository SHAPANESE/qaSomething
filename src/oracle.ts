import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The oracle problem: "what is correct?" Answer, per the design decision:
 * expected behavior derives from a TICKET's acceptance criteria — not from
 * observing the running app (which would just freeze current bugs as truth).
 *
 * The provider is pluggable so a Jira/GitHub source can slot in later; the MVP
 * reads a ticket from a local file (markdown, text, or JSON).
 */

export interface Ticket {
  id: string;
  title: string;
  body: string;
}

export interface TicketProvider {
  load(ref: string): Promise<Ticket>;
}

/** Pure: parse ticket file contents into a Ticket. */
export function parseTicketContent(ref: string, raw: string): Ticket {
  const base = path.basename(ref).replace(/\.[^.]+$/, "");
  const trimmed = raw.trim();

  if (ref.endsWith(".json")) {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const id = typeof data["id"] === "string" ? data["id"] : typeof data["key"] === "string" ? data["key"] : base;
    const title = typeof data["title"] === "string" ? data["title"] : typeof data["summary"] === "string" ? data["summary"] : id;
    const body =
      typeof data["acceptanceCriteria"] === "string"
        ? data["acceptanceCriteria"]
        : typeof data["description"] === "string"
          ? data["description"]
          : typeof data["body"] === "string"
            ? data["body"]
            : trimmed;
    return { id, title, body };
  }

  const headingMatch = trimmed.match(/^#\s+(.+)$/m);
  const title = headingMatch ? (headingMatch[1] ?? base).trim() : base;
  return { id: base, title, body: trimmed };
}

export const fileTicketProvider: TicketProvider = {
  async load(ref) {
    const raw = await readFile(ref, "utf8");
    return parseTicketContent(ref, raw);
  },
};

/** The oracle block injected into the mission so the agent tests against the ticket. */
export function formatOracle(ticket: Ticket): string {
  return `## Source of truth — ticket ${ticket.id}

Title: ${ticket.title}

The EXPECTED behavior is defined by this ticket's acceptance criteria. Test against
what the ticket says should happen — NOT against whatever the app currently does
(the app may be buggy; observing it and asserting that is how bugs get frozen as
"correct"). Where the ticket is silent on a case, flag it as a finding instead of
assuming the current behavior is intended.

--- ticket ---
${ticket.body}
--- end ticket ---`;
}
