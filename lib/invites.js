// Invite codes (Build 3, Plan.md B3-4). No full sign-in: each friend tester
// gets a personal link like /?code=AbC... The browser keeps the code and sends
// it with every API call in the "x-invite-code" header.
//
// - Codes are 128 random bits written as 22 URL-safe characters.
// - Only a SHA-256 hash of the code is stored, never the code itself.
// - A profile belongs to the invite that created it. Another invite can't
//   read or change it, even if it knows her browser ID.

import { createHash, randomBytes } from 'node:crypto';
import { findInviteByHash, setProfileInvite } from './db.js';

export const INVITE_HEADER = 'x-invite-code';
const CODE_FORMAT = /^[A-Za-z0-9_-]{22}$/;
export const LABEL_FORMAT = /^[a-z0-9-]{1,30}$/; // e.g. "tester-3", never a real name

export function makeInviteCode() {
  return randomBytes(16).toString('base64url');
}

export function isValidInviteCode(code) {
  return typeof code === 'string' && CODE_FORMAT.test(code);
}

export function hashInviteCode(code) {
  return createHash('sha256').update(code).digest('hex');
}

// The invite behind this request: { id, label }, or null if the code is
// missing, malformed, unknown or revoked.
export async function inviteFor(request) {
  const code = request.headers.get(INVITE_HEADER);
  if (!isValidInviteCode(code)) return null;
  return findInviteByHash(hashInviteCode(code));
}

// 401. invite: 'required' when no code was sent at all; invite: 'invalid'
// when a code was sent but is malformed, unknown or revoked (a dead link).
export const DEAD_LINK_MESSAGE = 'This link no longer works. Ask Julia for a new one.';

export function inviteRequired(request) {
  const sent = Boolean(request?.headers.get(INVITE_HEADER));
  return Response.json(
    sent
      ? { error: DEAD_LINK_MESSAGE, invite: 'invalid' }
      : { error: 'This app is invite-only. Please open your personal invite link.', invite: 'required' },
    { status: 401 },
  );
}

// 403, invite: 'other': this browser ID's profile belongs to another invite.
export function otherInvite() {
  return Response.json(
    { error: 'This setup was made with a different invite link. Please open your own link.', invite: 'other' },
    { status: 403 },
  );
}

// Does this saved profile belong to this invite?
// Profiles saved locally before Build 3 have no invite: the first invite that
// uses one claims it (only possible in the local file; the live database
// requires an invite on every profile).
export async function ownsProfile(profile, invite, userId) {
  if (!profile.inviteId) {
    await setProfileInvite(userId, invite.id);
    profile.inviteId = invite.id;
    return true;
  }
  return profile.inviteId === invite.id;
}
