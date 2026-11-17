// Makes a personal invite link for one friend tester (Plan.md B3-4).
//
//   npm run invite -- tester-3            → live: prints the link + one SQL line
//   npm run invite -- --local tester-3    → local: adds the invite to data/cyclesync-db.json
//
// Live: paste the printed SQL line into Supabase → SQL Editor → Run, then send
// the link to that friend privately. This script needs no keys and never
// stores the code: only its hash goes into the database.
//
// The link uses APP_URL from .env (e.g. https://cyclesync.vercel.app), or
// http://localhost:3000 for --local.

import { makeInviteCode, hashInviteCode, LABEL_FORMAT } from '../lib/invites.js';

const args = process.argv.slice(2);
const local = args.includes('--local');
const label = args.find((a) => !a.startsWith('--'));

if (!label || !LABEL_FORMAT.test(label)) {
  console.error('Usage: npm run invite -- [--local] <label>');
  console.error('The label is a nickname like "tester-3": lowercase letters, numbers and dashes, up to 30. Never a real name.');
  process.exit(1);
}

const code = makeInviteCode();
const hash = hashInviteCode(code);

if (local) {
  const { addInvite } = await import('../lib/db.js');
  await addInvite(label, hash);
  console.log(`Local invite "${label}" added.`);
  console.log(`Open: http://localhost:${process.env.PORT || 3000}/?code=${code}`);
} else {
  const base = (process.env.APP_URL || 'https://<your-app>.vercel.app').replace(/\/+$/, '');
  console.log(`Invite for "${label}"\n`);
  console.log('1. Paste this into Supabase → SQL Editor → Run:\n');
  // Safe to build as text: the label is checked above and the hash is hex.
  console.log(`   insert into public.invites (code_hash, label) values ('${hash}', '${label}');\n`);
  console.log('2. Send this link to them privately (not in a group chat):\n');
  console.log(`   ${base}/?code=${code}\n`);
  console.log('This code is shown once and is not saved anywhere. If it is lost, make a new invite.');
}
