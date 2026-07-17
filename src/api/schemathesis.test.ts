import { describe, it, expect } from "vitest";
import {
  parseSchemathesisJunit,
  interpretContractRun,
  buildSchemathesisArgs,
  contractResultToJson,
  runContract,
  DEFAULT_CHECKS,
  type ContractRunner,
} from "./schemathesis.js";

// A real Schemathesis v4 JUnit report for the AC3 boundary bug (task-app fixture):
// the server accepts a title longer than the contract's maxLength.
const JUNIT_BOUNDARY = `<?xml version="1.0" encoding="utf-8"?>
<testsuites errors="0" failures="1" skipped="0" tests="1" time="0.84">
  <testsuite name="schemathesis" errors="0" failures="1" skipped="0" tests="1" time="0.84">
    <testcase name="POST /api/tasks" time="0.84">
      <failure type="failure">1. Test Case ID: qknRec

- API accepted schema-violating request

    Invalid data should have been rejected
    Expected: 400, 401, 403, 404, 405, 406, 409, 422, 428, 5xx
    Invalid component: in body - title: String larger than maxLength

[201] Created:

    \`{&quot;ok&quot;:true,&quot;task&quot;:{&quot;title&quot;:&quot;000&quot;}}\`

Reproduce with:

    curl -X POST -H 'Content-Type: application/json' -d '{"title": "000"}' http://localhost:3200/api/tasks</failure>
    </testcase>
  </testsuite>
</testsuites>`;

// A passing report: one operation tested, no failures.
const JUNIT_PASS = `<?xml version="1.0" encoding="utf-8"?>
<testsuites errors="0" failures="0" skipped="0" tests="1" time="0.5">
  <testsuite name="schemathesis" errors="0" failures="0" skipped="0" tests="1" time="0.5">
    <testcase name="POST /api/tasks" time="0.5"></testcase>
  </testsuite>
</testsuites>`;

// A vacuous report: nothing was tested (schema failed to select any operation).
const JUNIT_EMPTY = `<?xml version="1.0" encoding="utf-8"?>
<testsuites errors="0" failures="0" skipped="0" tests="0" time="0">
  <testsuite name="schemathesis" errors="0" failures="0" skipped="0" tests="0" time="0"></testsuite>
</testsuites>`;

// Two distinct check failures on the same operation.
const JUNIT_TWO = `<?xml version="1.0" encoding="utf-8"?>
<testsuites errors="0" failures="1" skipped="0" tests="1" time="1.3">
  <testsuite name="schemathesis" errors="0" failures="1" skipped="0" tests="1" time="1.3">
    <testcase name="POST /api/tasks" time="1.3">
      <failure type="failure">1. Test Case ID: HPkvxk

- Unsupported methods

    Unsupported method TRACE returned 404, expected 405 Method Not Allowed

Reproduce with:

    curl -X TRACE http://localhost:3200/api/tasks</failure>
      <failure type="failure">1. Test Case ID: ej3hYX

- Response violates schema

    &quot;bogus&quot; is not one of &quot;low&quot;, &quot;medium&quot; or &quot;high&quot;

Reproduce with:

    curl -X POST http://localhost:3200/api/tasks</failure>
    </testcase>
  </testsuite>
</testsuites>`;

describe("parseSchemathesisJunit", () => {
  it("extracts operation, check name, message and curl from a failure", () => {
    const report = parseSchemathesisJunit(JUNIT_BOUNDARY);
    expect(report.tests).toBe(1);
    expect(report.failures).toBe(1);
    expect(report.operations).toHaveLength(1);
    const op = report.operations[0]!;
    expect(op.operation).toBe("POST /api/tasks");
    expect(op.failures).toHaveLength(1);
    const f = op.failures[0]!;
    expect(f.check).toBe("API accepted schema-violating request");
    expect(f.message).toBe("in body - title: String larger than maxLength");
    expect(f.curl).toContain(`curl -X POST`);
  });

  it("unescapes XML entities in the detail", () => {
    const report = parseSchemathesisJunit(JUNIT_BOUNDARY);
    expect(report.operations[0]!.failures[0]!.detail).toContain(`"title":"000"`);
    expect(report.operations[0]!.failures[0]!.detail).not.toContain("&quot;");
  });

  it("reads a passing report with no failures", () => {
    const report = parseSchemathesisJunit(JUNIT_PASS);
    expect(report.tests).toBe(1);
    expect(report.failures).toBe(0);
    expect(report.operations[0]!.failures).toHaveLength(0);
  });

  it("reads a vacuous report as zero tested operations", () => {
    const report = parseSchemathesisJunit(JUNIT_EMPTY);
    expect(report.tests).toBe(0);
    expect(report.operations).toHaveLength(0);
  });

  it("collects multiple failures on one operation", () => {
    const report = parseSchemathesisJunit(JUNIT_TWO);
    const op = report.operations[0]!;
    expect(op.failures).toHaveLength(2);
    expect(op.failures.map((f) => f.check)).toEqual(["Unsupported methods", "Response violates schema"]);
  });
});

