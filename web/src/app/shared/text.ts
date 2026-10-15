/** "a, @b ,, c" → ['a', 'b', 'c'] — comma-separated mention input. */
export function parseMentions(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean);
}
