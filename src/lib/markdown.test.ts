import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown, sanitizeUrl } from './markdown.ts';

describe('sanitizeUrl', () => {
  it('allows http, https, and single-slash relative paths', () => {
    assert.equal(sanitizeUrl('https://example.com/path?a=1#h'), 'https://example.com/path?a=1#h');
    assert.equal(sanitizeUrl('http://localhost:4000/test'), 'http://localhost:4000/test');
    assert.equal(sanitizeUrl('/uploads/abc-123.png'), '/uploads/abc-123.png');
    assert.equal(sanitizeUrl('/'), '/');
    assert.equal(sanitizeUrl('  https://example.com  '), 'https://example.com');
  });

  it('blocks dangerous schemes and protocol-relative URLs', () => {
    assert.equal(sanitizeUrl('javascript:alert(1)'), null);
    assert.equal(sanitizeUrl('JAVASCRIPT:alert(1)'), null);
    assert.equal(sanitizeUrl('  javascript:void(0)  '), null);
    assert.equal(sanitizeUrl('java\nscript:alert(1)'), null);
    assert.equal(sanitizeUrl('java\tscript:alert(1)'), null);
    assert.equal(sanitizeUrl('data:text/html,<script>alert(1)</script>'), null);
    assert.equal(sanitizeUrl('data:image/svg+xml,<svg onload=alert(1)>'), null);
    assert.equal(sanitizeUrl('vbscript:msgbox(1)'), null);
    assert.equal(sanitizeUrl('file:///etc/passwd'), null);
    assert.equal(sanitizeUrl('mailto:user@example.com'), null);
    assert.equal(sanitizeUrl('//evil.example/x.js'), null);
    assert.equal(sanitizeUrl('/\\evil.example/x.js'), null);
    assert.equal(sanitizeUrl(''), null);
    assert.equal(sanitizeUrl('   '), null);
    assert.equal(sanitizeUrl('relative/without/slash'), null);
  });
});

describe('parseMarkdown — headings & paragraphs', () => {
  it('parses h1 through h6 with inline formatting and optional closing hashes', () => {
    const md = [
      '# Heading 1',
      '## Heading **2** ##',
      '### Heading 3',
      '#### Heading 4',
      '##### Heading 5',
      '###### Heading 6',
    ].join('\n');

    assert.deepEqual(parseMarkdown(md), [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Heading 1' }] },
      {
        type: 'heading',
        depth: 2,
        children: [
          { type: 'text', value: 'Heading ' },
          { type: 'strong', children: [{ type: 'text', value: '2' }] },
        ],
      },
      { type: 'heading', depth: 3, children: [{ type: 'text', value: 'Heading 3' }] },
      { type: 'heading', depth: 4, children: [{ type: 'text', value: 'Heading 4' }] },
      { type: 'heading', depth: 5, children: [{ type: 'text', value: 'Heading 5' }] },
      { type: 'heading', depth: 6, children: [{ type: 'text', value: 'Heading 6' }] },
    ]);
  });

  it('does not treat #include without a space as a heading', () => {
    assert.deepEqual(parseMarkdown('#include <stdio.h>'), [
      { type: 'paragraph', children: [{ type: 'text', value: '#include <stdio.h>' }] },
    ]);
  });

  it('merges consecutive lines into one paragraph and splits on blank lines', () => {
    const md = 'line 1\nline 2\n\npara 2';
    assert.deepEqual(parseMarkdown(md), [
      { type: 'paragraph', children: [{ type: 'text', value: 'line 1\nline 2' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'para 2' }] },
    ]);
  });

  it('normalizes CRLF line endings', () => {
    assert.deepEqual(parseMarkdown('# Title\r\n\r\nBody\r\n'), [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Title' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'Body' }] },
    ]);
  });
});

describe('parseMarkdown — code blocks, hr, blockquotes', () => {
  it('parses fenced code blocks with optional language and preserves verbatim content', () => {
    const md = [
      '```c',
      '#include <stdio.h>',
      'int main(void) { printf("<script>"); }',
      '```',
      '',
      '~~~',
      'plain code',
      '~~~',
    ].join('\n');

    assert.deepEqual(parseMarkdown(md), [
      {
        type: 'code',
        lang: 'c',
        value: '#include <stdio.h>\nint main(void) { printf("<script>"); }',
      },
      {
        type: 'code',
        value: 'plain code',
      },
    ]);
  });

  it('parses horizontal rules ---, ***, ___ without confusing them with lists', () => {
    const md = '---\n\n* * *\n\n___';
    assert.deepEqual(parseMarkdown(md), [{ type: 'hr' }, { type: 'hr' }, { type: 'hr' }]);
  });

  it('parses blockquotes recursively including nested quotes and formatting', () => {
    const md = '> **注意**: 入力は整数です。\n> > ネスト引用';
    assert.deepEqual(parseMarkdown(md), [
      {
        type: 'blockquote',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'strong', children: [{ type: 'text', value: '注意' }] },
              { type: 'text', value: ': 入力は整数です。' },
            ],
          },
          {
            type: 'blockquote',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'ネスト引用' }],
              },
            ],
          },
        ],
      },
    ]);
  });
});

