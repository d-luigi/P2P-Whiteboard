import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinFragment } from '../src/joinBoard.ts';

test('joining keeps password and view flags for codes and share links', () => {
  assert.equal(joinFragment(' abcd1234 '), 'abcd1234');
  assert.equal(joinFragment('#abcd1234.pw'), 'abcd1234.pw');
  assert.equal(joinFragment('https://example.com/#abcd1234.view.pw'), 'abcd1234.pw.view');
});
test('joining rejects invalid codes, unknown flags and ownership transfers', () => {
  for (const input of ['', 'abc', 'hello world', 'abcd.unknown', 'abcd.owner:abcdefghijklmnop', 'https://example.com/']) {
    assert.equal(joinFragment(input), null);
  }
});
