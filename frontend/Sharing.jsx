import React from 'react';
import Modal from './Modal';
import { accessApi } from './Access';

export default function Sharing({ treeId }) {
  const [open, setOpen] = React.useState(false), [data, setData] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false), [link, setLink] = React.useState(null), [review, setReview] = React.useState(null);
  const endpoint = `/api/trees/${treeId}/access`;
  async function load() { setData(await accessApi(endpoint)); }
  React.useEffect(() => {
    if (!open || busy || review) return;
    let active = true;
    const refresh = async () => {
      try { const next = await accessApi(endpoint); if (active) setData(next); }
      catch (e) { if (active) setError(e.message); }
    };
    const timer = setInterval(refresh, 5000);
    addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); removeEventListener('focus', refresh); };
  }, [open, busy, review, endpoint]);
  async function run(work) {
    setBusy(true); setError('');
    try { await work(); await load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function create(event, kind) {
    event.preventDefault();
    setLink(null);
    const form = event.currentTarget, fields = Object.fromEntries(new FormData(form)); fields.days = Number(fields.days);
    await run(async () => {
      const result = await accessApi(`${endpoint}/${kind}`, fields);
      const url = new URL('/', location.origin); url.searchParams.set(kind === 'shares' ? 'share' : 'invite', result.token);
      setLink({ kind, url: url.href }); form.reset();
    });
  }
  async function confirm() {
    await run(async () => {
      if (review.kind === 'member') await accessApi(`${endpoint}/members/${review.id}`, { role: review.role }, 'PATCH');
      else await accessApi(`${endpoint}/${review.kind}/${review.id}/revoke`, {});
      setReview(null); setLink(null);
    });
  }
  return <section className="archive-controls" aria-label="Tree sharing">
    <button onClick={() => { setOpen(true); run(load); }}>Manage tree access</button>
    {open && <Modal title="Tree access and sharing" onClose={() => { if (!busy) { setOpen(false); setLink(null); setReview(null); setError(''); } }}>
      <p>Owners manage access. Editors can read the complete tree and edit unlocked records. Viewers and links see only approved deceased people. Links are secrets: share them only with the intended recipient.</p>
      <button disabled={busy} onClick={() => run(load)}>Refresh access list</button>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Updating tree access…</p>}
      {link && <section className="notice"><label>{link.kind === 'shares' ? 'Read-only share link' : 'Invitation link'}<input readOnly value={link.url} onFocus={e => e.target.select()} /></label><p>Copy this link now. Its secret is shown only when created. It expires after the chosen number of days; you can revoke it earlier.</p></section>}
      {review ? <section aria-label="Review access change"><h3>Review access change</h3><p>{review.message}</p><div className="toolbar"><button disabled={busy} onClick={confirm}>Confirm access change</button><button disabled={busy} onClick={() => setReview(null)}>Cancel access change</button></div></section> : <>
        <h3>Members</h3>
        {data?.members.map(member => <Member key={member.id} member={member} busy={busy} onReview={role => setReview({ kind: 'member', id: member.id, role, message: `${role ? `Change ${member.username} to ${role.toLowerCase()}` : `Remove ${member.username}'s access`}? This takes effect on subsequent requests and may interrupt their open forms. Removing or demoting an owner also revokes their pending invitations and share links.` })} />)}
        <h3>Invite a collaborator</h3>
        <form onSubmit={e => create(e, 'invitations')}><fieldset className="person-fields" disabled={busy}>
          <label>Invited username<input required name="username" minLength={3} maxLength={80} /></label>
          <label>Invitation role<select name="role"><option value="VIEWER">Viewer: approved details only</option><option value="EDITOR">Editor: full tree and editing</option></select></label>
          <label>Invitation days<input name="days" type="number" required min={1} max={30} defaultValue={7} /></label>
          <button type="submit">Create invitation link</button>
        </fieldset></form>
        <h3>Read-only links</h3>
        <form onSubmit={e => create(e, 'shares')}><fieldset className="person-fields" disabled={busy}>
          <label>Shared archive label<input name="label" required maxLength={200} /></label>
          <label>Share days<input name="days" type="number" required min={1} max={30} defaultValue={7} /></label>
          <button type="submit">Create read-only link</button>
        </fieldset></form>
        {['invitations', 'shares'].map(kind => <section key={kind}><h3>{kind === 'shares' ? 'Created links' : 'Invitations'}</h3>{data?.[kind].map(item => <div className="recovery-entry" key={item.id}><p>{item.label || `${item.invitee_username} · ${item.role}`} · {item.revoked_at ? 'Revoked' : item.accepted_at ? 'Accepted' : new Date(item.expires_at) <= new Date() ? 'Expired' : `Expires ${new Date(item.expires_at).toLocaleString()}`}</p>{!item.revoked_at && !item.accepted_at && new Date(item.expires_at) > new Date() && <button disabled={busy} onClick={() => setReview({ kind, id: item.id, message: `Revoke ${item.label || item.invitee_username}? This link will stop working on subsequent requests.` })}>Revoke {item.label || item.invitee_username}</button>}</div>)}</section>)}
        <details><summary>Recent access activity</summary>{data?.events.map(item => <p key={item.id}>{item.actor || 'Former account'} · {item.action} · {new Date(item.created_at).toLocaleString()}</p>)}</details>
      </>}
    </Modal>}
  </section>;
}

function Member({ member, busy, onReview }) {
  const [role, setRole] = React.useState(member.role);
  React.useEffect(() => setRole(member.role), [member.role]);
  return <div className="recovery-entry"><strong>{member.username}</strong><div className="toolbar"><label>Role for {member.username}<select value={role} disabled={busy} onChange={e => setRole(e.target.value)}><option value="OWNER">Owner</option><option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option></select></label><button disabled={busy || role === member.role} onClick={() => onReview(role)}>Review role for {member.username}</button><button disabled={busy} onClick={() => onReview(null)}>Remove {member.username}</button></div></div>;
}
