import { describe, expect, it } from "vitest";
import { adfToText, formatOracle, jiraTicketProvider, parseJiraIssue, parseTicketContent } from "./oracle.js";

describe("parseTicketContent", () => {
  it("uses the first markdown heading as the title", () => {
    const t = parseTicketContent("PROJ-12.md", "# Login must reject empty email\n\nAC: ...");
    expect(t.title).toBe("Login must reject empty email");
    expect(t.id).toBe("PROJ-12");
    expect(t.body).toContain("AC: ...");
  });

  it("falls back to the filename when there is no heading", () => {
    const t = parseTicketContent("notes.txt", "some acceptance criteria");
    expect(t.title).toBe("notes");
    expect(t.body).toBe("some acceptance criteria");
  });

  it("parses JSON tickets with id/summary/acceptanceCriteria", () => {
    const raw = JSON.stringify({ key: "JIRA-99", summary: "Password reset", acceptanceCriteria: "must email a link" });
    const t = parseTicketContent("ticket.json", raw);
    expect(t.id).toBe("JIRA-99");
    expect(t.title).toBe("Password reset");
    expect(t.body).toBe("must email a link");
  });

  it("falls back through description then body for JSON", () => {
    const t = parseTicketContent("t.json", JSON.stringify({ id: "X", description: "desc here" }));
    expect(t.body).toBe("desc here");
  });
});

describe("adfToText", () => {
  it("flattens ADF paragraphs and text nodes", () => {
    const adf = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "AC1: valid login works." }] },
        { type: "paragraph", content: [{ type: "text", text: "AC2: wrong password errors." }] },
      ],
    };
    const text = adfToText(adf);
    expect(text).toContain("AC1: valid login works.");
    expect(text).toContain("AC2: wrong password errors.");
    expect(text.trim().split("\n").length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty string for nullish input", () => {
    expect(adfToText(null)).toBe("");
    expect(adfToText(undefined)).toBe("");
  });
});

describe("parseJiraIssue", () => {
  it("maps key/summary and a string description", () => {
    const t = parseJiraIssue({ key: "PROJ-42", fields: { summary: "Sign-in", description: "AC1..." } });
    expect(t.id).toBe("PROJ-42");
    expect(t.title).toBe("Sign-in");
    expect(t.body).toBe("AC1...");
  });

  it("flattens an ADF description", () => {
    const t = parseJiraIssue({
      key: "PROJ-1",
      fields: { summary: "S", description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "criteria" }] }] } },
    });
    expect(t.body).toBe("criteria");
  });
});

describe("jiraTicketProvider", () => {
  it("fetches, authenticates, and maps the issue", async () => {
    let calledUrl = "";
    let authHeader = "";
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calledUrl = String(url);
      authHeader = String((init?.headers as Record<string, string>)["Authorization"]);
      return {
        ok: true,
        status: 200,
        json: async () => ({ key: "PROJ-42", fields: { summary: "Sign-in", description: "ACs here" } }),
      } as Response;
    }) as typeof fetch;

    const provider = jiraTicketProvider({
      baseUrl: "https://acme.atlassian.net/",
      email: "me@acme.com",
      token: "secret",
      fetch: fakeFetch,
    });
    const ticket = await provider.load("PROJ-42");

    expect(calledUrl).toBe("https://acme.atlassian.net/rest/api/3/issue/PROJ-42?fields=summary,description");
    expect(authHeader).toMatch(/^Basic /);
    expect(ticket.title).toBe("Sign-in");
  });

  it("throws on a non-OK response", async () => {
    const fakeFetch = (async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response) as typeof fetch;
    const provider = jiraTicketProvider({ baseUrl: "https://x.atlassian.net", email: "e", token: "t", fetch: fakeFetch });
    await expect(provider.load("NOPE-1")).rejects.toThrow(/HTTP 404/);
  });
});

describe("formatOracle", () => {
  it("embeds the ticket and instructs testing against it, not the app", () => {
    const block = formatOracle({ id: "PROJ-1", title: "T", body: "AC1; AC2" });
    expect(block).toContain("ticket PROJ-1");
    expect(block).toContain("AC1; AC2");
    expect(block).toMatch(/NOT against whatever the app currently does/i);
  });
});
