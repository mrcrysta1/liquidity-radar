// Is a direction model's holdout accuracy actually an edge? Pure helpers
// (tested in scripts/test-engines.mjs), shared by the model, the scanner and
// the panels that report it.
//
// "Accuracy" alone flatters a model: in a trending stretch, always guessing the
// common direction already scores well above 50%. So a model is compared with
// that majority-class baseline on the same holdout, and only the part of its
// lead that is larger than chance could produce counts.

/** Accuracy of always predicting the more common class (labels are 0/1). */
export function majorityBaseline(ys: number[]): number {
  if (!ys.length) return 0.5
  const up = ys.reduce((a, y) => a + (y ? 1 : 0), 0) / ys.length
  return Math.max(up, 1 - up)
}

/**
 * How far above the baseline accuracy must be before it is unlikely to be luck:
 * a one-sided 95% bound for n holdout samples (1.645 standard errors).
 */
export function noiseBar(baseline: number, n: number): number {
  if (!(n > 0)) return 1
  return 1.645 * Math.sqrt((baseline * (1 - baseline)) / n)
}

/** The part of the model's lead over the baseline that noise does not explain (<= 0 means no edge). */
export function provenEdge(accuracy: number, baseline: number, n: number): number {
  return accuracy - baseline - noiseBar(baseline, n)
}
