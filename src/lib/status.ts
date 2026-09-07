// A non-color cue for each judge status, so verdicts aren't communicated by
// color alone (AC green / WA red would be indistinguishable to some viewers).
// Pair the glyph with the existing text label + color class at each call site.
const STATUS_GLYPH: Record<string, string> = {
  AC: '✓',
  WA: '✗',
  CE: '⚠',
  RE: '⚠',
  TLE: '⌛',
  MLE: '⌛',
};

export function statusGlyph(status: string | null | undefined): string {
  return status ? (STATUS_GLYPH[status] ?? '') : '';
}
