import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { execa } from "execa";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initializeProject } from "./init.js";

describe("initializeProject", () => {
  it("creates safe config, starter task, and optional auth state", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-init-"));
    const auth = path.join(repoPath, "auth-source.json");
    await writeFile(auth, '{"cookies":[]}');
    const result = await initializeProject({
      repoPath,
      baseUrl: "http://localhost:3000",
      startCommand: "npm run dev",
      authFile: auth,
    });
    const config = JSON.parse(await readFile(result.configFile, "utf8"));
    const task = JSON.parse(await readFile(result.taskFile, "utf8"));
    expect(config.allowedWriteDirs).toContain(".qa-agent");
    expect(task.safety.deny).toContain("payment");
    expect(await readFile(result.authFile!, "utf8")).toContain("cookies");
    await execa("git", ["init", "-q"], { cwd: repoPath });
    const ignored = await execa("git", ["check-ignore", "-q", result.authFile!], {
      cwd: repoPath,
      reject: false,
    });
    expect(ignored.exitCode).toBe(0);
  });

  it("refuses to overwrite existing configuration", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-init-"));
    await writeFile(path.join(repoPath, "qa-agent.config.json"), "{}");
    await expect(initializeProject({ repoPath, baseUrl: "http://localhost:3000" })).rejects.toThrow(
      /Refusing to overwrite/,
    );
  });
});
