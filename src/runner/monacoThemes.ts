import type { Monaco } from '@monaco-editor/react';

/**
 * Token/UI colors lifted directly from the official "Monokai Pro" and
 * "Monokai Pro Light" VS Code theme JSON (monokai.theme-monokai-pro-vscode),
 * so the editor matches the same source of truth as src/index.css's CSS
 * variables instead of an independently hand-picked approximation.
 */
interface MonokaiProThemeSpec {
  base: 'vs-dark' | 'vs';
  colors: {
    background: string;
    foreground: string;
    lineNumber: string;
    selection: string;
  };
  rules: {
    comment: string;
    string: string;
    keyword: string;
    storage: string;
    storageType: string;
    number: string;
    function: string;
    type: string;
    constant: string;
    tag: string;
    attribute: string;
  };
}

const MONOKAI_PRO_DARK: MonokaiProThemeSpec = {
  base: 'vs-dark',
  colors: {
    background: '#2d2a2e',
    foreground: '#fcfcfa',
    lineNumber: '#5b595c',
    selection: '#c1c0c026',
  },
  rules: {
    comment: '#727072',
    string: '#ffd866',
    keyword: '#ff6188',
    storage: '#ff6188',
    storageType: '#78dce8',
    number: '#ab9df2',
    function: '#a9dc76',
    type: '#78dce8',
    constant: '#ab9df2',
    tag: '#ff6188',
    attribute: '#78dce8',
  },
};

const MONOKAI_PRO_LIGHT: MonokaiProThemeSpec = {
  base: 'vs',
  colors: {
    background: '#fefaf9',
    foreground: '#29242a',
    lineNumber: '#a59fa0',
    selection: '#29242a19',
  },
  rules: {
    comment: '#706b6e',
    string: '#cc7a0a',
    keyword: '#e14775',
    storage: '#e14775',
    storageType: '#1c8ca8',
    number: '#7058be',
    function: '#269d69',
    type: '#1c8ca8',
    constant: '#7058be',
    tag: '#e14775',
    attribute: '#1c8ca8',
  },
};

function toMonacoTheme(spec: MonokaiProThemeSpec): Parameters<Monaco['editor']['defineTheme']>[1] {
  const { rules, colors } = spec;
  return {
    base: spec.base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: rules.comment.slice(1), fontStyle: 'italic' },
      { token: 'string', foreground: rules.string.slice(1) },
      { token: 'keyword', foreground: rules.keyword.slice(1) },
      { token: 'storage', foreground: rules.storage.slice(1) },
      { token: 'keyword.type', foreground: rules.storageType.slice(1) },
      { token: 'number', foreground: rules.number.slice(1) },
      { token: 'entity.name.function', foreground: rules.function.slice(1) },
      { token: 'type', foreground: rules.type.slice(1) },
      { token: 'constant', foreground: rules.constant.slice(1) },
      { token: 'tag', foreground: rules.tag.slice(1) },
      { token: 'attribute.name', foreground: rules.attribute.slice(1) },
    ],
    colors: {
      'editor.background': colors.background,
      'editor.foreground': colors.foreground,
      'editorLineNumber.foreground': colors.lineNumber,
      'editor.selectionBackground': colors.selection,
    },
  };
}

export const MONACO_DARK_THEME_NAME = 'monokai-pro-dark';
export const MONACO_LIGHT_THEME_NAME = 'monokai-pro-light';

let defined = false;

export function ensureMonokaiProThemes(monaco: Monaco) {
  if (defined) return;
  monaco.editor.defineTheme(MONACO_DARK_THEME_NAME, toMonacoTheme(MONOKAI_PRO_DARK));
  monaco.editor.defineTheme(MONACO_LIGHT_THEME_NAME, toMonacoTheme(MONOKAI_PRO_LIGHT));
  defined = true;
}
