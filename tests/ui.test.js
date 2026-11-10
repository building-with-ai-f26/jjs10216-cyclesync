// Guards for the screens (public/). These read the files directly, since the
// tests don't run a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pub = join(import.meta.dirname, '..', 'public');
const css = readFileSync(join(pub, 'styles.css'), 'utf8');
const html = readFileSync(join(pub, 'index.html'), 'utf8');

// Bug, Nov 10: ".period-confirm { display: flex }" overrode the hidden
// attribute, so "Set today as day 1?" showed on every load without a tap.
test('hidden elements stay hidden even when a class sets display', () => {
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('the period confirmation starts hidden', () => {
  const tag = html.match(/<[^>]*id="period-confirm"[^>]*>/);
  assert.ok(tag, 'period-confirm element exists');
  assert.match(tag[0], /\shidden[\s>]/);
});
