// Onboarding answer checks (lib/profile.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProfile, isValidUserId, isValidPeriodDate } from '../lib/profile.js';

const NOW = new Date('2026-11-10T12:00:00Z');

const good = {
  lastPeriodStart: '2026-10-25',
  cycleLength: 28,
  contraception: 'no',
  patterns: { energyLowerBeforePeriod: 'yes', crampsAffectWorkouts: 'sometimes' },
  workoutDays: ['sat', 'mon', 'wed'],
  goal: 'stay_consistent',
};

test('accepts a complete profile and keeps only known fields', () => {
  const result = validateProfile({ ...good, name: 'Should be dropped' }, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.profile.name, undefined);
  assert.deepEqual(result.profile.workoutDays, ['mon', 'wed', 'sat']); // sorted Mon→Sun
});

test('accepts "prefer not to say" for contraception', () => {
  assert.equal(validateProfile({ ...good, contraception: 'prefer_not_to_say' }, NOW).ok, true);
});

test('turns a numeric string cycle length into a number', () => {
  assert.equal(validateProfile({ ...good, cycleLength: '30' }, NOW).profile.cycleLength, 30);
});

for (const [label, change] of [
  ['missing period date', { lastPeriodStart: '' }],
  ['period date in the future', { lastPeriodStart: '2026-11-20' }],
  ['period date over a year ago', { lastPeriodStart: '2025-10-01' }],
  ['impossible date', { lastPeriodStart: '2026-02-30' }],
  ['cycle length too short', { cycleLength: 10 }],
  ['cycle length too long', { cycleLength: 90 }],
  ['cycle length not a whole number', { cycleLength: 28.5 }],
  ['unknown contraception answer', { contraception: 'maybe' }],
  ['missing pattern answer', { patterns: { energyLowerBeforePeriod: 'yes' } }],
  ['no workout days', { workoutDays: [] }],
  ['unknown workout day', { workoutDays: ['mon', 'someday'] }],
  ['unknown goal', { goal: 'get_famous' }],
]) {
  test(`rejects: ${label}`, () => {
    const result = validateProfile({ ...good, ...change }, NOW);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });
}

test('rejects a missing profile', () => {
  assert.equal(validateProfile(undefined, NOW).ok, false);
});

test('user IDs must be random-ID shaped', () => {
  assert.equal(isValidUserId('3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'), true);
  assert.equal(isValidUserId('julia'), false);
  assert.equal(isValidUserId('__proto__'), false);
  assert.equal(isValidUserId(undefined), false);
});

test('period date allows today and one day ahead for time zones', () => {
  assert.equal(isValidPeriodDate('2026-11-10', NOW), true);
  assert.equal(isValidPeriodDate('2026-11-11', NOW), true);
  assert.equal(isValidPeriodDate('2026-11-12', NOW), false);
});
