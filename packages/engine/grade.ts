import type { BufferbloatGrade } from "@kilomita/shared";

/**
 * Bufferbloat grades by added latency (strictly less than), as Waveform's bufferbloat test applies
 * them to the larger of the download and upload increases. Waveform's A+ (< 5 ms) folds into A,
 * because the result schema has no A+. Waveform documents no thresholds; these come from its own
 * test script, read from an archived copy on 2026-11-01:
 * https://web.archive.org/web/2026id_/https://bufferbloat.waveform.com/static/js/main.28a58a9c.js
 */
const GRADE_LIMITS: readonly (readonly [number, BufferbloatGrade])[] = [
  [30, "A"],
  [60, "B"],
  [200, "C"],
  [400, "D"],
];

export function gradeBufferbloat(addedMs: number): BufferbloatGrade {
  for (const [limit, grade] of GRADE_LIMITS) if (addedMs < limit) return grade;
  return "F";
}
