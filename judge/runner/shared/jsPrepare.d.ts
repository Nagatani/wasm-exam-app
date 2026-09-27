// `transform` is sucrase's transform (typed loosely so this file needs no
// sucrase types; the browser and the judge each pass their own copy).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function prepareJsSource(
  source: string,
  language: 'JS' | 'TS',
  transform: (code: string, options: any) => { code: string },
): { ok: boolean; js: string; error: string };
