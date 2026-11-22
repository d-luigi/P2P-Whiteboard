const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRoomCodes } = require('./roomCodes');

test('short codes resolve existing boards and preserve password/view flags', () => {
  const rooms = createRoomCodes();
  const code = rooms.register('long-board-id.pw.view', 100);
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal(rooms.resolve(code.toLowerCase(), 101), 'long-board-id.pw.view');
  assert.equal(rooms.register('long-board-id.pw.view', 102), code);
  assert.notEqual(rooms.register('another-board', 103), code);
  assert.equal(rooms.resolve('ZZZZZZ', 104), null);
});
test('expired codes stop resolving and malformed fragments are rejected', () => {
  const rooms = createRoomCodes();
  const code = rooms.register('valid-board', 100);
  assert.equal(rooms.resolve(code, 86400101), null);
  for (const value of ['', 'abc', 'abcd.owner:secret', 'abcd.bad', null]) assert.equal(rooms.register(value), null);
});
