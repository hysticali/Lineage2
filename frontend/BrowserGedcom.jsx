import React from 'react';
import Modal from './Modal';
import browserGedcom from '../src/domain/browser-gedcom';

const { previewBrowserGedcom, importBrowserGedcom, exportBrowserGedcom } = browserGedcom;
const MAX_BYTES = 20 * 1024 * 1024;

function downloadGedcom(source, filename = 'rootline-family.ged') {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/vnd.familysearch.gedcom;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function treeNameFromFile(filename) {
  const base = String(filename || '')
    .replace(/\.ged$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!base) return 'Imported family tree';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function plural(count, singular, pluralWord) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

export default function BrowserGedcom({ archive, onImportArchive }) {
  const [importing, setImporting] = React.useState(null);
  const [exporting, setExporting] = React.useState(null);
  const [root, setRoot] = React.useState('');
  const [rootQuery, setRootQuery] = React.useState('');
  const [error, setError] = React.useState('');
  const [message, setMessage] = React.useState('');

  async function chooseFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setMessage('');
    try {
      if (file.size > MAX_BYTES) throw new Error('GEDCOM file exceeds 20 MB.');
      let source;
      try {
        source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      } catch {
        throw new Error('GEDCOM must be valid UTF-8 text.');
      }
      const report = previewBrowserGedcom(source);
      setImporting({ source, filename: file.name, report });
      setRoot(report.preferredRoot || report.roots[0]?.reference || '');
      setRootQuery('');
    } catch (err) {
      setError(err.message);
    }
  }

  function confirmImport() {
    setError('');
    try {
      const { archive: imported, report } = importBrowserGedcom(importing.source, root);
      const treeName = treeNameFromFile(importing.filename);
      onImportArchive({ ...imported, treeName }, `Before importing GEDCOM (${importing.filename})`);
      setImporting(null);
      setMessage(`Imported ${plural(report.people, 'person', 'people')} and ${plural(report.families, 'family', 'families')} from ${importing.filename}.`);
    } catch (err) {
      setError(err.message);
    }
  }

  function previewExport() {
    setError('');
    setMessage('');
    try {
      setExporting(exportBrowserGedcom(archive));
    } catch (err) {
      setError(err.message);
    }
  }

  const rootOptions = React.useMemo(() => {
    if (!importing) return [];
    const normalized = rootQuery.trim().toLowerCase();
    const list = importing.report.roots.filter((r) => !normalized || r.name.toLowerCase().includes(normalized));
    const bounded = list.slice(0, 100);
    if (root && !bounded.some((r) => r.reference === root)) {
      const chosen = importing.report.roots.find((r) => r.reference === root);
      if (chosen) bounded.unshift(chosen);
    }
    return bounded;
  }, [importing, rootQuery, root]);

  return (
    <section className="archive-controls" aria-label="GEDCOM exchange">
      <div className="toolbar">
        <div>
          <strong>GEDCOM 7.0</strong>
          <p>Import or export your browser family tree as a standard GEDCOM 7.0 (.ged) file.</p>
        </div>
        <div className="toolbar">
          <label className="file-button">
            Import GEDCOM
            <input aria-label="Import GEDCOM" type="file" accept=".ged,text/plain" onChange={chooseFile} />
          </label>
          <button type="button" onClick={previewExport}>Export GEDCOM</button>
        </div>
      </div>
      {message && <p role="status">{message}</p>}
      {error && !importing && !exporting && <p role="alert">{error}</p>}

      {importing && (
        <Modal title="GEDCOM import preview" onClose={() => { setImporting(null); setError(''); }}>
          <p><strong>{importing.filename}</strong> · GEDCOM {importing.report.version}</p>
          <p>{plural(importing.report.people, 'person', 'people')} · {plural(importing.report.families, 'family', 'families')}</p>
          <p>Importing replaces the active browser archive. A recovery copy of your current tree will be saved first.</p>
          {importing.report.errors.length > 0 && (
            <div role="alert">
              <p>Cannot import until these issues are fixed:</p>
              <ul>{importing.report.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {importing.report.warnings.length > 0 && (
            <div className="notice">
              <p>Notes:</p>
              <ul>{importing.report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {importing.report.errors.length === 0 && (
            <fieldset className="person-fields">
              {importing.report.roots.length > 25 && (
                <label>
                  Filter root person
                  <input type="search" value={rootQuery} placeholder="Filter by name…" onChange={(e) => setRootQuery(e.target.value)} />
                </label>
              )}
              <label>
                Center / root person
                <select value={root} onChange={(e) => setRoot(e.target.value)}>
                  {rootOptions.map((item) => (
                    <option key={item.reference} value={item.reference}>{item.name}</option>
                  ))}
                </select>
              </label>
            </fieldset>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="toolbar">
            <button type="button" className="btn btn-gradient" disabled={importing.report.errors.length > 0} onClick={confirmImport}>
              Import into browser
            </button>
            <button type="button" className="btn btn-outline" onClick={() => { setImporting(null); setError(''); }}>Cancel</button>
          </div>
        </Modal>
      )}

      {exporting && (
        <Modal title="GEDCOM export preview" onClose={() => { setExporting(null); setError(''); }}>
          <p>GEDCOM 7.0 UTF-8 · {plural(exporting.people, 'person', 'people')} · {plural(exporting.families, 'family', 'families')}</p>
          <p>Includes names, genders, dates, birthplaces, occupations, notes, and family relationships from your current browser tree.</p>
          {error && <p role="alert">{error}</p>}
          <div className="toolbar">
            <button type="button" className="btn btn-gradient" onClick={() => { downloadGedcom(exporting.source); setExporting(null); setMessage('GEDCOM 7.0 file downloaded.'); }}>
              Download GEDCOM (.ged)
            </button>
            <button type="button" className="btn btn-outline" onClick={() => { setExporting(null); setError(''); }}>Close</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
