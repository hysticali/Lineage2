import React from 'react';
import Modal from './Modal';

export async function accessApi(url, body, method = 'POST') {
  const response = await fetch(url, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Access request failed');
  return data;
}

function AccountForm({ session, invite, onDone }) {
  const [info, setInfo] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (invite) accessApi(`/api/auth/invitations/${encodeURIComponent(invite)}`).then(setInfo).catch(e => setError(e.message));
  }, [invite]);
  const setup = !invite && session.setupAvailable;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (invite && info?.account_exists && !session.user) {
        await accessApi('/api/auth/login', fields);
      }
      const result = await accessApi(invite ? `/api/auth/invitations/${encodeURIComponent(invite)}/accept` : `/api/auth/${setup ? 'setup' : 'login'}`, fields);
      if (invite) {
        const url = new URL(location.href); url.search = ''; url.searchParams.set('tree', result.treeId);
        history.replaceState(null, '', url);
      }
      onDone();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <main className="load-state account-form">
    <h1>{invite ? 'Accept tree invitation' : setup ? 'Set up your private workspace' : 'Sign in to Rootline'}</h1>
    {invite && info && <p>Invitation for {info.username} · {info.role.toLowerCase()}. {info.account_exists ? 'Sign in with your existing account to accept.' : 'Choose a password to create your invited account.'}</p>}
    {session.user && <p>Signed in as {session.user.username}. The invitation must match this account.</p>}
    <form onSubmit={submit}><fieldset disabled={busy || (invite && !info)} className="person-fields">
      {(!session.user || !invite) && <>
        <label>Username<input name="username" required autoComplete="username" defaultValue={info?.username || ''} key={info?.username || 'username'} minLength={3} maxLength={80} /></label>
        <label>Password<input name="password" required type="password" autoComplete={setup || (invite && !info?.account_exists) ? 'new-password' : 'current-password'} minLength={setup || (invite && !info?.account_exists) ? 12 : 1} maxLength={1024} /></label>
      </>}
      {setup && <label>Setup token<input name="token" required type="password" autoComplete="off" /></label>}
      <button type="submit">{busy ? 'Working…' : invite ? 'Accept invitation' : setup ? 'Create owner account' : 'Sign in'}</button>
    </fieldset></form>
    {error && <p role="alert">{error}</p>}
    {invite && <a href="/">Return to workspace</a>}
  </main>;
}

