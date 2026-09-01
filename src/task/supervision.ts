import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SupervisionMode = "autonomous" | "approve_risky" | "approve_all";
export type CommandRisk = "read" | "write_or_execute";
export type ApprovalOutcome = "approve" | "deny" | "pause";
export type ApprovalScope = "once" | "session";

export interface SupervisionPolicy {
  mode: SupervisionMode;
  checkpointBeforeExecution: boolean;
  checkpointBeforeFinding: boolean;
  reviewer?: string | undefined;
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  kind: "command" | "sequence" | "finding";
  risk: CommandRisk | "execution" | "finding";
  summary: string;
  detail: string;
}

export interface ApprovalResponse {
  outcome: ApprovalOutcome;
  scope: ApprovalScope;
  reviewer?: string;
  note?: string;
}

export interface ApprovalDecision extends ApprovalRequest, ApprovalResponse {
  at: string;
  automatic: boolean;
  grantKey: string;
}

export interface SupervisionSession {
  schemaVersion: 1;
  taskId: string;
  mode: SupervisionMode;
  status: "running" | "paused" | "completed";
  createdAt: string;
  updatedAt: string;
  decisions: ApprovalDecision[];
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<ApprovalResponse>;

export interface SupervisionController {
  session: SupervisionSession;
  auditFile: string;
  requestCommand(command: string): Promise<ApprovalDecision>;
  requestSequence(detail: string): Promise<ApprovalDecision>;
  requestFinding(detail: string): Promise<ApprovalDecision>;
  complete(): Promise<void>;
}

const SAFE_PROGRAMS = new Set([
  "cat",
  "find",
  "get-childitem",
  "get-content",
  "git",
  "grep",
  "ls",
  "pwd",
  "rg",
  "select-string",
]);

const SAFE_GIT_SUBCOMMANDS = new Set(["diff", "log", "show", "status"]);

/** Conservatively classify commands. Anything not confidently read-only needs approval. */
export function commandRisk(command: string): CommandRisk {
  const trimmed = command.trim();
  if (trimmed.length === 0 || /[\r\n;&|<>`]|\$\(/.test(trimmed)) return "write_or_execute";

  const words = trimmed.split(/\s+/);
  const program = words[0]?.toLowerCase();
  if (program === undefined || !SAFE_PROGRAMS.has(program)) return "write_or_execute";
  const lowerWords = words.map((word) => word.toLowerCase());
  if (
    program === "find" &&
    lowerWords.some((word) =>
      ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf"].includes(word),
    )
  ) {
    return "write_or_execute";
  }
  if (program === "rg" && lowerWords.some((word) => word === "--pre" || word.startsWith("--pre="))) {
    return "write_or_execute";
  }
  if (program === "git") {
    const subcommand = words.find((word, index) => index > 0 && !word.startsWith("-"));
    const writesOutput = lowerWords.some((word) => word === "--output" || word.startsWith("--output="));
    return subcommand !== undefined && SAFE_GIT_SUBCOMMANDS.has(subcommand.toLowerCase()) && !writesOutput
      ? "read"
      : "write_or_execute";
  }
  return "read";
}

function requestId(taskId: string, kind: ApprovalRequest["kind"], detail: string): string {
  return createHash("sha256").update(`${taskId}\0${kind}\0${detail}`).digest("hex").slice(0, 16);
}

async function loadSession(file: string): Promise<SupervisionSession | undefined> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as SupervisionSession;
    if (value.schemaVersion !== 1 || !Array.isArray(value.decisions)) {
      throw new Error(`Unsupported or malformed supervision audit log: ${file}`);
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Could not load supervision audit log ${file}: ${String(error)}`, { cause: error });
  }
}

export async function createSupervisionController(args: {
  repoPath: string;
  taskId: string;
  policy: SupervisionPolicy;
  handler?: ApprovalHandler;
}): Promise<SupervisionController> {
  const directory = path.join(args.repoPath, ".qa-agent", "task-work", args.taskId);
  const auditFile = path.join(directory, "supervision.json");
  await mkdir(directory, { recursive: true });
  const now = new Date().toISOString();
  const previous = await loadSession(auditFile);
  const session: SupervisionSession =
    previous?.taskId === args.taskId && previous.mode === args.policy.mode
      ? { ...previous, status: "running", updatedAt: now }
      : {
          schemaVersion: 1,
          taskId: args.taskId,
          mode: args.policy.mode,
          status: "running",
          createdAt: now,
          updatedAt: now,
          decisions: [],
        };

  const persist = async (): Promise<void> => {
    session.updatedAt = new Date().toISOString();
    await writeFile(auditFile, JSON.stringify(session, null, 2) + "\n", "utf8");
  };
  await persist();

  const decide = async (
    request: ApprovalRequest,
    grantKey: string,
    automatic: boolean,
  ): Promise<ApprovalDecision> => {
    let response: ApprovalResponse;
    if (automatic) {
      response = {
        outcome: "approve",
        scope: "once",
        ...(args.policy.reviewer === undefined ? {} : { reviewer: args.policy.reviewer }),
      };
    } else {
      const sessionGrant = session.decisions.some(
        (decision) =>
          decision.grantKey === grantKey && decision.outcome === "approve" && decision.scope === "session",
      );
      if (sessionGrant) {
        response = {
          outcome: "approve",
          scope: "session",
          ...(args.policy.reviewer === undefined ? {} : { reviewer: args.policy.reviewer }),
        };
        automatic = true;
      } else if (args.handler !== undefined) {
        try {
          response = await args.handler(request);
        } catch (error) {
          response = {
            outcome: "pause",
            scope: "once",
            ...(args.policy.reviewer === undefined ? {} : { reviewer: args.policy.reviewer }),
            note: `Reviewer input was interrupted: ${String(error)}`,
          };
        }
      } else {
        response = {
          outcome: "pause",
          scope: "once",
          ...(args.policy.reviewer === undefined ? {} : { reviewer: args.policy.reviewer }),
          note: "Approval is required, but no interactive reviewer is available.",
        };
      }
    }

    const decision: ApprovalDecision = {
      ...request,
      ...response,
      at: new Date().toISOString(),
      automatic,
      grantKey,
    };
    session.decisions.push(decision);
    if (decision.outcome === "pause") session.status = "paused";
    await persist();
    return decision;
  };

  const makeRequest = (
    kind: ApprovalRequest["kind"],
    risk: ApprovalRequest["risk"],
    summary: string,
    detail: string,
  ): ApprovalRequest => ({
    id: requestId(args.taskId, kind, detail),
    taskId: args.taskId,
    kind,
    risk,
    summary,
    detail,
  });

  return {
    session,
    auditFile,
    async requestCommand(command) {
      const risk = commandRisk(command);
      const automatic =
        args.policy.mode === "autonomous" || (args.policy.mode === "approve_risky" && risk === "read");
      return decide(
        makeRequest("command", risk, `Run ${risk === "read" ? "read-only" : "executable"} command`, command),
        `command:${risk}`,
        automatic,
      );
    },
    async requestSequence(detail) {
      return decide(
        makeRequest("sequence", "execution", "Execute the proposed browser sequence", detail),
        "sequence:execution",
        args.policy.mode === "autonomous" || !args.policy.checkpointBeforeExecution,
      );
    },
    async requestFinding(detail) {
      return decide(
        makeRequest("finding", "finding", "Accept the verified QA finding", detail),
        "finding:review",
        args.policy.mode === "autonomous" || !args.policy.checkpointBeforeFinding,
      );
    },
    async complete() {
      session.status = "completed";
      await persist();
    },
  };
}
