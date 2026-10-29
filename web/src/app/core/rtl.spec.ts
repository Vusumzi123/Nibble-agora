import { describe, expect, it } from 'vitest';

/** Guard rail for card #17: translated layouts must stay direction-agnostic. */
const SOURCES = import.meta.glob('../../**/*.{css,html}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const PHYSICAL: { pattern: RegExp; use: string }[] = [
  { pattern: /\b(?:margin|padding|border)-(?:left|right)\s*:/, use: 'the -inline-start / -inline-end property' },
  { pattern: /\btext-align\s*:\s*(?:left|right)\b/, use: 'text-align: start / end' },
  { pattern: /(?:^|[;{\s])(?:left|right)\s*:/, use: 'inset-inline-start / inset-inline-end' },
  { pattern: /\bfloat\s*:\s*(?:left|right)\b/, use: 'float: inline-start / inline-end' },
  { pattern: /\[style\.(?:left|right)[.\]]/, use: 'inset-inline-start / inset-inline-end bindings' },
];

function strip(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
}

describe('logical CSS', () => {
  it('scans the app stylesheets and templates (non-vacuous)', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
  });

  it('declares no physical inline-axis properties', () => {
    const violations: string[] = [];
    for (const [file, raw] of Object.entries(SOURCES)) {
      strip(raw)
        .split('\n')
        .forEach((line, index) => {
          for (const rule of PHYSICAL) {
            if (rule.pattern.test(line)) {
              violations.push(`${file}:${index + 1} should use ${rule.use} — ${line.trim()}`);
              break;
            }
          }
        });
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
