/**
 * Reading and writing the board link (the URL hash). Pure: no browser APIs, so it can be
 * unit tested.
 *
 *   #<id>                      edit link
 *   #<id>.view                 view-only link
 *   #<id>.pw                   password-protected board
 *   #<id>.owner:<key>          owner link: opening it makes you an owner (see owner.ts)
 */
export const VALID_ID = /^[A-Za-z0-9_-]{4,64}$/;
export const FLAGS = ['pw', 'view'] as const; // canonical order in the URL
export type Flag = (typeof FLAGS)[number];

const OWNER_TOKEN = 'owner:';
const OWNER_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;

export interface Parsed {
  id: string;
  flags: Set<Flag>;
  /** Only present on owner links. Never written back into the address bar or shared links. */
  ownerKey?: string;
}

export function parse(fragment: string): Parsed | null {
  const [id, ...rest] = fragment.replace(/^#\/?/, '').split('.');
  if (!VALID_ID.test(id)) return null;
  const flags = new Set<Flag>();
  let ownerKey: string | undefined;
  for (const tok of rest) {
    if ((FLAGS as readonly string[]).includes(tok)) {
      flags.add(tok as Flag);
    } else if (tok.startsWith(OWNER_TOKEN) && OWNER_KEY_RE.test(tok.slice(OWNER_TOKEN.length))) {
      ownerKey = tok.slice(OWNER_TOKEN.length);
    }
  }
  return { id, flags, ownerKey };
}

/** The link fragment for a board. The owner key is only included when asked for. */
export const stringify = (p: Parsed, withOwnerKey = false) =>
  p.id +
  FLAGS.filter((f) => p.flags.has(f))
    .map((f) => `.${f}`)
    .join('') +
  (withOwnerKey && p.ownerKey ? `.${OWNER_TOKEN}${p.ownerKey}` : '');
