const { promisify } = require('node:util');
const { randomBytes, randomUUID, scrypt, createHash, timingSafeEqual } = require('node:crypto');
const { InputError } = require('./edit-tree');
const derive = promisify(scrypt);
const HASH_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = randomBytes(16);
const tokenHash = value => createHash('sha256').update(String(value || '')).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
function username(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9_.@+-]{2,79}$/.test(normalized)) throw new InputError('Username must be 3–80 letters, numbers, or . _ @ + -');
  return normalized;
}
function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 1024) throw new InputError('Password must contain 12–1024 characters');
  return value;
}
async function hashPassword(value) {
  password(value);
  const salt = randomBytes(16), hash = await derive(value, salt, 64, HASH_OPTIONS);
  return `scrypt$32768$8$1$${salt.toString('hex')}$${hash.toString('hex')}`;
}
async function verifyPassword(value, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  const valid = parts.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$32768$8$1' && /^[a-f0-9]{32}$/.test(parts[4]) && /^[a-f0-9]{128}$/.test(parts[5]);
  const input = typeof value === 'string' && value.length <= 1024 ? value : '';
  const computed = await derive(input, valid ? Buffer.from(parts[4], 'hex') : DUMMY_SALT, 64, HASH_OPTIONS);
  return valid && timingSafeEqual(computed, Buffer.from(parts[5], 'hex'));
}
async function transaction(pool, work) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function audit(client, actorId, treeId, action, detail = {}) {
  await client.query('INSERT INTO security_events (id, actor_id, tree_id, action, detail) VALUES ($1, $2, $3, $4, $5::jsonb)', [randomUUID(), actorId || null, treeId || null, action, JSON.stringify(detail)]);
}
async function memberRole(client, treeId, userId) {
  return (await client.query('SELECT role FROM tree_memberships WHERE tree_id = $1 AND user_id = $2', [treeId, userId])).rows[0]?.role || null;
}
async function owner(client, treeId, actorId) {
  await client.query('SELECT id FROM trees WHERE id = $1 FOR UPDATE', [treeId]);
  if (await memberRole(client, treeId, actorId) !== 'OWNER') throw new InputError('Tree owner permission is required', 403);
}
async function createAccount(client, name, value) {
  const id = randomUUID();
  try { await client.query('INSERT INTO app_users (id, username, password_hash) VALUES ($1, $2, $3)', [id, username(name), await hashPassword(value)]); }
  catch (error) { if (error.code === '23505') throw new InputError('Username is unavailable', 409); throw error; }
  return { id, username: username(name) };
}
async function setupAccount(pool, config, input) {
  if (!config.setupToken || typeof input.token !== 'string' || !timingSafeEqual(Buffer.from(tokenHash(config.setupToken)), Buffer.from(tokenHash(input.token)))) throw new InputError('Setup is unavailable or the setup token is invalid', 403);
  return transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rootline-account-setup'))");
    if ((await client.query('SELECT id FROM app_users LIMIT 1')).rowCount) throw new InputError('Initial account setup is already complete', 409);
    const user = await createAccount(client, input.username, input.password);
    await client.query(`INSERT INTO tree_memberships (tree_id, user_id, role) SELECT t.id, $1, 'OWNER' FROM trees t
      WHERE NOT EXISTS (SELECT 1 FROM tree_memberships m WHERE m.tree_id = t.id)`, [user.id]);
    await audit(client, user.id, null, 'initial-account-created'); return user;
  });
}
async function login(pool, input, ip) {
  const normalized = typeof input.username === 'string' ? input.username.trim().toLowerCase().slice(0, 80) : '';
  const keys = [`account:${normalized}`, `ip:${ip || 'unknown'}`].map(tokenHash);
  const limited = (await pool.query(`SELECT key_hash, failures FROM auth_failures WHERE key_hash = ANY($1::text[]) AND window_start > current_timestamp - interval '15 minutes'`, [keys])).rows;
  if (limited.some(r => r.failures >= (r.key_hash === keys[0] ? 10 : 100))) throw new InputError('Too many login attempts. Try again later.', 429);
  const user = (await pool.query('SELECT id, username, password_hash, disabled FROM app_users WHERE username = $1', [normalized])).rows[0];
  const valid = await verifyPassword(input.password, user?.password_hash);
  if (!valid || !user || user.disabled) {
    for (const key of keys) await pool.query(`INSERT INTO auth_failures (key_hash, failures) VALUES ($1, 1) ON CONFLICT (key_hash) DO UPDATE SET
      failures = CASE WHEN auth_failures.window_start <= current_timestamp - interval '15 minutes' THEN 1 ELSE auth_failures.failures + 1 END,
      window_start = CASE WHEN auth_failures.window_start <= current_timestamp - interval '15 minutes' THEN current_timestamp ELSE auth_failures.window_start END`, [key]);
    throw new InputError('Invalid username or password', 401);
  }
  await pool.query('DELETE FROM auth_failures WHERE key_hash = $1', [keys[0]]);
  return { id: user.id, username: user.username };
}
async function issueSession(pool, user) {
  const token = secret();
  await pool.query("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, current_timestamp + interval '7 days')", [tokenHash(token), user.id]);
  return token;
}
async function sessionUser(pool, token) {
  if (!validToken(token)) return null;
  return (await pool.query(`SELECT u.id, u.username FROM auth_sessions s JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > current_timestamp AND NOT u.disabled`, [tokenHash(token)])).rows[0] || null;
}
async function changePassword(pool, user, input) {
  password(input.newPassword);
  return transaction(pool, async client => {
    const row = (await client.query('SELECT password_hash FROM app_users WHERE id = $1 FOR UPDATE', [user.id])).rows[0];
    if (!row || !await verifyPassword(input.currentPassword, row.password_hash)) throw new InputError('Current password is incorrect', 403);
    await client.query('UPDATE app_users SET password_hash = $1 WHERE id = $2', [await hashPassword(input.newPassword), user.id]);
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [user.id]);
    await audit(client, user.id, null, 'password-changed');
  });
}
async function createInvitation(pool, treeId, actor, input) {
  const name = username(input.username);
  if (!['EDITOR', 'VIEWER'].includes(input.role)) throw new InputError('Choose editor or viewer');
  const days = input.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new InputError('Invitation lifetime must be 1–30 days');
  return transaction(pool, async client => {
    await owner(client, treeId, actor.id);
    const id = randomUUID(), token = secret();
    await client.query(`INSERT INTO tree_invitations (id, tree_id, invitee_username, role, token_hash, created_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, current_timestamp + $7 * interval '1 day')`, [id, treeId, name, input.role, tokenHash(token), actor.id, days]);
    await audit(client, actor.id, treeId, 'invitation-created', { username: name, role: input.role });
    return { id, token, username: name, role: input.role };
  });
}
async function invitationInfo(pool, token) {
  if (!validToken(token)) throw new InputError('Invitation is unavailable', 404);
  const row = (await pool.query(`SELECT i.invitee_username AS username, i.role, EXISTS (SELECT 1 FROM app_users u WHERE u.username = i.invitee_username) AS account_exists
    FROM tree_invitations i WHERE token_hash = $1 AND expires_at > current_timestamp AND revoked_at IS NULL AND accepted_at IS NULL`, [tokenHash(token)])).rows[0];
  if (!row) throw new InputError('Invitation is unavailable', 404);
  return row;
}
async function acceptInvitation(pool, token, actor, input = {}) {
  if (!validToken(token)) throw new InputError('Invitation is unavailable', 404);
  return transaction(pool, async client => {
    const initial = (await client.query('SELECT tree_id FROM tree_invitations WHERE token_hash = $1', [tokenHash(token)])).rows[0];
    if (!initial) throw new InputError('Invitation is unavailable', 404);
    await client.query('SELECT id FROM trees WHERE id = $1 FOR UPDATE', [initial.tree_id]);
    const invitation = (await client.query(`SELECT * FROM tree_invitations WHERE token_hash = $1 AND expires_at > current_timestamp
      AND revoked_at IS NULL AND accepted_at IS NULL FOR UPDATE`, [tokenHash(token)])).rows[0];
    if (!invitation) throw new InputError('Invitation is unavailable', 404);
    let user = actor;
    if (!user) {
      if (username(input.username) !== invitation.invitee_username) throw new InputError('Use the invited username', 403);
      user = await createAccount(client, input.username, input.password);
    }
    if (user.username !== invitation.invitee_username) throw new InputError('Sign in as the invited account', 403);
    await client.query(`INSERT INTO tree_memberships (tree_id, user_id, role) VALUES ($1, $2, $3)
      ON CONFLICT (tree_id, user_id) DO NOTHING`, [invitation.tree_id, user.id, invitation.role]);
    await client.query('UPDATE tree_invitations SET accepted_by = $1, accepted_at = current_timestamp WHERE id = $2', [user.id, invitation.id]);
    await audit(client, user.id, invitation.tree_id, 'invitation-accepted', { role: invitation.role });
    return { user, treeId: invitation.tree_id };
  });
}
async function manageMember(pool, treeId, actor, targetId, role) {
  if (role !== null && !['OWNER', 'EDITOR', 'VIEWER'].includes(role)) throw new InputError('Invalid tree role');
  return transaction(pool, async client => {
    await owner(client, treeId, actor.id);
    const targetRole = await memberRole(client, treeId, targetId);
    if (!targetRole) throw new InputError('Tree member not found', 404);
    if (targetRole === 'OWNER' && role !== 'OWNER' && (await client.query("SELECT user_id FROM tree_memberships WHERE tree_id = $1 AND role = 'OWNER'", [treeId])).rowCount < 2) throw new InputError('A tree must retain at least one owner', 409);
    if (role) await client.query('UPDATE tree_memberships SET role = $1 WHERE tree_id = $2 AND user_id = $3', [role, treeId, targetId]);
    else await client.query('DELETE FROM tree_memberships WHERE tree_id = $1 AND user_id = $2', [treeId, targetId]);
    if (targetRole === 'OWNER' && role !== 'OWNER') {
      await client.query('UPDATE tree_invitations SET revoked_at = current_timestamp WHERE tree_id = $1 AND created_by = $2 AND accepted_at IS NULL AND revoked_at IS NULL', [treeId, targetId]);
      await client.query('UPDATE tree_share_links SET revoked_at = current_timestamp WHERE tree_id = $1 AND created_by = $2 AND revoked_at IS NULL', [treeId, targetId]);
    }
    await audit(client, actor.id, treeId, role ? 'member-role-changed' : 'member-removed', { userId: targetId, role });
  });
}
async function createShare(pool, treeId, actor, input) {
  const days = input.days ?? 7;
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new InputError('Share lifetime must be 1–30 days');
  if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 200) throw new InputError('A share label of 1–200 characters is required');
  return transaction(pool, async client => {
    await owner(client, treeId, actor.id);
    const id = randomUUID(), token = secret();
    await client.query(`INSERT INTO tree_share_links (id, tree_id, token_hash, label, created_by, expires_at)
      VALUES ($1, $2, $3, $4, $5, current_timestamp + $6 * interval '1 day')`, [id, treeId, tokenHash(token), input.label.trim(), actor.id, days]);
    await audit(client, actor.id, treeId, 'share-created', { label: input.label.trim() });
    return { id, token };
  });
}
async function shareTree(pool, token) {
  if (!validToken(token)) throw new InputError('Share link is unavailable', 404);
  const row = (await pool.query('SELECT tree_id AS "treeId", label FROM tree_share_links WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > current_timestamp', [tokenHash(token)])).rows[0];
  if (!row) throw new InputError('Share link is unavailable', 404);
  return row;
}
async function revoke(pool, treeId, actor, kind, id) {
  const table = kind === 'invitation' ? 'tree_invitations' : kind === 'share' ? 'tree_share_links' : null;
  if (!table) throw new InputError('Unknown access record');
  return transaction(pool, async client => {
    await owner(client, treeId, actor.id);
    const result = await client.query(`UPDATE ${table} SET revoked_at = current_timestamp WHERE tree_id = $1 AND id = $2 RETURNING id`, [treeId, id]);
    if (!result.rowCount) throw new InputError('Access record not found', 404);
    await audit(client, actor.id, treeId, `${kind}-revoked`);
  });
}
module.exports = { tokenHash, validToken, username, hashPassword, verifyPassword, setupAccount, login, issueSession, sessionUser, changePassword, memberRole, createInvitation, invitationInfo, acceptInvitation, manageMember, createShare, shareTree, revoke, audit };
