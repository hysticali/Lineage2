import React from 'react';
import Modal from './Modal';
import { downloadJson } from './ArchiveControls';

async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Database recovery request failed');
  return data;
}

export default function DatabaseRecovery({ treeId, onSaved, onRestored, blocked = false }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [changes, setChanges] = React.useState(null);
  const [preview, setPreview] = React.useState(null);
  const requestId = React.useRef(crypto.randomUUID());
  async function download() {
    setBusy(true); setError('');
    try { downloadJson(await api(`/api/trees/${treeId}/backup`), 'rootline-full-tree.json'); setMessage('Full database tree backup downloaded, including stored attachments.'); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function readFile(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Full-tree backup exceeds the 50 MB web restore limit. Use PostgreSQL backup tools for larger archives.');
      const backup = JSON.parse(await file.text());
      const data = await api('/api/backups/preview', { backup });
      requestId.current = crypto.randomUUID(); setPreview({ ...data, backup });
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function history() {
    setBusy(true); setError('');
    try { setChanges((await api(`/api/trees/${treeId}/history`)).changes); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function previewHistory(change) {
    setBusy(true); setError('');
    try {
      const data = await api(`/api/trees/${treeId}/history/${change.id}/preview`);
      requestId.current = crypto.randomUUID(); setPreview({ ...data, exists: true, change });
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function restore() {
    setBusy(true); setError('');
    try {
      const body = { requestId: requestId.current, expectedRevision: preview.revision, ...(preview.backup && { backup: preview.backup }) };
      const path = preview.change ? `/api/trees/${treeId}/history/${preview.change.id}/restore` : preview.exists ? `/api/trees/${treeId}/restore` : '/api/backups/restore';
      const data = await api(path, body);
      setPreview(null); setChanges(null);
      if (data.archive) onSaved(data.archive);
      else onRestored(data.treeId);
      setMessage('Database tree restored. The replaced state is retained in edit history.');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  const wrongTree = preview?.exists && preview.summary.treeId !== treeId;
  return <section className="database-recovery archive-controls" aria-label="Database recovery">
    <div className="toolbar"><strong>Database recovery</strong><div className="toolbar">
      {treeId && <button disabled={busy} onClick={download}>Download full tree backup</button>}
      <label className="file-button">Restore full tree backup<input disabled={busy} type="file" accept=".json,application/json" aria-label="Restore full tree backup" onChange={readFile} /></label>
      {treeId && <button disabled={busy} onClick={history}>Edit history</button>}
    </div></div>
    {blocked && <p>Migrate or discard the browser draft before replacing database records. Download its browser backup to keep a copy.</p>}
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">Working with database recovery…</p>}
    {error && !preview && !changes && <p role="alert">{error}</p>}
    {changes && !preview && <Modal title="Database edit history" onClose={() => { if (!busy) setChanges(null); }}>
      <p>Latest 100 changes. Restoring an entry returns the entire tree to the state before that change. Your current state is saved as a new recovery entry first.</p>
      {!changes.length && <p>No recorded edits yet.</p>}
      {changes.map(change => <div className="recovery-entry" key={change.id}><p>Revision {change.revision} · {change.action} · {change.actor_label || 'Local user'} · {new Date(change.created_at).toLocaleString()}</p><button disabled={busy || !change.recoverable || blocked} onClick={() => previewHistory(change)}>Preview recovery before revision {change.revision}</button>{!change.recoverable && <p>This older entry has no complete relational recovery snapshot.</p>}</div>)}
      {error && <p role="alert">{error}</p>}
    </Modal>}
    {preview && <Modal title="Database restore preview" onClose={() => { if (!busy) { setPreview(null); setError(''); } }}>
      <p><strong>{preview.summary.name}</strong></p>
      <p>{preview.summary.people} people · {preview.summary.families} families · {preview.summary.sources} sources · {preview.summary.citations} citations · {preview.summary.attachments} stored attachments ({preview.summary.attachmentBytes} bytes)</p>
      {preview.exists ? <p>Replace the database tree with this state? A complete recovery snapshot of the current records and stored files is retained in edit history. All changes after the chosen state will be removed from the active tree.</p> : <p>Restore this missing tree, keeping its original record identities and stored files. Existing trees are preserved.</p>}
      {wrongTree && <p role="alert">This backup belongs to another existing tree. Select that tree before replacing it.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="toolbar"><button disabled={busy || wrongTree || (preview.exists && blocked)} onClick={restore}>Confirm database restore</button><button disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Cancel database restore</button></div>
    </Modal>}
  </section>;
}
