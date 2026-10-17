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

export default function ArchiveControls({ archive, source, saveStatus, notice, recoveries, onRestore, onDiscard }) {
  const [preview, setPreview] = React.useState(null);
  const [showDiscard, setShowDiscard] = React.useState(false);
  const [showRecovery, setShowRecovery] = React.useState(false);
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');
  const tree = { id: source.treeId, name: source.treeName };
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
      setMessage('Local edits discarded. A recovery copy was saved.');
    } catch (error) { setError(error.message); }
  }
  return <section className="archive-controls" aria-label="Archive tools">
    <div className="toolbar">
      <div><strong>{source.treeName}</strong><p>{source.mode === 'database' ? 'Database archive' : 'Sample archive'} · <span role="status">{saveStatus}</span></p></div>
      <div className="toolbar">
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
    {error && !preview && !showDiscard && !showRecovery && <p role="alert">{error}</p>}
    {showRecovery && !preview && <Modal title="Recovery copies" onClose={() => setShowRecovery(false)}>
      <p>Copies are kept in this browser. Download a copy to keep it outside browser storage.</p>
      {recoveries.length === 0 && <p>No recovery copies yet.</p>}
      {recoveries.slice().reverse().map((entry) => <div className="recovery-entry" key={entry.id}>
        <p><strong>{entry.reason}</strong> · {new Date(entry.createdAt).toLocaleString()}</p>
        <div className="toolbar">
          <button onClick={() => {
            try { downloadJson(createBackup(recoveryArchive(entry, archive.rootId), tree), 'rootline-recovery.json'); }
            catch { downloadJson(entry.raw, 'rootline-recovery-original.json'); }
          }}>Download copy</button>
          <button onClick={() => {
            try {
              const recovered = recoveryArchive(entry, archive.rootId);
              setError(''); setPreview({ archive: recovered, tree, summary: validateArchive(recovered) });
            } catch (error) { setError(`${error.message}. Download the original copy to inspect it.`); }
          }}>Preview copy</button>
        </div>
      </div>)}
      {error && <p role="alert">{error}</p>}
    </Modal>}
    {preview && <Modal title="Restore preview" onClose={() => { setPreview(null); setError(''); }}>
      <p><strong>{preview.tree?.name || 'Family archive'}</strong></p>
      <p>{preview.summary.people} people · {preview.summary.relationships} recorded relationship references</p>
      <p>Root person: {preview.summary.rootName}</p>
      <p>This replaces the active browser archive. A recovery copy of your current archive will be saved first.</p>
      {source.mode === 'database' && <p>This restore changes the browser copy only.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="toolbar"><button onClick={restore}>Confirm restore</button><button onClick={() => { setPreview(null); setError(''); }}>Cancel</button></div>
    </Modal>}
    {showDiscard && <Modal title="Discard local edits" onClose={() => setShowDiscard(false)}>
      <p>Return to the loaded source archive and remove local additions from the active view? A recovery copy will be saved first.</p>
      {error && <p role="alert">{error}</p>}
      <div className="toolbar"><button onClick={discard}>Confirm discard</button><button onClick={() => setShowDiscard(false)}>Cancel</button></div>
    </Modal>}
  </section>;
}
