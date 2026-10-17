import React from 'react';
import Modal from './Modal';

export default function LocalMigration({ treeId, archive, onBeforeApply, onApplied }) {
  const [preview, setPreview] = React.useState(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const requestId = React.useRef(null);
  async function request(path, body) {
    const response = await fetch(`/api/trees/${encodeURIComponent(treeId)}/local-migration${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Migration failed');
    return data;
  }
  async function inspect() {
    setBusy(true); setError('');
    try {
      const data = await request('/preview', { archive });
      requestId.current = crypto.randomUUID();
      setPreview({ ...data, archive });
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setError('');
    try {
      onBeforeApply();
      const data = await request('', { requestId: requestId.current, expectedRevision: preview.revision, archive: preview.archive });
      onApplied(data.archive); setPreview(null);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  const plan = preview?.plan;
  return <div className="migration-controls">
    <button disabled={busy} onClick={inspect}>Migrate local edits to database</button>
    {error && !preview && <p role="alert">{error}</p>}
    {preview && <Modal title="Migration preview" onClose={() => { if (!busy) setPreview(null); }}>
      <p>{plan.additions.length} new people · {plan.updates.length} updated people · {plan.relationships} relationship additions</p>
      <p>Existing records are preserved. No people or relationships will be deleted. A browser recovery copy is saved before applying.</p>
      {plan.additions.map((person) => <p key={person.id}>Add {person.name}</p>)}
      {plan.updates.map((person) => <div key={person.id}><strong>Update {person.name}</strong><ul>{person.changes.map((change) => <li key={change.field}>{change.field}: {change.before || '(empty)'} → {change.after || '(empty)'}</li>)}</ul></div>)}
      {plan.parents.map((link) => <p key={`${link.childId}-${link.slot}`}>Add {preview.archive.family[link.parentId].name} as {link.slot} of {preview.archive.family[link.childId].name}</p>)}
      {plan.spouses.map(([a, b]) => <p key={`spouse-${a}-${b}`}>Partners: {preview.archive.family[a].name} and {preview.archive.family[b].name}</p>)}
      {plan.siblings.map(([a, b]) => <p key={`sibling-${a}-${b}`}>Siblings: {preview.archive.family[a].name} and {preview.archive.family[b].name}</p>)}
      {plan.conflicts.map((conflict) => <p role="alert" key={conflict}>{conflict}</p>)}
      {error && <p role="alert">{error}</p>}
      <div className="toolbar"><button disabled={busy || plan.conflicts.length > 0} onClick={apply}>{busy ? 'Migrating…' : 'Confirm migration'}</button><button disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div>
    </Modal>}
  </div>;
}
