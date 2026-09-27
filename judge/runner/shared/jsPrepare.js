// Transpile (TS) or syntax-check (JS) once per submission; the result is run
// against every test case. `transform` is sucrase's transform() — injected so
// this file has no dependencies (the browser bundles sucrase, the judge
// installs the same version; a unit test keeps the versions equal).
export function prepareJsSource(source, language, transform) {
  if (language === 'TS') {
    try {
      // Type-stripping only: a type error never fails the judge, a syntax
      // error does.
      const { code } = transform(source, { transforms: ['typescript'], disableESTransforms: true });
      return { ok: true, js: code, error: '' };
    } catch (err) {
      return { ok: false, js: '', error: formatError(err) };
    }
  }

  try {
    // Parse without executing — throws SyntaxError on malformed source.
    new Function(source);
    return { ok: true, js: source, error: '' };
  } catch (err) {
    const message = formatError(err);
    // V8's SyntaxError carries no line/column, so the editor couldn't mark
    // it. Re-parse with sucrase only to locate the error; `new Function`
    // stays the authority on whether the code is valid.
    const position = syntaxErrorPosition(source, transform);
    return {
      ok: false,
      js: '',
      error: position && !/\(\d+:\d+\)/.test(message) ? `${message} (${position})` : message,
    };
  }
}

function syntaxErrorPosition(source, transform) {
  try {
    transform(source, { transforms: [] });
    return null;
  } catch (err) {
    const m = err instanceof Error ? err.message.match(/\((\d+:\d+)\)/) : null;
    return m ? m[1] : null;
  }
}

function formatError(err) {
  // sucrase syntax errors already carry a "(line:col)" location in .message.
  return err instanceof Error ? err.message : String(err);
}
