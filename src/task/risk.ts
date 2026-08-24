export interface RiskProfile {
  impact: number;
  probability: number;
  areas: string[];
}

export interface RiskRanked<T> {
  item: T;
  score: number;
}

/** Deterministic risk ordering: impact dominates ties, then probability. */
export function rankByRisk<T extends { risk?: RiskProfile | undefined }>(items: T[]): RiskRanked<T>[] {
  return items
    .map((item) => ({ item, score: item.risk === undefined ? 0 : item.risk.impact * item.risk.probability }))
    .sort((a, b) => b.score - a.score || (b.item.risk?.impact ?? 0) - (a.item.risk?.impact ?? 0));
}
