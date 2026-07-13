import { z } from "zod";

/**
 * Per-ticket position in the QA cycle. The router reads this to know "where are
 * we" so the guided flow and à-la-carte entry share one code path. State lives
 * on disk (and in git), so a cycle is resumable across sessions.
 */

export const CYCLE_PHASES = ["planned", "authored", "run", "triaged", "reported"] as const;
export type CyclePhase = (typeof CYCLE_PHASES)[number];

export const TicketStateSchema = z
  .object({
    ticketId: z.string().min(1),
    phase: z.enum(CYCLE_PHASES),
    updated: z.string().min(1),
  })
  .strict();
export type TicketState = z.infer<typeof TicketStateSchema>;

export const CasebookStateSchema = z
  .object({
    version: z.literal(1),
    tickets: z.record(z.string(), TicketStateSchema),
  })
  .strict();
export type CasebookState = z.infer<typeof CasebookStateSchema>;

export function emptyState(): CasebookState {
  return { version: 1, tickets: {} };
}

export function parseState(raw: string): CasebookState {
  return CasebookStateSchema.parse(JSON.parse(raw));
}

export function serializeState(state: CasebookState): string {
  return JSON.stringify(state, null, 2) + "\n";
}

/** The next phase in the guided flow, or null at the end. */
export function nextPhase(phase: CyclePhase): CyclePhase | null {
  const i = CYCLE_PHASES.indexOf(phase);
  return i >= 0 && i < CYCLE_PHASES.length - 1 ? CYCLE_PHASES[i + 1]! : null;
}

/** Pure: set a ticket's phase, returning a new state (caller supplies the timestamp). */
export function setPhase(
  state: CasebookState,
  ticketId: string,
  phase: CyclePhase,
  updated: string,
): CasebookState {
  return {
    ...state,
    tickets: { ...state.tickets, [ticketId]: { ticketId, phase, updated } },
  };
}
