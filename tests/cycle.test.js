// Cycle day + estimated phase (lib/cycle.js, spec section 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleContext, isValidToday, PHASE_INFO, ESTIMATE_NOTE } from '../lib/cycle.js';

const natural = { lastPeriodStart: '2026-11-07', cycleLength: 28, contraception: 'no' };

// Date that is `n` days after Nov 7 (Nov 7 = day 1).
function dayOf(n) {
  const d = new Date(Date.UTC(2026, 10, 7 + n - 1));
  return d.toISOString().slice(0, 10);
}

test("Julia's case: started Sat Nov 7, so Tue Nov 10 is day 4, menstrual", () => {
  const c = cycleContext(natural, '2026-11-10');
  assert.equal(c.cycleDay, 4);
  assert.equal(c.phase, 'menstrual');
  assert.equal(c.isPeriodDay, true);
  assert.equal(c.phaseInfo, PHASE_INFO.menstrual);
  assert.equal(c.estimateNote, ESTIMATE_NOTE);
});

test('28-day cycle: phase boundaries', () => {
  const expected = [
    [1, 'menstrual'],
    [5, 'menstrual'],
    [6, 'follicular'],
    [14, 'follicular'], // last follicular day = 28 - 14
    [15, 'luteal'], // first luteal day
    [28, 'luteal'], // day before the next period
  ];
  for (const [day, phase] of expected) {
    assert.equal(cycleContext(natural, dayOf(day)).phase, phase, `day ${day}`);
  }
});

test('21-day cycle: follicular ends on day 7', () => {
  const p = { ...natural, cycleLength: 21 };
  assert.equal(cycleContext(p, dayOf(7)).phase, 'follicular');
  assert.equal(cycleContext(p, dayOf(8)).phase, 'luteal');
});

test('35-day cycle: follicular ends on day 21', () => {
  const p = { ...natural, cycleLength: 35 };
  assert.equal(cycleContext(p, dayOf(21)).phase, 'follicular');
  assert.equal(cycleContext(p, dayOf(22)).phase, 'luteal');
  assert.equal(cycleContext(p, dayOf(35)).phase, 'luteal');
});

test('late period: cycle day shown, no phase, flagged late', () => {
  const c = cycleContext(natural, dayOf(34));
  assert.equal(c.cycleDay, 34);
  assert.equal(c.phase, null);
  assert.equal(c.phaseInfo, null);
  assert.equal(c.periodLate, true);
  assert.equal(c.periodDue, false);
});

test('period due in the last 3 days of the cycle', () => {
  assert.equal(cycleContext(natural, dayOf(25)).periodDue, false);
  assert.equal(cycleContext(natural, dayOf(26)).periodDue, true);
  assert.equal(cycleContext(natural, dayOf(28)).periodDue, true);
  assert.equal(cycleContext(natural, dayOf(10)).periodDue, false);
});

test('period "soon" = expected within about 5 days (days 24-28 of 28), never when late', () => {
  for (const [day, soon] of [[10, false], [20, false], [23, false], [24, true], [26, true], [28, true], [29, false], [35, false]]) {
    assert.equal(cycleContext(natural, dayOf(day)).periodSoon, soon, `day ${day}`);
  }
  // A 35-day cycle: soon from day 31.
  const long = { ...natural, cycleLength: 35 };
  assert.equal(cycleContext(long, dayOf(30)).periodSoon, false);
  assert.equal(cycleContext(long, dayOf(31)).periodSoon, true);
});

for (const contraception of ['yes', 'prefer_not_to_say']) {
  test(`contraception "${contraception}": cycle day only, no phase, never due or late`, () => {
    const p = { ...natural, contraception };
    for (const day of [3, 10, 20, 27, 40]) {
      const c = cycleContext(p, dayOf(day));
      assert.equal(c.cycleDay, day);
      assert.equal(c.phase, null);
      assert.equal(c.phaseInfo, null);
      assert.equal(c.periodDue, false);
      assert.equal(c.periodLate, false);
      assert.equal(c.periodSoon, false);
    }
    assert.equal(cycleContext(p, dayOf(3)).isPeriodDay, true);
  });
}

test('today before the logged start counts as day 1', () => {
  assert.equal(cycleContext(natural, '2026-11-06').cycleDay, 1);
});

test('the word "ovulation" never appears in any output', () => {
  const outputs = [];
  for (const cycleLength of [21, 28, 35]) {
    for (let day = 1; day <= 40; day++) outputs.push(cycleContext({ ...natural, cycleLength }, dayOf(day)));
  }
  const text = JSON.stringify([outputs, PHASE_INFO, ESTIMATE_NOTE]).toLowerCase();
  assert.equal(text.includes('ovulat'), false);
  assert.equal(new Set(outputs.map((o) => o.phase)).size, 4); // menstrual, follicular, luteal, null
});

test('phase lines never claim a phase helps or hurts performance', () => {
  const text = Object.values(PHASE_INFO).join(' ').toLowerCase();
  for (const banned of ['performance', 'stronger', 'weaker', 'injury', 'best time', 'your hormones', 'science']) {
    assert.equal(text.includes(banned), false, banned);
  }
});

test('"today" from the browser must be a real date close to now', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  assert.equal(isValidToday('2026-11-10', now), true);
  assert.equal(isValidToday('2026-11-11', now), true);
  assert.equal(isValidToday('2026-11-20', now), false);
  assert.equal(isValidToday('2026-02-30', now), false);
  assert.equal(isValidToday(null, now), false);
});
