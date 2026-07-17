import { execa } from "execa";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { looksInconclusive } from "../verify.js";
import type { CaseOutcome } from "../casebook/run.js";

/**
 * Contract testing via Schemathesis — the API-layer analogue of the Playwright
 * trust gates. The OpenAPI/GraphQL spec is the oracle: Schemathesis generates
 * inputs from it and checks the running API upholds its own contract. A
 * violation (a 500, a response that breaks the response schema, or invalid data
 * the API wrongly accepts) is a FINDING, exactly like a failing UI assertion.
 *
 * Design mirrors verify.ts: pure parse/interpret functions plus an injectable
 * runner, so the mapping logic is unit-tested without invoking the tool.
 */

/** Checks enabled by default. `negative_data_rejection` is NOT on by default in
 * Schemathesis, but it is the one that catches an API under-enforcing its own
 * contract (e.g. accepting a value past a declared maxLength) — so we opt in. */
export const DEFAULT_CHECKS = [
  "not_a_server_error",
  "status_code_conformance",
  "content_type_conformance",
  "response_schema_conformance",
  "negative_data_rejection",
] as const;

export type GenerationMode = "positive" | "negative" | "all";

export interface SchemathesisOptions {
  /** Path to the OpenAPI/GraphQL schema (the contract). */
  spec: string;
  /** Base URL of the running API under test. */
  url: string;
  checks?: readonly string[];
  mode?: GenerationMode;
  maxExamples?: number;
  /** Directory Schemathesis writes its JUnit report into (default runner only). */
  reportDir?: string;
}

/** One contract violation Schemathesis found on an operation. */
export interface ContractCheckFailure {
  /** The API operation, e.g. "POST /api/tasks". */
  operation: string;
  /** The Schemathesis check that failed, e.g. "Response violates schema". */
  check: string;
  /** A concise, human-readable headline for the violation. */
  message: string;
  /** A curl command that reproduces the failing request, when present. */
  curl?: string;
  /** The full (entity-unescaped) failure body — evidence for a bug report. */
  detail: string;
}

export interface ContractOperationResult {
  operation: string;
  failures: ContractCheckFailure[];
}

export interface SchemathesisReport {
  tests: number;
  failures: number;
  errors: number;
  skipped: number;
  operations: ContractOperationResult[];
}

export interface ContractRunResult {
  /** True only when operations were actually tested and none violated the contract. */
  passed: boolean;
  exitCode: number | null;
  report: SchemathesisReport | null;
  /** Every violation across all operations, flattened. */
  failures: ContractCheckFailure[];
  output: string;
  /** True when the run couldn't produce a meaningful result (tool/schema/env problem). */
  inconclusive?: boolean;
}

/** Env/schema failures that make a contract run inconclusive rather than "failed". */
const SCHEMATHESIS_INCONCLUSIVE: RegExp[] = [
  /No API operations/i,
  /Failed to load|Could not load schema|schema.*not found/i,
  /ECONNREFUSED|Connection refused/i,
  /Failed to connect|Max retries exceeded/i,
];

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function intAttr(openingTag: string, name: string): number {
  const m = new RegExp(`\\b${name}="(\\d+)"`).exec(openingTag);
  return m ? Number.parseInt(m[1] ?? "0", 10) : 0;
}

/** Pure: parse a single `<failure>` body into a structured violation. */
function parseFailure(operation: string, rawBody: string): ContractCheckFailure {
  const body = unescapeXml(rawBody).replace(/\r\n/g, "\n").trim();
  const lines = body.split("\n");

  let check = "unknown check";
  let checkLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^- (.+)$/.exec((lines[i] ?? "").trim());
    if (m) {
      check = (m[1] ?? "").trim();
      checkLineIdx = i;
      break;
    }
  }

  // Prefer the "Invalid component:" line (the precise field/constraint) as the
  // headline; otherwise the first non-empty detail line after the check name.
  const componentLine = lines.map((l) => l.trim()).find((l) => l.startsWith("Invalid component:"));
  let message = "";
  if (componentLine) {
    message = componentLine.slice("Invalid component:".length).trim();
  } else {
    for (let i = checkLineIdx + 1; i < lines.length; i++) {
      const t = (lines[i] ?? "").trim();
      if (t) {
        message = t;
        break;
      }
    }
  }

  const curl = lines.map((l) => l.trim()).find((l) => l.startsWith("curl "));
  return { operation, check, message, detail: body, ...(curl ? { curl } : {}) };
}

// Match a <testcase …>…</testcase> block, or a self-closing <testcase …/>.
const TESTCASE_RE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
const FAILURE_RE = /<failure\b[^>]*>([\s\S]*?)<\/failure>/g;
const NAME_RE = /\bname="([^"]*)"/;

/**
 * Pure: parse Schemathesis's JUnit XML into a structured report. The format is
 * simple and single-producer, so a small regex parser is enough — no XML
 * dependency (matching this repo's dependency-free parsing style).
 */
