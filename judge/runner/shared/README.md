# judge/runner/shared — code shared by the browser and the judge

Everything in this directory runs **unchanged in both places**: the student's
browser (imported by `src/runner/*` and bundled by Vite) and the judge
container (imported by `judge/runner/*.mjs` under Node). It exists so the
authoritative server-side grading (final submit / auto-finalize / regrade)
treats a program exactly like the in-browser "実行" preview did — same stdin
helpers, same output formatting, same TS transform options, same Python
execution template, same limits.

Rules:
- Plain ES modules, no dependencies, no browser- or Node-only globals (a
  dependency such as sucrase is passed in by the caller).
- Change behavior here, never by forking a copy on one side.
