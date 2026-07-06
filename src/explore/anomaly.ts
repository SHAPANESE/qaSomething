/**
 * Perception layer for exploratory testing: turn raw browser events into ranked
 * anomalies. You can't be curious about what you can't see — this is what lets an
 * exploratory agent notice "that's weird" instead of walking past it.
 *
 * Pure and conservative on purpose: only genuine smells (5xx, network failures,
 * console/page errors) become anomalies. A 4xx is NOT flagged — an expected 401
 * on a bad login would otherwise make this a false-positive generator.
 */

export interface ConsoleEvent {
  type: "console";
  level: string;
  text: string;
}
export interface PageErrorEvent {
  type: "pageerror";
  message: string;
}
export interface ResponseEvent {
  type: "response";
  url: string;
  status: number;
  ms: number;
}
export interface RequestFailedEvent {
  type: "requestfailed";
  url: string;
  failure: string;
}
export type BrowserEvent = ConsoleEvent | PageErrorEvent | ResponseEvent | RequestFailedEvent;

export type AnomalyKind =
  "page-error" | "console-error" | "http-server-error" | "request-failed" | "slow-response";

export type Severity = "high" | "medium" | "low";

export interface Anomaly {
  kind: AnomalyKind;
  severity: Severity;
  detail: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * The browser auto-logs "Failed to load resource: ... status of 4xx/5xx" as a
 * console error. That just echoes the HTTP response, which we already judge on
 * the response channel (where we correctly ignore expected 4xx). Filtering it
 * here avoids double-counting and, worse, flagging an expected 401 as a smell.
 */
function isNetworkEcho(text: string): boolean {
  return /failed to load resource/i.test(text);
}

export interface ClassifyOptions {
  /** Responses slower than this (ms) are flagged as a low-severity anomaly. */
  slowMs?: number;
}

/** Pure: classify a batch of browser events into ranked, de-duplicated anomalies. */
export function classifyAnomalies(events: BrowserEvent[], opts: ClassifyOptions = {}): Anomaly[] {
  const slowMs = opts.slowMs ?? 3000;
  const found: Anomaly[] = [];

  for (const e of events) {
    switch (e.type) {
      case "pageerror":
        found.push({ kind: "page-error", severity: "high", detail: e.message });
        break;
      case "console":
        if (e.level.toLowerCase() === "error" && !isNetworkEcho(e.text)) {
          const uncaught = /uncaught|unhandled/i.test(e.text);
          found.push({ kind: "console-error", severity: uncaught ? "high" : "medium", detail: e.text });
        }
        break;
      case "response":
        if (e.status >= 500) {
          found.push({ kind: "http-server-error", severity: "high", detail: `${e.status} ${e.url}` });
        } else if (e.ms > slowMs) {
          found.push({ kind: "slow-response", severity: "low", detail: `${Math.round(e.ms)}ms ${e.url}` });
        }
        break;
      case "requestfailed":
        found.push({ kind: "request-failed", severity: "high", detail: `${e.url} (${e.failure})` });
        break;
    }
  }

  // De-duplicate identical anomalies (a repeated console error is one smell).
  const seen = new Set<string>();
  const unique = found.filter((a) => {
    const key = `${a.kind}|${a.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
