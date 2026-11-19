// public/invite.js: which invite code the page sends (bug, Nov 19: a phone
// kept sending an old, revoked code even after opening a new link).
// Runs the real file in a small sandbox with a fake address bar and storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const source = readFileSync(join(import.meta.dirname, '..', 'public', 'invite.js'), 'utf8');
const KEY = 'cyclesync.inviteCode';
const OLD = 'OLDoldOLDoldOLDoldOLD0'; // 22 characters, like a real code
const NEW = 'NEWnewNEWnewNEWnewNEW1';

// href: the address she opened. saved: what this browser already stores.
// storage: 'ok', 'blocked' (every call throws) or 'readonly' (writes throw).
function openPage(href, { saved = {}, storage = 'ok' } = {}) {
  const store = new Map(Object.entries(saved));
  const location = new URL(href);
  const localStorage = {
    getItem(k) { if (storage === 'blocked') throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { if (storage !== 'ok') throw new Error('blocked'); store.set(k, String(v)); },
    removeItem(k) { if (storage !== 'ok') throw new Error('blocked'); store.delete(k); },
  };
  const history = { state: null, replaceState(_s, _t, path) { location.href = new URL(path, location.href).href; } };
  const sandbox = { location, localStorage, history, URL };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return { invite: sandbox.csInvite, store, location };
}

test('a ?code= in the address replaces an old saved code', () => {
  const { invite, store } = openPage(`https://x/?code=${NEW}`, { saved: { [KEY]: OLD } });
  assert.equal(invite.get(), NEW);
  assert.equal(store.get(KEY), NEW);
  assert.equal(invite.fromLink(), true);
});

test('the new code wins even if this browser refuses to save it', () => {
  const { invite } = openPage(`https://x/?code=${NEW}`, { saved: { [KEY]: OLD }, storage: 'readonly' });
  assert.equal(invite.get(), NEW, 'never falls back to the old saved code');
});

test('a malformed ?code= clears the saved code and counts as a dead link', () => {
  for (const bad of ['abc', '', `${NEW}.`]) {
    const { invite, store } = openPage(`https://x/?code=${encodeURIComponent(bad)}`, { saved: { [KEY]: OLD } });
    assert.equal(invite.get(), null, bad);
    assert.equal(store.has(KEY), false, bad);
    assert.equal(invite.badLink(), true, bad);
    assert.equal(invite.fromLink(), false, bad);
  }
});

test('no ?code= → the saved code, and it is not "from a link"', () => {
  const { invite } = openPage('https://x/', { saved: { [KEY]: OLD } });
  assert.equal(invite.get(), OLD);
  assert.equal(invite.fromLink(), false);
  assert.equal(invite.badLink(), false);
});

test('storage blocked (private mode) → the code from the address still works', () => {
  const { invite } = openPage(`https://x/?code=${NEW}`, { storage: 'blocked' });
  assert.equal(invite.get(), NEW);
});

test('the code is always removed from the address bar, other parts kept', () => {
  for (const code of [NEW, 'abc']) {
    const { location } = openPage(`https://x/?a=1&code=${code}#top`);
    assert.equal(location.href, 'https://x/?a=1#top');
  }
});
