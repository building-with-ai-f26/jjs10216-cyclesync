// Live storage: Supabase Postgres, reached through its REST API with plain
// fetch (no packages). Only lib/db.js uses this file. Same functions as
// lib/db-local.js; the tables are in supabase/schema.sql.
//
// It uses the SECRET key (role service_role), which is the only role the
// tables are granted to. The key comes from Vercel's environment settings,
// is only ever sent in the apikey header, and is never logged or put in an
// error message.
//
// Rows are turned back into the same shapes the local file uses, so the rest
// of the app can't tell the two apart.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT_MS = 10_000;

export function createSupabaseDb({ url, key, fetchFn = fetch }) {
  if (!url || !/^https:\/\//.test(url)) throw new Error('SUPABASE_URL must be set to your project URL (https://...supabase.co).');
  if (!key?.startsWith('sb_secret_')) throw new Error('SUPABASE_SECRET_KEY must be the secret key (sb_secret_...).');
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;

  // One REST call. Returns the parsed JSON (or null for an empty reply).
  async function rest(method, path, { body, prefer } = {}) {
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    let res;
    try {
      res = await fetchFn(`${base}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(err.name === 'TimeoutError' ? 'The database took too long to answer.' : 'Could not reach the database.');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      // Supabase's own message (it never contains the key) so problems can be traced.
      throw new Error(`Database error ${res.status}${data?.code ? ` (${data.code})` : ''}${data?.message ? `: ${data.message}` : ''}`);
    }
    return data;
  }
  const one = (rows) => (Array.isArray(rows) ? rows[0] ?? null : null);
  const eq = (value) => `eq.${encodeURIComponent(value)}`;

  // ---------- Rows → the same shapes as the local file ----------
  function toProfile(row) {
    if (!row) return null;
    return { ...row.data, inviteId: row.invite_id, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  function toCheckin(row) {
    if (!row) return null;
    return {
      id: row.id, userId: row.user_id, inviteId: row.invite_id, date: row.checkin_date, source: row.source,
      ...row.data, response: row.response, respondedAt: row.responded_at ?? undefined, createdAt: row.created_at,
    };
  }

  async function getProfile(userId) {
    if (!UUID.test(userId)) return null;
    return toProfile(one(await rest('GET', `/profiles?select=*&user_id=${eq(userId)}`)));
  }

  async function getCheckin(checkinId) {
    if (typeof checkinId !== 'string' || !UUID.test(checkinId)) return null;
    return toCheckin(one(await rest('GET', `/checkins?select=*&id=${eq(checkinId)}`)));
  }

  return {
    async findInviteByHash(codeHash) {
      if (!/^[0-9a-f]{64}$/.test(codeHash)) return null;
      const row = one(await rest('GET', `/invites?select=id,label,revoked_at&code_hash=${eq(codeHash)}`));
      if (!row || row.revoked_at) return null;
      return { id: row.id, label: row.label };
    },

    async addInvite() {
      throw new Error('Live invites are added with the SQL line that `npm run invite` prints.');
    },

    // Insert, or update her answers. created_at is set by the database on
    // insert and left alone on update; the invite never changes once set.
    async saveProfile(userId, profile, inviteId = null) {
      const existing = await getProfile(userId);
      const now = new Date().toISOString();
      if (existing) {
        const rows = await rest('PATCH', `/profiles?user_id=${eq(userId)}`, {
          body: { data: profile, updated_at: now }, prefer: 'return=representation',
        });
        return toProfile(one(rows));
      }
      const rows = await rest('POST', '/profiles', {
        body: { user_id: userId, invite_id: inviteId, data: profile, updated_at: now }, prefer: 'return=representation',
      });
      return toProfile(one(rows));
    },

    getProfile,

    // Live profiles always have an invite (the column is required), so this
    // only matters for the local file. Kept for the same set of functions.
    async setProfileInvite(userId, inviteId) {
      await rest('PATCH', `/profiles?user_id=${eq(userId)}&invite_id=is.null`, { body: { invite_id: inviteId } });
    },

    async updatePeriodStart(userId, date) {
      const profile = await getProfile(userId);
      if (!profile) return null;
      const { inviteId, createdAt, updatedAt, ...answers } = profile;
      const rows = await rest('PATCH', `/profiles?user_id=${eq(userId)}`, {
        body: { data: { ...answers, lastPeriodStart: date }, updated_at: new Date().toISOString() },
        prefer: 'return=representation',
      });
      return toProfile(one(rows));
    },

    async saveCheckin(record) {
      const { userId, inviteId, date, source, ...data } = record;
      const rows = await rest('POST', '/checkins', {
        body: { user_id: userId, invite_id: inviteId, checkin_date: date, source, data },
        prefer: 'return=representation',
      });
      return one(rows).id;
    },

    getCheckin,

    // Only her own check-ins that showed a recommendation (not a safety message).
    async saveResponse(userId, checkinId, response) {
      const checkin = await getCheckin(checkinId);
      if (!checkin || checkin.userId !== userId || !checkin.recommendation) return null;
      const rows = await rest('PATCH', `/checkins?id=${eq(checkinId)}&user_id=${eq(userId)}`, {
        body: { response, responded_at: new Date().toISOString() },
        prefer: 'return=representation',
      });
      return toCheckin(one(rows));
    },

    // take_ai_slot() in supabase/schema.sql: 'ok' or why not.
    async takeAiSlot(inviteId) {
      return rest('POST', '/rpc/take_ai_slot', { body: { p_invite_id: inviteId } });
    },
  };
}
