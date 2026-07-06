import { describe, expect, it } from "vitest";
import { formatOracle, parseTicketContent } from "./oracle.js";

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

describe("formatOracle", () => {
  it("embeds the ticket and instructs testing against it, not the app", () => {
    const block = formatOracle({ id: "PROJ-1", title: "T", body: "AC1; AC2" });
    expect(block).toContain("ticket PROJ-1");
    expect(block).toContain("AC1; AC2");
    expect(block).toMatch(/NOT against whatever the app currently does/i);
  });
});
