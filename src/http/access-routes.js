const express = require('express');
const access = require('../services/access');
const { publicArchive, publicGedcom } = require('../services/privacy');
const { InputError } = require('../services/edit-tree');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicReads = new Set(['', '/people', '/family-data', '/gedcom']);
function installAccess(app, repository, config) {
  const pool = repository.pool;
  const cookieName = config.secureCookies ? '__Host-rootline_session' : 'rootline_session';
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: config.secureCookies, path: '/' };
  async function signedIn(response, user) {
    response.cookie(cookieName, await access.issueSession(pool, user), { ...cookieOptions, maxAge: 7 * 24 * 3600 * 1000 });
    return user;
  }
  app.use('/api', async (request, response, next) => {
    response.set('Cache-Control', 'private, no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const expected = config.origin || `${request.protocol}://${request.get('host')}`;
      if ((request.get('origin') && request.get('origin') !== expected) || request.get('sec-fetch-site') === 'cross-site') throw new InputError('Cross-origin writes are not allowed', 403);
    }
    request.accessMode = config.mode;
    if (config.mode === 'local') request.actor = { id: null, username: 'Local user' };
    else {
      const matches = String(request.get('cookie') || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
      request.sessionToken = matches.length === 1 ? matches[0].slice(cookieName.length + 1) : null;
      request.actor = await access.sessionUser(pool, request.sessionToken);
    }
    next();
  });
  app.use('/api/auth', express.json({ limit: '16kb' }));
  app.get('/api/auth/session', async (request, response) => {
    const setupAvailable = config.mode === 'private' && Boolean(config.setupToken) && !(await pool.query('SELECT id FROM app_users LIMIT 1')).rowCount;
    response.json({ mode: config.mode, user: request.actor, setupAvailable });
  });
  function privateMode() { if (config.mode !== 'private') throw new InputError('Account access requires private mode', 404); }
  app.post('/api/auth/setup', async (request, response) => {
    privateMode(); const user = await access.setupAccount(pool, config, request.body || {});
    response.status(201).json({ user: await signedIn(response, user) });
  });
  app.post('/api/auth/login', async (request, response) => {
    privateMode(); const user = await access.login(pool, request.body || {}, request.ip);
    response.json({ user: await signedIn(response, user) });
  });
  app.post('/api/auth/logout', async (request, response) => {
    privateMode();
    if (request.sessionToken) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [access.tokenHash(request.sessionToken)]);
    response.clearCookie(cookieName, cookieOptions).json({ signedOut: true });
  });
  app.post('/api/auth/password', async (request, response) => {
    privateMode(); if (!request.actor) throw new InputError('Sign in is required', 401);
    await access.changePassword(pool, request.actor, request.body || {});
    response.clearCookie(cookieName, cookieOptions).json({ signedOut: true });
  });
  app.get('/api/auth/invitations/:token', async (request, response) => {
    privateMode(); response.json(await access.invitationInfo(pool, request.params.token));
  });
  app.post('/api/auth/invitations/:token/accept', async (request, response) => {
    privateMode(); const result = await access.acceptInvitation(pool, request.params.token, request.actor, request.body || {});
    response.json({ ...result, user: await signedIn(response, result.user) });
  });
  app.get('/api/share/:token', async (request, response) => {
    privateMode(); const shared = await access.shareTree(pool, request.params.token);
    const data = await publicArchive(pool, shared.treeId, shared.label);
    response.json({ ...data, shared: true, permissions: { mode: 'shared', role: 'VIEWER', canEdit: false, canManage: false } });
  });
  app.get('/api/share/:token/gedcom', async (request, response) => {
    privateMode(); const shared = await access.shareTree(pool, request.params.token);
    response.json(publicGedcom(await publicArchive(pool, shared.treeId, shared.label)));
  });
  app.use('/api', (request, _response, next) => {
    if (request.path === '/health') return next();
    if (!request.actor) throw new InputError('Sign in is required', 401);
    next();
  });
  app.use('/api/trees/:treeId', async (request, _response, next) => {
    if (!UUID.test(request.params.treeId)) throw new InputError('Invalid tree ID');
    const role = config.mode === 'local' ? 'OWNER' : await access.memberRole(pool, request.params.treeId, request.actor.id);
    if (!role) throw new InputError('Tree not found', 404);
    request.treeRole = role;
    if (role === 'VIEWER' && (!['GET', 'HEAD'].includes(request.method) || !publicReads.has(request.path.replace(/\/$/, '')))) throw new InputError('This tree role permits only the public read-only view', 403);
    next();
  });
  app.use('/api/trees/:treeId/access', express.json({ limit: '16kb' }), (request, _response, next) => {
    privateMode(); if (request.treeRole !== 'OWNER') throw new InputError('Tree owner permission is required', 403); next();
  });
  app.get('/api/trees/:treeId/access', async (request, response) => {
    const treeId = request.params.treeId;
    const members = (await pool.query('SELECT u.id, u.username, m.role FROM tree_memberships m JOIN app_users u ON u.id = m.user_id WHERE m.tree_id = $1 ORDER BY u.username', [treeId])).rows;
    const invitations = (await pool.query('SELECT id, invitee_username, role, expires_at, accepted_at, revoked_at FROM tree_invitations WHERE tree_id = $1 ORDER BY created_at DESC', [treeId])).rows;
    const shares = (await pool.query('SELECT id, label, expires_at, revoked_at FROM tree_share_links WHERE tree_id = $1 ORDER BY created_at DESC', [treeId])).rows;
    const events = (await pool.query('SELECT e.id, e.action, e.detail, e.created_at, u.username AS actor FROM security_events e LEFT JOIN app_users u ON u.id = e.actor_id WHERE e.tree_id = $1 ORDER BY e.created_at DESC LIMIT 100', [treeId])).rows;
    response.json({ members, invitations, shares, events });
  });
  app.post('/api/trees/:treeId/access/invitations', async (request, response) => {
    response.status(201).json(await access.createInvitation(pool, request.params.treeId, request.actor, request.body || {}));
  });
  app.post('/api/trees/:treeId/access/shares', async (request, response) => {
    response.status(201).json(await access.createShare(pool, request.params.treeId, request.actor, request.body || {}));
  });
  app.patch('/api/trees/:treeId/access/members/:userId', async (request, response) => {
    if (!UUID.test(request.params.userId)) throw new InputError('Invalid user ID');
    await access.manageMember(pool, request.params.treeId, request.actor, request.params.userId, request.body?.role);
    response.json({ updated: true });
  });
  for (const [path, kind] of [['invitations', 'invitation'], ['shares', 'share']]) app.post(`/api/trees/:treeId/access/${path}/:id/revoke`, async (request, response) => {
    if (!UUID.test(request.params.id)) throw new InputError('Invalid access record ID');
    await access.revoke(pool, request.params.treeId, request.actor, kind, request.params.id); response.json({ revoked: true });
  });
  return {
    permissions(role = 'OWNER') { return { mode: config.mode, role, canEdit: role !== 'VIEWER', canManage: config.mode === 'private' && role === 'OWNER' }; },
    async role(request, treeId, minimum = 'VIEWER') {
      const role = config.mode === 'local' ? 'OWNER' : await access.memberRole(pool, treeId, request.actor.id);
      if (!role) throw new InputError('Tree not found', 404);
      if (minimum === 'EDITOR' && role === 'VIEWER') throw new InputError('Editor permission is required', 403);
      return role;
    },
  };
}
module.exports = { installAccess };