export function parseSchemathesisJunit(xml: string): SchemathesisReport {
  const suitesTag = /<testsuites\b[^>]*>/.exec(xml)?.[0] ?? "";
  const operations: ContractOperationResult[] = [];

  for (const tc of xml.matchAll(TESTCASE_RE)) {
    const attrs = tc[1] ?? "";
    const inner = tc[2] ?? "";
    const operation = NAME_RE.exec(attrs)?.[1] ?? "(unknown operation)";
    const failures: ContractCheckFailure[] = [];
    for (const fail of inner.matchAll(FAILURE_RE)) {
      failures.push(parseFailure(operation, fail[1] ?? ""));
    }
    operations.push({ operation, failures });
  }

  return {
    tests: intAttr(suitesTag, "tests"),
    failures: intAttr(suitesTag, "failures"),
    errors: intAttr(suitesTag, "errors"),
    skipped: intAttr(suitesTag, "skipped"),
    operations,
  };
}

/**
 * Pure: turn a raw Schemathesis process result into a structured verdict.
 *
 * A vacuous contract that exercised NO operations is inconclusive, never a pass
 * — the API-layer analogue of a hollow test. So is a missing report or an
 * environment/tool failure (mirrors verify.ts's inconclusive handling).
 */
export function interpretContractRun(
  exitCode: number | null,
  output: string,
  junitXml: string | null,
): ContractRunResult {
  const report = junitXml ? parseSchemathesisJunit(junitXml) : null;
  const inconclusive =
    looksInconclusive(output, exitCode) ||
    SCHEMATHESIS_INCONCLUSIVE.some((re) => re.test(output)) ||
    report === null ||
    report.tests === 0;

  const failures = report ? report.operations.flatMap((o) => o.failures) : [];
  const passed = !inconclusive && report !== null && failures.length === 0 && report.tests > 0;

  return {
    passed,
    exitCode,
    report,
    failures,
    output,
    ...(inconclusive ? { inconclusive: true } : {}),
  };
}

/** Pure: assemble the `schemathesis` CLI argv. Never interpolates into a shell. */
export function buildSchemathesisArgs(opts: SchemathesisOptions): string[] {
  const checks = opts.checks && opts.checks.length > 0 ? opts.checks : DEFAULT_CHECKS;
  const mode = opts.mode ?? "all";
  const maxExamples = opts.maxExamples ?? 50;
  const args = [
    "run",
    opts.spec,
    "--url",
    opts.url,
    "--checks",
    checks.join(","),
    "--mode",
    mode,
    "--max-examples",
    String(maxExamples),
  ];
  if (opts.reportDir) args.push("--report", "junit", "--report-dir", opts.reportDir);
  return args;
}

/** Signature so the runner can be faked in tests and swapped for CI. */
export type ContractRunner = (
  opts: SchemathesisOptions,
) => Promise<{ exitCode: number | null; output: string; junitXml: string | null }>;

/** Orchestrate a contract run: invoke the (injected) runner, then interpret. */
export async function runContract(
  opts: SchemathesisOptions,
  runner: ContractRunner,
): Promise<ContractRunResult> {
  const { exitCode, output, junitXml } = await runner(opts);
  return interpretContractRun(exitCode, output, junitXml);
}

export interface ContractOperationJson {
  operation: string;
  outcome: CaseOutcome;
  failures: { check: string; message: string; curl?: string }[];
}

export interface ContractResultJson {
  passed: boolean;
  inconclusive: boolean;
  operations: ContractOperationJson[];
}

/** Pure: a machine-readable shape for CI / the qa-run skill to consume. */
export function contractResultToJson(r: ContractRunResult): ContractResultJson {
  const inconclusive = r.inconclusive === true;
  const operations: ContractOperationJson[] = (r.report?.operations ?? []).map((op) => ({
    operation: op.operation,
    outcome: inconclusive ? "inconclusive" : op.failures.length > 0 ? "fail" : "pass",
    failures: op.failures.map((f) => ({
      check: f.check,
      message: f.message,
      ...(f.curl ? { curl: f.curl } : {}),
    })),
  }));
  return { passed: r.passed, inconclusive, operations };
}

/**
 * Default runner: shell out to Schemathesis via `uvx` (zero-install) — override
 * the binary with `SCHEMATHESIS_BIN` (e.g. "schemathesis" when it's on PATH).
 * `PYTHONUTF8=1` avoids a Windows cp1252 crash on Schemathesis's Unicode header.
 * The JUnit report is written to a temp dir and read back — more robust than
 * scraping human stdout.
 */
export function schemathesisRunner(cwd: string, timeoutMs: number): ContractRunner {
  return async (opts) => {
    const dir = await mkdtemp(path.join(tmpdir(), "st-junit-"));
    const binSpec = process.env["SCHEMATHESIS_BIN"];
    const [cmd, ...preArgs] = binSpec ? binSpec.split(" ") : ["uvx", "schemathesis"];
    const args = [...preArgs, ...buildSchemathesisArgs({ ...opts, reportDir: dir })];
    try {
      const res = await execa(cmd ?? "uvx", args, {
        cwd,
        timeout: timeoutMs,
        reject: false,
        env: { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
        maxBuffer: 64 * 1024 * 1024,
      });
      const output = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
      let junitXml: string | null = null;
      try {
        const xmlFile = (await readdir(dir)).find((f) => f.endsWith(".xml"));
        if (xmlFile) junitXml = await readFile(path.join(dir, xmlFile), "utf8");
      } catch {
        /* no report produced — interpret() will mark it inconclusive */
      }
      return { exitCode: typeof res.exitCode === "number" ? res.exitCode : null, output, junitXml };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
