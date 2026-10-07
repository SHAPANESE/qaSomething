import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface InitOptions {
  repoPath: string;
  baseUrl: string;
  startCommand?: string;
  authFile?: string;
}

export interface InitResult {
  configFile: string;
  taskFile: string;
  authFile?: string;
}

/** Create the minimal local project contract without overwriting user files. */
export async function initializeProject(options: InitOptions): Promise<InitResult> {
  const repoPath = path.resolve(options.repoPath);
  const url = new URL(options.baseUrl);
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error("Base URL must use http or https.");
  }

  const configFile = path.join(repoPath, "qa-agent.config.json");
  const config = {
    baseUrl: options.baseUrl,
    ...(options.startCommand === undefined ? {} : { startCommand: options.startCommand }),
    allowedWriteDirs: ["tests", "reports", ".qa-agent"],
    reruns: 2,
    maxSteps: 30,
  };
  await writeFile(configFile, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", flag: "wx" }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new Error(`Refusing to overwrite existing ${configFile}`);
      throw error;
    },
  );

  const taskDir = path.join(repoPath, "qa-tasks");
  await mkdir(taskDir, { recursive: true });
  const taskFile = path.join(taskDir, "first-look.json");
  const task = {
    version: 1,
    id: "first-look",
    goal: "Explore the landing page for objective technical and consistency failures",
    target: {
      baseUrl: options.baseUrl,
      actor: "default",
      ...(options.authFile === undefined ? {} : { storageState: ".qa-agent/auth/default.json" }),
    },
    attempts: 2,
    evidence: { required: ["ui", "console", "screenshot"] },
    safety: {
      allow: ["read", "create_test_data", "modify_test_data", "delete_test_data"],
      deny: ["external_message", "payment", "user_admin"],
    },
  };
  await writeFile(taskFile, JSON.stringify(task, null, 2) + "\n", { encoding: "utf8", flag: "wx" }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new Error(`Refusing to overwrite existing ${taskFile}`);
      throw error;
    },
  );

  let copiedAuth: string | undefined;
  if (options.authFile !== undefined) {
    const authDir = path.join(repoPath, ".qa-agent", "auth");
    await mkdir(authDir, { recursive: true });
    // Session cookies live in the app's repo: ignore them there, before they exist.
    await writeFile(path.join(authDir, ".gitignore"), "*\n", "utf8");
    copiedAuth = path.join(authDir, "default.json");
    await copyFile(path.resolve(options.authFile), copiedAuth);
    await chmod(copiedAuth, 0o600);
  }

  return {
    configFile,
    taskFile,
    ...(copiedAuth === undefined ? {} : { authFile: copiedAuth }),
  };
}
