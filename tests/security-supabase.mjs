// Security test (Build 3, class check 1): is the live database locked?
//
// CycleSync has no sign-in but saves data, so the test that fits is:
// using the PUBLIC (publishable) key, try to read, add, change and delete rows
// in every table, and to run the rate-limit function. Every attempt must be refused.
// It tries again with no key at all.
//
// Run:  npm run test:security
// Needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env. The publishable key is
// public by design, so it's fine on the laptop. The SECRET key must never be in
// .env, and this script stops if it's given one.
//
// Safe to run any time: the add and change use clearly labelled dummy data,
// and the change and delete only target an ID that doesn't exist. Permission
// is checked before any row is looked at, so a refusal here proves the lock.
// If an attempt ever succeeds, the script says FAIL and what to clean up.

const TABLES = ['invites', 'profiles', 'checkins', 'ai_calls', 'write_calls'];
const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000';

// Dummy rows that satisfy each table's columns, so a refusal can't be
// explained by bad data (a broken lock would accept these).
const DUMMY_ROWS = {
  invites: { code_hash: '0'.repeat(64), label: 'security-test' },
  profiles: { user_id: NO_SUCH_ID, invite_id: NO_SUCH_ID, data: { securityTest: true } },
  checkins: { user_id: NO_SUCH_ID, invite_id: NO_SUCH_ID, checkin_date: '2026-11-17', source: 'security-test', data: { securityTest: true } },
  ai_calls: { invite_id: NO_SUCH_ID },
  write_calls: { invite_id: NO_SUCH_ID, route: 'checkin' },
};

const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.log('SKIP: set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env to run the security test.');
  process.exit(0);
}
if (!key.startsWith('sb_publishable_')) {
  console.error('STOP: SUPABASE_PUBLISHABLE_KEY must be the publishable key (sb_publishable_...).');
  console.error('The secret key belongs only in Vercel, never in .env.');
  process.exit(1);
}

// A refusal: Supabase/PostgREST says "no" (401/403), or Postgres says
// "permission denied" (42501). A 404 "table not found" (PGRST205) also means
// the API can't reach the table, which counts as refused but is labelled.
function judge(status, body) {
  const code = body?.code;
  if (status === 401 || status === 403 || code === '42501') return { refused: true, how: `${status} ${code ?? ''}`.trim() };
  if (status === 404 && code === 'PGRST205') return { refused: true, how: '404 table hidden from the API' };
  return { refused: false, how: `${status} ${code ?? ''}`.trim() };
}

async function attempt(label, path, { method = 'GET', body, withKey = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (withKey) headers.apikey = key;
  let status;
  let data = null;
  try {
    const res = await fetch(`${url}${path}`, { method, headers, body: body && JSON.stringify(body) });
    status = res.status;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
  } catch (err) {
    return { label, refused: false, how: `network error: ${err.message}` };
  }
  return { label, ...judge(status, data), status, data };
}

const results = [];
for (const withKey of [true, false]) {
  const who = withKey ? 'publishable key' : 'no key';
  for (const table of TABLES) {
    results.push(await attempt(`${who}: read ${table}`, `/rest/v1/${table}?select=*&limit=1`, { withKey }));
    results.push(await attempt(`${who}: add to ${table}`, `/rest/v1/${table}`, { method: 'POST', body: DUMMY_ROWS[table], withKey }));
    const filter = table === 'profiles' ? `user_id=eq.${NO_SUCH_ID}` : `id=eq.${NO_SUCH_ID}`;
    results.push(await attempt(`${who}: change ${table}`, `/rest/v1/${table}?${filter}`, { method: 'PATCH', body: { created_at: '2000-01-01T00:00:00Z' }, withKey }));
    results.push(await attempt(`${who}: delete from ${table}`, `/rest/v1/${table}?${filter}`, { method: 'DELETE', withKey }));
  }
  results.push(await attempt(`${who}: run take_ai_slot`, '/rest/v1/rpc/take_ai_slot', { method: 'POST', body: { p_invite_id: NO_SUCH_ID }, withKey }));
  results.push(await attempt(`${who}: run take_write_slot`, '/rest/v1/rpc/take_write_slot', { method: 'POST', body: { p_invite_id: NO_SUCH_ID, p_route: 'checkin' }, withKey }));
}

let failed = 0;
for (const r of results) {
  if (!r.refused) failed++;
  console.log(`${r.refused ? 'PASS' : 'FAIL'}  ${r.label}  (${r.how})`);
}

console.log('');
if (failed) {
  console.log(`FAIL: ${failed} of ${results.length} attempts were NOT refused. The database is not locked.`);
  console.log('Do not deploy. Re-run supabase/schema.sql, and check the Table Editor for rows labelled "security-test" and delete them.');
  process.exit(1);
}
console.log(`PASS: all ${results.length} attempts were refused. The public key can't read, add, change or delete anything.`);
