import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, lists, quotes, rules and fences', () => {
    const html = renderMarkdown(
      [
        '# title',
        '',
        '- one',
        '- two',
        '',
        '1. first',
        '',
        '> quoted',
        '',
        '---',
        '',
        '```',
        '<b>raw</b>',
        '```',
      ].join('\n'),
    );
    expect(html).toContain('<h1>title</h1>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<ol><li>first</li></ol>');
    expect(html).toContain('<blockquote>quoted</blockquote>');
    expect(html).toContain('<hr>');
    expect(html).toContain('<pre><code>&lt;b&gt;raw&lt;/b&gt;</code></pre>');
  });

  it('formats emphasis, inline code and safe links', () => {
    const html = renderMarkdown(
      'a **bold** and *soft* and ~~gone~~ with `x < y` and [docs](https://example.com/a?b=1)',
    );
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>soft</em>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<code>x &lt; y</code>');
    expect(html).toContain(
      '<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">docs</a>',
    );
  });

  it('escapes markup and leaves unsafe links as text', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<a');
  });

  it('keeps line breaks inside a paragraph and returns nothing for blanks', () => {
    expect(renderMarkdown('one\ntwo')).toBe('<p>one<br>two</p>');
    expect(renderMarkdown('   \n\n ')).toBe('');
  });
});
