import React from 'react';
import archiveTools from '../src/domain/archive';
import { recoveryArchive } from './storage';
import Modal from './Modal';
const { createBackup, parseBackup, validateArchive, MAX_BACKUP_BYTES } = archiveTools;

export function downloadJson(value, filename = 'rootline-backup.json') {
  const blob = new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function StartNewTreeModal({ onStartNew, onClose }) {
  const [error, setError] = React.useState('');
  const [nameError, setNameError] = React.useState('');
  const nameRef = React.useRef(null);
  const nameErrorId = React.useId();

  function createNewTree(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const name = String(fields.name || '').trim();
    if (!name) {
      setNameError('Please enter a name for the starting person.');
      nameRef.current?.focus();
      return;
    }
    const customTreeName = String(fields.treeName || '').trim();
    const treeName = customTreeName || `${name}’s Family Tree`;
    const id = `p_${crypto.randomUUID().slice(0, 8)}`;
    const person = {
      id,
      name,
      ...(fields.gender && { gender: fields.gender }),
      ...(String(fields.birth || '').trim() && { birth: String(fields.birth).trim() }),
      ...(String(fields.birthplace || '').trim() && { birthplace: String(fields.birthplace).trim() }),
    };
    try {
      onStartNew({ rootId: id, family: { [id]: person }, treeName }, name);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Start a new family tree" onClose={onClose}>
      <p>Start fresh with your own starting person. Your current archive will be saved automatically in Recovery copies first.</p>
      <form onSubmit={createNewTree} noValidate>
        <fieldset className="person-fields">
          <label>
            Starting person’s full name *
            <input
              ref={nameRef}
              name="name"
              required
              aria-required="true"
              aria-invalid={nameError ? 'true' : undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              maxLength={500}
              placeholder="e.g. Jordan Rivera"
              onChange={() => { setNameError(''); setError(''); }}
            />
          </label>
          {nameError && <p id={nameErrorId} role="alert" className="field-error">{nameError}</p>}
          <label>
            Tree name
            <input name="treeName" maxLength={200} placeholder="Optional, e.g. Rivera Family Tree" />
          </label>
          <label>Gender<select name="gender" defaultValue="U">
            <option value="U">Unknown / Unspecified</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
            <option value="X">Non-binary</option>
          </select></label>
          <label>Birth date<input name="birth" maxLength={200} placeholder="e.g. 1988 or ABT 1988" /></label>
          <label>Birthplace<input name="birthplace" maxLength={200} placeholder="City, Country" /></label>
          {error && <p role="alert">{error}</p>}
          <div className="toolbar">
            <button type="submit" className="btn btn-gradient">Create new tree</button>
            <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

export default function ArchiveControls({ archive, source, treeName, saveStatus, notice, recoveries, onRestore, onDiscard, onStartNew, onClearRecoveries }) {
  const [preview, setPreview] = React.useState(null);
  const [showDiscard, setShowDiscard] = React.useState(false);
  const [showRecovery, setShowRecovery] = React.useState(false);
  const [showNewTree, setShowNewTree] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const displayTreeName = treeName || source.treeName;
  const tree = { id: source.treeId, name: displayTreeName };
  async function readFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setMessage('');
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds 20 MB');
      setPreview(parseBackup(await file.text()));
    } catch (error) { setError(error.message); }
  }
  function restore() {
    try {
      onRestore(preview.archive);
      setPreview(null); setShowRecovery(false); setError('');
      setMessage('Backup restored. The previous archive is available in Recovery copies.');
    } catch (error) { setError(error.message); }
  }
  function discard() {
    try {
      onDiscard(); setShowDiscard(false); setError('');
      setMessage(source.mode === 'database' ? 'Local edits discarded. A recovery copy was saved.' : 'Reset to the sample archive. A recovery copy was saved.');
    } catch (error) { setError(error.message); }
  }
  function clearOldCopies() {
    try {
      onClearRecoveries();
      setError('');
      setMessage('Recovery copies cleared.');
    } catch (err) {
      setError(err.message);
    }
  }
  return <section className="archive-controls" aria-label="Archive tools">
    <div className="toolbar">
      <div><strong>{displayTreeName}</strong><p>{source.mode === 'database' ? 'Database archive' : 'Browser archive'} · <span role="status">{saveStatus}</span></p></div>
      <div className="toolbar">
        {source.mode !== 'database' && onStartNew && <button onClick={() => { setError(''); setShowNewTree(true); }}>Start new tree</button>}
        <button onClick={() => {
          try { downloadJson(createBackup(archive, tree)); setError(''); }
          catch (error) { setError(error.message); }
        }}>Download backup</button>
        <label className="file-button">Restore backup<input aria-label="Restore backup" type="file" accept=".json,application/json" onChange={readFile} /></label>
        <button onClick={() => { setError(''); setShowRecovery(true); }}>Recovery copies ({recoveries.length})</button>
        <button onClick={() => { setError(''); setShowDiscard(true); }}>Discard local edits</button>
      </div>
    </div>
    {notice && <p className="notice">{notice}</p>}
    {message && <p role="status">{message}</p>}
    {error && !preview && !showDiscard && !showRecovery && !showNewTree && <p role="alert">{error}</p>}
    {showNewTree && (
      <StartNewTreeModal
        onStartNew={(next, name) => {
          onStartNew(next);
          setError('');
          setMessage(`Started a new family tree centered on ${name}. Your previous tree is saved in Recovery copies.`);
        }}
        onClose={() => { setShowNewTree(false); setError(''); }}
      />
    )}
    {showRecovery && !preview && <Modal title="Recovery copies" onClose={() => setShowRecovery(false)}>
      <p>Copies are kept in this browser. Download a copy to keep it outside browser storage.</p>
      {recoveries.length === 0 && <p>No recovery copies yet.</p>}
      {recoveries.slice().reverse().map((entry) => <div className="recovery-entry" key={entry.id}>
        <p><strong>{entry.reason}</strong> · {new Date(entry.createdAt).toLocaleString()}</p>
        <div className="toolbar">
          <button type="button" className="btn btn-outline" onClick={() => {
            try { downloadJson(createBackup(recoveryArchive(entry, archive.rootId), tree), 'rootline-recovery.json'); }
            catch { downloadJson(entry.raw, 'rootline-recovery-original.json'); }
          }}>Download copy</button>
          <button type="button" className="btn btn-default" onClick={() => {
            try {
              const recovered = recoveryArchive(entry, archive.rootId);
              setError(''); setPreview({ archive: recovered, tree, summary: validateArchive(recovered) });
            } catch (error) { setError(`${error.message}. Download the original copy to inspect it.`); }
          }}>Preview copy</button>
        </div>
      </div>)}
      {recoveries.length > 0 && onClearRecoveries && (
        <div className="toolbar recovery-footer">
          <button type="button" className="btn btn-danger" onClick={clearOldCopies}>Clear old copies</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>}
    {preview && <Modal title="Restore preview" onClose={() => { setPreview(null); setError(''); }}>
      <p><strong>{preview.tree?.name || 'Family archive'}</strong></p>
      <p>{preview.summary.people} {preview.summary.people === 1 ? 'person' : 'people'} · {preview.summary.relationships} recorded relationship {preview.summary.relationships === 1 ? 'reference' : 'references'}</p>
      <p>Root person: {preview.summary.rootName}</p>
      <p>This replaces the active browser archive. A recovery copy of your current archive will be saved first.</p>
      {source.mode === 'database' && <p>This restore changes the browser copy only.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="toolbar">
        <button type="button" className="btn btn-gradient" onClick={restore}>Confirm restore</button>
        <button type="button" className="btn btn-outline" onClick={() => { setPreview(null); setError(''); }}>Cancel</button>
      </div>
    </Modal>}
    {showDiscard && <Modal title="Discard local edits" onClose={() => setShowDiscard(false)}>
      <p>{source.mode === 'database'
        ? 'Return to the loaded database archive and remove local edits from the active view? A recovery copy will be saved first.'
        : 'Reset to the sample family archive and remove your local edits from the active view? A recovery copy will be saved first.'}</p>
      {error && <p role="alert">{error}</p>}
      <div className="toolbar">
        <button type="button" className="btn btn-danger" onClick={discard}>Confirm discard</button>
        <button type="button" className="btn btn-outline" onClick={() => setShowDiscard(false)}>Cancel</button>
      </div>
    </Modal>}
  </section>;
}
