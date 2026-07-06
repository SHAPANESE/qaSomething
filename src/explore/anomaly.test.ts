import { describe, expect, it } from "vitest";
import { classifyAnomalies, type BrowserEvent } from "./anomaly.js";

describe("classifyAnomalies", () => {
  it("flags page errors as high severity", () => {
    const a = classifyAnomalies([{ type: "pageerror", message: "TypeError: x is undefined" }]);
    expect(a).toEqual([{ kind: "page-error", severity: "high", detail: "TypeError: x is undefined" }]);
  });

  it("flags console errors, escalating uncaught ones", () => {
    const a = classifyAnomalies([
      { type: "console", level: "error", text: "login failed" },
      { type: "console", level: "error", text: "Uncaught TypeError" },
    ]);
    expect(a.find((x) => x.detail === "Uncaught TypeError")?.severity).toBe("high");
    expect(a.find((x) => x.detail === "login failed")?.severity).toBe("medium");
  });

  it("ignores non-error console output", () => {
    expect(classifyAnomalies([{ type: "console", level: "warning", text: "meh" }])).toEqual([]);
  });

  it("flags 5xx but NOT 4xx (an expected 401 is not a bug)", () => {
    const a = classifyAnomalies([
      { type: "response", url: "/api/login", status: 401, ms: 10 },
      { type: "response", url: "/api/x", status: 500, ms: 10 },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "http-server-error", detail: "500 /api/x" });
  });

  it("flags failed requests and slow responses", () => {
    const events: BrowserEvent[] = [
      { type: "requestfailed", url: "/api/y", failure: "net::ERR_CONNECTION_REFUSED" },
      { type: "response", url: "/slow", status: 200, ms: 5000 },
    ];
    const a = classifyAnomalies(events, { slowMs: 3000 });
    expect(a.map((x) => x.kind)).toContain("request-failed");
    expect(a.map((x) => x.kind)).toContain("slow-response");
  });

  it("de-duplicates repeated anomalies and ranks by severity", () => {
    const a = classifyAnomalies([
      { type: "response", url: "/slow", status: 200, ms: 9000 },
      { type: "console", level: "error", text: "boom" },
      { type: "console", level: "error", text: "boom" },
    ]);
    expect(a).toHaveLength(2); // duplicate console error collapsed
    expect(a[0]?.severity).toBe("medium"); // console error ranked above slow (low)
    expect(a[1]?.severity).toBe("low");
  });

  it("ignores the browser's 'Failed to load resource' echo of an HTTP status", () => {
    // The browser auto-logs this for a 401; the response channel already judges it.
    const a = classifyAnomalies([
      {
        type: "console",
        level: "error",
        text: "Failed to load resource: the server responded with a status of 401 (Unauthorized)",
      },
    ]);
    expect(a).toEqual([]);
  });

  it("returns nothing for a clean run", () => {
    expect(classifyAnomalies([{ type: "response", url: "/ok", status: 200, ms: 50 }])).toEqual([]);
  });
});
