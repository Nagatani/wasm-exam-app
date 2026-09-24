// Bulk import format: cases separated by a line that is exactly `===`; within
// a case, input and expected are separated by a line that is exactly `---`; a
// first line of exactly `@sample` marks the case as a sample.
export function parseBulkCases(
  text: string,
): { input: string; expectedOutput: string; isSample: boolean }[] {
  return text
    .split(/\r?\n===\r?\n/)
    .map((block) => block.replace(/\s+$/, ''))
    .filter((block) => block.trim() !== '')
    .map((block) => {
      let body = block;
      let isSample = false;
      const nl = body.indexOf('\n');
      const firstLine = (nl === -1 ? body : body.slice(0, nl)).trim();
      if (firstLine === '@sample') {
        isSample = true;
        body = nl === -1 ? '' : body.slice(nl + 1);
      }
      const parts = body.split(/\r?\n---\r?\n/);
      return {
        input: parts[0] ?? '',
        expectedOutput: parts.slice(1).join('\n---\n'),
        isSample,
      };
    });
}