function AccountMenu({ user, onDone }) {
  const menu = React.useRef(null);
  const [changing, setChanging] = React.useState(false), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  async function logout() {
    setBusy(true); setError('');
    try { await accessApi('/api/auth/logout', {}); onDone(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function password(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await accessApi('/api/auth/password', Object.fromEntries(new FormData(event.currentTarget))); onDone(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  React.useEffect(() => {
    const outside = event => { if (menu.current && !menu.current.contains(event.target)) menu.current.open = false; };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, []);
  return <div className="account-control">
    <details className="account-menu" ref={menu} onKeyDown={event => { if (event.key === 'Escape' && menu.current.open) { event.preventDefault(); menu.current.open = false; menu.current.querySelector('summary').focus(); } }}>
      <summary>Account</summary><div className="account-popover">
        <p>Signed in as {user.username}</p><button disabled={busy} onClick={() => { menu.current.open = false; setChanging(true); }}>Change password</button><button disabled={busy} onClick={logout}>Sign out</button>
      </div>
    </details>
    {error && !changing && <p role="alert">{error}</p>}
    {changing && <Modal title="Change password" returnFocus={() => menu.current?.querySelector('summary')} onClose={() => { if (!busy) { setChanging(false); setError(''); } }}>
      <p>Changing your password signs out all your sessions.</p><form onSubmit={password}><fieldset className="person-fields" disabled={busy}>
        <label>Current password<input name="currentPassword" required type="password" autoComplete="current-password" /></label>
        <label>New password<input name="newPassword" required minLength={12} maxLength={1024} type="password" autoComplete="new-password" /></label>
        <button type="submit">Save password and sign out</button>
      </fieldset></form>{error && <p role="alert">{error}</p>}
    </Modal>}
  </div>;
}

export default function AccessBoundary({ children }) {
  const [session, setSession] = React.useState(null), [error, setError] = React.useState(''), [epoch, setEpoch] = React.useState(0);
  const params = new URLSearchParams(location.search), invite = params.get('invite'), share = params.get('share');
  const reload = React.useCallback(() => { setSession(null); setError(''); setEpoch(n => n + 1); }, []);
  React.useEffect(() => {
    let active = true;
    async function check() {
      try {
        const response = await fetch('/api/auth/session');
        const staticPage = document.querySelector('meta[name="lineage-mode"]')?.content !== 'database';
        const next = staticPage && response.status === 404 && !(response.headers.get('content-type') || '').includes('application/json') ? { mode: 'local', user: null } : await response.json();
        if (!response.ok && next.mode !== 'local') throw new Error(next.error || 'Account service is unavailable');
        if (active) { setError(''); setSession(current => current?.user?.id === next.user?.id && current?.mode === next.mode && current?.setupAvailable === next.setupAvailable ? current : next); }
      } catch { if (active) setError('Account service is unavailable. Unsaved forms are retained in memory while reconnecting.'); }
    }
    check();
    const timer = setInterval(check, 5000);
    addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); removeEventListener('focus', check); };
  }, [epoch]);
  if (!session) return <main className="load-state"><h1>Rootline</h1>{error ? <><p role="alert">{error}</p><button onClick={reload}>Retry loading archive</button></> : <p role="status">Loading workspace…</p>}</main>;
  if (session.mode === 'private' && !share && (invite || !session.user)) return <AccountForm key={`${epoch}:${invite}`} session={session} invite={invite} onDone={reload} />;
  return <React.Fragment key={`${epoch}:${session.user?.id || 'local'}`}>
    {error && <p role="status" className="account-bar">{error}</p>}
    {children({ session, shareToken: share, onSessionChange: reload, accountControl: session.mode === 'private' && !share ? <AccountMenu user={session.user} onDone={reload} /> : null })}
  </React.Fragment>;
}

export function PrivacyEditor({ treeId, person, revision, onSaved, onClose }) {
  const [status, setStatus] = React.useState(person.livingStatus || 'UNKNOWN'), [published, setPublished] = React.useState(Boolean(person.isPublic)), [privateRecord, setPrivate] = React.useState(Boolean(person.privateRecord));
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const requestId = React.useRef(crypto.randomUUID());
  function changed() { requestId.current = crypto.randomUUID(); setError(''); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await accessApi(`/api/trees/${treeId}/people/${encodeURIComponent(person.id)}/privacy`, { requestId: requestId.current, expectedRevision: revision, livingStatus: status, isPublic: published, privateRecord }, 'PATCH');
      onSaved(result.archive); onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <Modal title={`Privacy for ${person.name}`} onClose={() => { if (!busy) onClose(); }}>
    <p>Viewers and links see only explicitly approved deceased people and links between them. Notes, sources, citations, attachments, and recovery data remain private. Editors can read the full permitted tree.</p>
    {(person.confidential || person.locked) && <p className="notice">This imported record is restricted and cannot be published.</p>}
    <form onSubmit={save}><fieldset disabled={busy} className="person-fields">
      <label>Living status<select value={status} onChange={e => { setStatus(e.target.value); if (e.target.value !== 'DECEASED') setPublished(false); changed(); }}><option value="UNKNOWN">Unknown</option><option value="LIVING">Living</option><option value="DECEASED">Deceased</option></select></label>
      <label className="checkbox"><input type="checkbox" checked={privateRecord} onChange={e => { setPrivate(e.target.checked); if (e.target.checked) setPublished(false); changed(); }} />Mark record private</label>
      <label className="checkbox"><input type="checkbox" checked={published} disabled={status !== 'DECEASED' || privateRecord || person.confidential || person.locked} onChange={e => { setPublished(e.target.checked); changed(); }} />Approve basic details for viewers and links</label>
      <button type="submit">Save privacy settings</button>
    </fieldset></form>{error && <p role="alert">{error}</p>}
  </Modal>;
}
