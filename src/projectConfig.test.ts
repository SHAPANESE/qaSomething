import { describe, expect, it } from "vitest";
import { parseProjectConfig } from "./projectConfig.js";

describe("parseProjectConfig", () => {
  it("accepts a valid config", () => {
    const cfg = parseProjectConfig(
      JSON.stringify({ reruns: 5, baseUrl: "http://localhost:3000", startCommand: "npm run dev" }),
    );
    expect(cfg).toEqual({ reruns: 5, baseUrl: "http://localhost:3000", startCommand: "npm run dev" });
  });

  it("accepts an empty config", () => {
    expect(parseProjectConfig("{}")).toEqual({});
  });

  it("rejects invalid JSON with a clear message", () => {
    expect(() => parseProjectConfig("{ not json")).toThrow(/not valid JSON/i);
  });

  it("rejects a wrong type", () => {
    expect(() => parseProjectConfig(JSON.stringify({ reruns: "three" }))).toThrow(/reruns/);
  });

  it("rejects a non-positive rerun count", () => {
    expect(() => parseProjectConfig(JSON.stringify({ reruns: 0 }))).toThrow(/reruns/);
  });

  it("rejects unknown keys (catches typos)", () => {
    expect(() => parseProjectConfig(JSON.stringify({ rerunz: 3 }))).toThrow(/rerunz|unrecognized/i);
  });
});
