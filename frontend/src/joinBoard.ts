import { parse, stringify } from './boardUrl.ts';

/** Accept a complete board code or share link; never navigate to an external host. */
export function joinFragment(input: string): string | null {
  let code = input.trim();
  if (/^https?:\/\//i.test(code)) {
    try { code = new URL(code).hash; } catch { return null; }
  }
  code = code.replace(/^#\/?/, '');
  if (!/^[A-Za-z0-9_-]{4,64}(?:\.(?:pw|view))*$/.test(code)) return null;
  const parsed = parse(code);
  return parsed ? stringify(parsed) : null;
}
