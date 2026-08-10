import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
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
  });

  it("refuses to overwrite existing configuration", async () => {
    const repoPath = await mkdtemp(path.join(os.tmpdir(), "qa-init-"));
    await writeFile(path.join(repoPath, "qa-agent.config.json"), "{}");
    await expect(initializeProject({ repoPath, baseUrl: "http://localhost:3000" })).rejects.toThrow(
      /Refusing to overwrite/,
    );
  });
});
