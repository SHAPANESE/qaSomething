import type { SemanticAction, TaskSequence } from "./sequence.js";

export interface ShrinkResult {
  sequence: TaskSequence;
  attempts: number;
  removedActionIds: string[];
}

export type SequenceReproducer = (candidate: TaskSequence) => Promise<boolean>;

function chunks<T>(items: T[], count: number): T[][] {
  const result: T[][] = [];
  const size = Math.ceil(items.length / count);
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/**
 * Delta-debug a failing sequence. Required actions and the oracle assertion are
 * never removed. A candidate is kept only when the injected reproducer confirms
 * that it preserves the target failure.
 */
export async function shrinkSequence(
  original: TaskSequence,
  reproduces: SequenceReproducer,
): Promise<ShrinkResult> {
  let actions = [...original.actions];
  let granularity = 2;
  let attempts = 0;

  while (true) {
    const removable = actions.filter((action) => action.required !== true);
    if (removable.length === 0) break;
    const groups = chunks(removable, Math.min(granularity, removable.length));
    let reduced = false;

    for (const group of groups) {
      const removeIds = new Set(group.map((action) => action.id));
      const candidateActions = actions.filter((action) => !removeIds.has(action.id));
      if (candidateActions.length === 0) continue;
      const candidate: TaskSequence = { ...original, actions: candidateActions };
      attempts++;
      if (await reproduces(candidate)) {
        actions = candidateActions;
        granularity = Math.max(2, granularity - 1);
        reduced = true;
        break;
      }
    }

    if (reduced) continue;
    if (granularity >= removable.length) break;
    granularity = Math.min(removable.length, granularity * 2);
  }

  const kept = new Set(actions.map((action) => action.id));
  return {
    sequence: { ...original, actions },
    attempts,
    removedActionIds: original.actions
      .filter((action: SemanticAction) => !kept.has(action.id))
      .map((action) => action.id),
  };
}
