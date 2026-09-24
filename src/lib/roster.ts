// Split a pasted roster (one-per-line or CSV) into 学籍番号 tokens: first
// comma/tab/space-separated field of each non-empty line.
export function parseRoster(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,\t ]/)[0]?.trim() ?? '')
    .filter((s) => s !== '' && !/^学籍番号$/i.test(s));
}

// Parse a `学籍番号,氏名` roster (CSV or tab-separated) for account creation.
export function parseAccountRoster(text: string): { studentNumber: string; displayName: string }[] {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      return { studentNumber: parts[0] ?? '', displayName: parts.slice(1).join(' ').trim() };
    })
    .filter(
      (r) => r.studentNumber !== '' && r.displayName !== '' && !/^学籍番号$/i.test(r.studentNumber),
    );
}
