export function computeHarmVerdict(
  r: { flagged: boolean; categoryScores?: Record<string, number> },
  threshold = 0.5
): 'pass' | 'flag' {
  if (r.flagged) {
    return 'flag';
  }
  if (r.categoryScores) {
    for (const score of Object.values(r.categoryScores)) {
      if (typeof score === 'number' && score >= threshold) {
        return 'flag';
      }
    }
  }
  return 'pass';
}