describe("interpretContractRun", () => {
  it("marks a run with contract violations as failed (not inconclusive)", () => {
    const r = interpretContractRun(1, "1 failure", JUNIT_BOUNDARY);
    expect(r.passed).toBe(false);
    expect(r.inconclusive).toBeUndefined();
    expect(r.failures).toHaveLength(1);
  });

  it("marks a clean run over tested operations as passed", () => {
    const r = interpretContractRun(0, "No failures", JUNIT_PASS);
    expect(r.passed).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("treats a vacuous contract (0 operations tested) as inconclusive, not a pass", () => {
    const r = interpretContractRun(0, "", JUNIT_EMPTY);
    expect(r.passed).toBe(false);
    expect(r.inconclusive).toBe(true);
  });

  it("treats a missing report as inconclusive", () => {
    const r = interpretContractRun(0, "some noise", null);
    expect(r.inconclusive).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("treats a tool-not-found / env failure as inconclusive", () => {
    const r = interpretContractRun(127, "uvx: command not found", null);
    expect(r.inconclusive).toBe(true);
  });
});

describe("buildSchemathesisArgs", () => {
  it("builds a run command with defaults", () => {
    const args = buildSchemathesisArgs({ spec: "openapi.yaml", url: "http://localhost:3200" });
    expect(args.slice(0, 4)).toEqual(["run", "openapi.yaml", "--url", "http://localhost:3200"]);
    expect(args).toContain("--checks");
    expect(args).toContain(DEFAULT_CHECKS.join(","));
    expect(args).toContain("--mode");
    expect(args).toContain("all");
  });

  it("honors explicit checks, mode, max-examples and report dir", () => {
    const args = buildSchemathesisArgs({
      spec: "s.yaml",
      url: "http://x",
      checks: ["negative_data_rejection"],
      mode: "negative",
      maxExamples: 80,
      reportDir: "/tmp/r",
    });
    expect(args).toContain("negative_data_rejection");
    expect(args[args.indexOf("--mode") + 1]).toBe("negative");
    expect(args[args.indexOf("--max-examples") + 1]).toBe("80");
    expect(args).toContain("--report");
    expect(args[args.indexOf("--report-dir") + 1]).toBe("/tmp/r");
  });
});

describe("runContract + contractResultToJson", () => {
  it("runs via an injected runner and maps operations to outcomes", async () => {
    const runner: ContractRunner = async () => ({
      exitCode: 1,
      output: "1 failure",
      junitXml: JUNIT_BOUNDARY,
    });
    const result = await runContract({ spec: "openapi.yaml", url: "http://localhost:3200" }, runner);
    const json = contractResultToJson(result);
    expect(json.passed).toBe(false);
    expect(json.operations).toHaveLength(1);
    expect(json.operations[0]!.outcome).toBe("fail");
    expect(json.operations[0]!.failures[0]!.check).toBe("API accepted schema-violating request");
  });

  it("maps a clean run to a passing outcome", async () => {
    const runner: ContractRunner = async () => ({ exitCode: 0, output: "", junitXml: JUNIT_PASS });
    const result = await runContract({ spec: "openapi.yaml", url: "http://x" }, runner);
    const json = contractResultToJson(result);
    expect(json.passed).toBe(true);
    expect(json.operations[0]!.outcome).toBe("pass");
  });
});
