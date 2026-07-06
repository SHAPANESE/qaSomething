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

// --- Jira provider (Cloud REST v3) ---------------------------------------

export interface JiraConfig {
  /** e.g. https://your-domain.atlassian.net */
  baseUrl: string;
  email: string;
  token: string;
  /** Injectable for testing; defaults to global fetch. */
  fetch?: typeof fetch;
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: unknown[];
}

const ADF_BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "bulletList", "orderedList", "codeBlock"]);

/** Pure: flatten Atlassian Document Format (Jira's rich description) to plain text. */
export function adfToText(node: unknown): string {
  if (node === null || typeof node !== "object") return "";
  const n = node as AdfNode;
  if (typeof n.text === "string") return n.text;
  const inner = Array.isArray(n.content) ? n.content.map(adfToText).join("") : "";
  return ADF_BLOCK_TYPES.has(n.type ?? "") ? inner + "\n" : inner;
}

/** Pure: map a Jira issue payload to a Ticket. */
export function parseJiraIssue(data: unknown): Ticket {
  const issue = (data ?? {}) as { key?: string; fields?: Record<string, unknown> };
  const key = typeof issue.key === "string" ? issue.key : "JIRA";
  const fields = issue.fields ?? {};
  const title = typeof fields["summary"] === "string" ? fields["summary"] : key;
  const description = fields["description"];
  const body = typeof description === "string" ? description : adfToText(description);
  return { id: key, title, body: body.trim() };
}

export function jiraTicketProvider(cfg: JiraConfig): TicketProvider {
  const doFetch = cfg.fetch ?? fetch;
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  const base = cfg.baseUrl.replace(/\/$/, "");
  return {
    async load(ref) {
      const url = `${base}/rest/api/3/issue/${encodeURIComponent(ref)}?fields=summary,description`;
      const res = await doFetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Jira ${ref}: HTTP ${res.status}`);
      return parseJiraIssue(await res.json());
    },
  };
}

/** Build a Jira provider from env vars, or null if they're not all set. */
export function jiraProviderFromEnv(env: NodeJS.ProcessEnv): TicketProvider | null {
  const baseUrl = env["JIRA_BASE_URL"];
  const email = env["JIRA_EMAIL"];
  const token = env["JIRA_API_TOKEN"];
  if (!baseUrl || !email || !token) return null;
  return jiraTicketProvider({ baseUrl, email, token });
}

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
