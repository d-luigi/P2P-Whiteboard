import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanTitle,
  entryFragment,
  fromRow,
  mergeEntries,
  patchEntry,
  recordVisit,
  sameEntry,
  sanitizeEntry,
  sanitizeList,
  toRow,
  visibleEntries,
  MAX_ENTRIES,
  type BoardEntry,
} from '../src/registryCore.ts';

const KEY = 'k'.repeat(22);
const visit = (id: string, now: number, extra = {}) => ({ id, viewOnly: false, passwordProtected: false, now, ...extra });

test('first visit creates an entry; owner key makes it an owner entry', () => {
  const [a] = recordVisit([], visit('board-one', 1000));
  assert.equal(a.role, 'member');
  assert.equal(a.title, 'Untitled board');
  const [b] = recordVisit([], visit('board-two', 1000, { ownerKey: KEY }));
  assert.equal(b.role, 'owner');
  assert.equal(b.ownerKey, KEY);
});

test('reopening within 10 minutes changes nothing (no sync churn); later it bumps openedAt', () => {
  const l1 = recordVisit([], visit('board-one', 1000));
  assert.equal(recordVisit(l1, visit('board-one', 60_000))[0].updatedAt, 1000);
  assert.equal(recordVisit(l1, visit('board-one', 20 * 60_000))[0].updatedAt, 20 * 60_000);
});

test('becoming owner is recorded and never undone by a later visit without the key', () => {
  let l = recordVisit([], visit('board-one', 1000));
  l = recordVisit(l, visit('board-one', 2000, { ownerKey: KEY }));
  assert.equal(l[0].role, 'owner');
  l = recordVisit(l, visit('board-one', 3000));
  assert.equal(l[0].ownerKey, KEY);
});

test('edit access is kept when a view-only link is opened later, and gained when an edit link is', () => {
  let l = recordVisit([], visit('board-one', 1000, { viewOnly: true }));
  assert.equal(l[0].viewOnly, true);
  l = recordVisit(l, visit('board-one', 2000, { viewOnly: false }));
  assert.equal(l[0].viewOnly, false);
  l = recordVisit(l, visit('board-one', 3000, { viewOnly: true }));
  assert.equal(l[0].viewOnly, false);
});

test('opening a removed board brings it back', () => {
  let l = recordVisit([], visit('board-one', 1000));
  l = patchEntry(l, 'board-one', { removed: true }, 2000);
  assert.deepEqual(visibleEntries(l), []);
  l = recordVisit(l, visit('board-one', 3000));
  assert.equal(visibleEntries(l).length, 1);
});

test('merge: newer change wins, but ownership and edit access are never lost', () => {
  const local = recordVisit([], visit('board-one', 1000, { ownerKey: KEY }));
  const renamedRemote: BoardEntry[] = [{ ...patchEntry(local, 'board-one', { title: 'Roadmap' }, 5000)[0], ownerKey: null, role: 'member', viewOnly: true }];
  const [m] = mergeEntries(local, renamedRemote);
  assert.equal(m.title, 'Roadmap'); // the newer edit won
  assert.equal(m.ownerKey, KEY); // ...but the key survived
  assert.equal(m.role, 'owner');
  assert.equal(m.viewOnly, false);
});

test('merge: removal on another device wins when newer, and entries unique to either side are kept', () => {
  const local = recordVisit(recordVisit([], visit('board-one', 1000)), visit('board-two', 1100));
  const remote = patchEntry(recordVisit([], visit('board-one', 1000)), 'board-one', { removed: true }, 9000);
  const merged = mergeEntries(local, [...remote, ...recordVisit([], visit('board-three', 1200))]);
  assert.deepEqual(visibleEntries(merged).map((e) => e.id).sort(), ['board-three', 'board-two']);
});

test('merge is stable: merging twice gives the same list', () => {
  const a = recordVisit([], visit('board-one', 1000));
  const b = patchEntry(recordVisit([], visit('board-one', 1000)), 'board-one', { title: 'X' }, 2000);
  const once = mergeEntries(a, b);
  const twice = mergeEntries(once, b);
  assert.ok(once.every((e, i) => sameEntry(e, twice[i])));
});

test('the list is capped, keeping the most recently opened', () => {
  let l: BoardEntry[] = [];
  for (let i = 0; i < MAX_ENTRIES + 20; i++) l = recordVisit(l, visit(`board-${String(i).padStart(4, '0')}`, 1000 + i));
  assert.equal(l.length, MAX_ENTRIES);
  assert.ok(l.some((e) => e.id === `board-${String(MAX_ENTRIES + 19).padStart(4, '0')}`));
  assert.ok(!l.some((e) => e.id === 'board-0000'));
});

test('untrusted entries are validated', () => {
  const good = { id: 'abcd', title: '  Hi  there ', role: 'owner', ownerKey: KEY, viewOnly: false, passwordProtected: true, createdAt: 1, openedAt: 2, updatedAt: 3, removed: false };
  assert.equal(sanitizeEntry(good)?.title, 'Hi there');
  assert.equal(sanitizeEntry({ ...good, id: 'a b' }), null);
  assert.equal(sanitizeEntry({ ...good, id: 'abc' }), null);
  assert.equal(sanitizeEntry({ ...good, updatedAt: 'x' }), null);
  assert.equal(sanitizeEntry({ ...good, updatedAt: Infinity }), null);
  assert.equal(sanitizeEntry(null), null);
  assert.equal(sanitizeEntry({ ...good, ownerKey: 'short' })?.role, 'member'); // owner needs a valid key
  assert.equal(sanitizeEntry({ ...good, title: 'x'.repeat(500) })?.title.length, 80);
  assert.equal(cleanTitle('   '), 'Untitled board');
  assert.deepEqual(sanitizeList('nope'), []);
  assert.equal(sanitizeList([good, good]).length, 1); // duplicates dropped
});

test('server rows round-trip, including bigint columns that arrive as strings', () => {
  const [e] = recordVisit([], visit('board-one', 1234, { ownerKey: KEY }));
  const row = toRow(e, 'user-1');
  assert.equal(row.user_id, 'user-1');
  assert.ok(sameEntry(fromRow(row)!, e));
  const asStrings = { ...row, created_at: String(row.created_at), opened_at: String(row.opened_at), updated_at: String(row.updated_at) };
  assert.ok(sameEntry(fromRow(asStrings)!, e));
});

test('links reopen the board the way it was opened', () => {
  const l = recordVisit([], visit('board-one', 1, { viewOnly: true, passwordProtected: true }));
  assert.equal(entryFragment(l[0]), 'board-one.pw.view');
});