describe('parseMarkdown — lists', () => {
  it('parses unordered and ordered lists including custom start number', () => {
    const md = ['- one', '- two', '', '3. third', '4. fourth'].join('\n');
    assert.deepEqual(parseMarkdown(md), [
      {
        type: 'list',
        ordered: false,
        items: [
          { children: [{ type: 'paragraph', children: [{ type: 'text', value: 'one' }] }] },
          { children: [{ type: 'paragraph', children: [{ type: 'text', value: 'two' }] }] },
        ],
      },
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [
          { children: [{ type: 'paragraph', children: [{ type: 'text', value: 'third' }] }] },
          { children: [{ type: 'paragraph', children: [{ type: 'text', value: 'fourth' }] }] },
        ],
      },
    ]);
  });

  it('parses nested lists', () => {
    const md = ['- parent', '  - child 1', '  - child 2', '- sibling'].join('\n');
    assert.deepEqual(parseMarkdown(md), [
      {
        type: 'list',
        ordered: false,
        items: [
          {
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'parent' }] },
              {
                type: 'list',
                ordered: false,
                items: [
                  { children: [{ type: 'paragraph', children: [{ type: 'text', value: 'child 1' }] }] },
                  { children: [{ type: 'paragraph', children: [{ type: 'text', value: 'child 2' }] }] },
                ],
              },
            ],
          },
          { children: [{ type: 'paragraph', children: [{ type: 'text', value: 'sibling' }] }] },
        ],
      },
    ]);
  });
});

describe('parseMarkdown — GFM tables', () => {
  it('parses tables with alignments, inline code pipes, and escaped pipes', () => {
    const md = [
      '| 変数 | 範囲 | 備考 |',
      '| :--- | :---: | ---: |',
      '| `a|b` | 1..10 | a \\| b |',
      '| **N** | 100 | |',
    ].join('\n');

    assert.deepEqual(parseMarkdown(md), [
      {
        type: 'table',
        align: ['left', 'center', 'right'],
        header: [
          [{ type: 'text', value: '変数' }],
          [{ type: 'text', value: '範囲' }],
          [{ type: 'text', value: '備考' }],
        ],
        rows: [
          [
            [{ type: 'code', value: 'a|b' }],
            [{ type: 'text', value: '1..10' }],
            [{ type: 'text', value: 'a | b' }],
          ],
          [
            [{ type: 'strong', children: [{ type: 'text', value: 'N' }] }],
            [{ type: 'text', value: '100' }],
            [],
          ],
        ],
      },
    ]);
  });
});

describe('parseInline — formatting, links, images, and XSS safety', () => {
  it('parses inline code, bold, italic, bold+italic, and preserves snake_case identifiers', () => {
    assert.deepEqual(parseInline('`x + 1` **bold** *italic* __strong__ _em_ ***both***'), [
      { type: 'code', value: 'x + 1' },
      { type: 'text', value: ' ' },
      { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' ' },
      { type: 'em', children: [{ type: 'text', value: 'italic' }] },
      { type: 'text', value: ' ' },
      { type: 'strong', children: [{ type: 'text', value: 'strong' }] },
      { type: 'text', value: ' ' },
      { type: 'em', children: [{ type: 'text', value: 'em' }] },
      { type: 'text', value: ' ' },
      {
        type: 'strong',
        children: [{ type: 'em', children: [{ type: 'text', value: 'both' }] }],
      },
    ]);

    assert.deepEqual(parseInline('max_value and foo_bar_baz stay plain'), [
      { type: 'text', value: 'max_value and foo_bar_baz stay plain' },
    ]);
  });

  it('supports double-backtick inline code containing backticks', () => {
    assert.deepEqual(parseInline('Use `` `code` `` here'), [
      { type: 'text', value: 'Use ' },
      { type: 'code', value: '`code`' },
      { type: 'text', value: ' here' },
    ]);
  });

  it('supports backslash escapes and hard line breaks', () => {
    assert.deepEqual(parseInline('\\*not italic\\*  \nnext\\\nline'), [
      { type: 'text', value: '*not italic*' },
      { type: 'break' },
      { type: 'text', value: 'next' },
      { type: 'break' },
      { type: 'text', value: 'line' },
    ]);
  });

  it('parses safe links and images', () => {
    assert.deepEqual(parseInline('[docs](https://example.com/a) and ![diagram](/uploads/1.png)'), [
      { type: 'link', href: 'https://example.com/a', children: [{ type: 'text', value: 'docs' }] },
      { type: 'text', value: ' and ' },
      { type: 'image', src: '/uploads/1.png', alt: 'diagram' },
    ]);
  });

  it('strips unsafe URL schemes from links and images (XSS safety)', () => {
    assert.deepEqual(parseInline('[click](javascript:alert(1))'), [
      { type: 'text', value: 'click' },
    ]);
    assert.deepEqual(parseInline('[click](DATA:text/html,<script>alert(1)</script>)'), [
      { type: 'text', value: 'click' },
    ]);
    assert.deepEqual(parseInline('[click](vbscript:msgbox(1))'), [
      { type: 'text', value: 'click' },
    ]);
    assert.deepEqual(parseInline('[click](//evil.example/phish)'), [
      { type: 'text', value: 'click' },
    ]);
    assert.deepEqual(parseInline('![pic](javascript:alert(1))'), [
      { type: 'text', value: 'pic' },
    ]);
    assert.deepEqual(parseInline('![](data:image/svg+xml,<svg onload=alert(1)>)'), []);
  });

  it('treats raw HTML tags strictly as plain text (never parsed as HTML)', () => {
    const raw = '<script>alert("xss")</script> <img src=x onerror=alert(1)>';
    assert.deepEqual(parseMarkdown(raw), [
      { type: 'paragraph', children: [{ type: 'text', value: raw }] },
    ]);
  });
});
