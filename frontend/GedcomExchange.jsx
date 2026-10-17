import React from 'react';
import Modal from './Modal';
import { downloadJson } from './ArchiveControls';

async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'GEDCOM request failed');
  return data;
}
function downloadGedcom(source) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/vnd.familysearch.gedcom;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'rootline-family.ged'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function GedcomExchange({ treeId, onImported, onSaved, draft = false, privateMode = false, readOnly = false, shareToken }) {
  const [includePrivate, setIncludePrivate] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [importing, setImporting] = React.useState(null);
  const [exporting, setExporting] = React.useState(null);
  const [imports, setImports] = React.useState(null);
  const [name, setName] = React.useState('');
  const [root, setRoot] = React.useState('');
  const [rootQuery, setRootQuery] = React.useState('');
  const [destination, setDestination] = React.useState('new');
  const [reviewMatches, setReviewMatches] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const requestId = React.useRef(crypto.randomUUID());
  function dirty() { requestId.current = crypto.randomUUID(); setError(''); }
  async function readFile(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (!/\.ged$/i.test(file.name)) throw new Error('Choose a GEDCOM 7.0 .ged file. GEDZIP and GEDCOM 5.5.1 are outside this release.');
      if (destination === 'current' && draft) throw new Error('Migrate or discard the browser draft before importing into the database tree.');
      if (file.size > 20 * 1024 * 1024) throw new Error('GEDCOM files must be at most 20 MB.');
      const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      const report = await api(destination === 'current' ? `/api/trees/${treeId}/gedcom/preview` : '/api/gedcom/preview', { source });
      setName(file.name.replace(/\.ged$/i, '') || 'Imported GEDCOM'); setRoot(report.preferredRoot || report.roots[0]?.reference || ''); setRootQuery(''); setReviewMatches(false);
      requestId.current = crypto.randomUUID(); setImporting({ source, filename: file.name, report, destination });
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function confirmImport(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const current = importing.destination === 'current';
      const data = await api(current ? `/api/trees/${treeId}/gedcom/import` : '/api/gedcom/import', { requestId: requestId.current, source: importing.source, filename: importing.filename, checksum: importing.report.checksum, name, rootReference: root, ...(current && { expectedRevision: importing.report.revision, reviewMatches }) });
      setImporting(null);
      if (current) { onSaved(data.archive); setMessage('Records imported into this tree. Possible duplicates remain separate; use Review duplicates to compare and merge them. Edit history can recover the state before the import.'); }
      else onImported(data.treeId);
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function exportTree() {
    setBusy(true); setError('');
    try { setExporting(await api(shareToken ? `/api/share/${encodeURIComponent(shareToken)}/gedcom` : `/api/trees/${treeId}/gedcom${privateMode && includePrivate ? '?includePrivate=true' : ''}`)); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  async function showImports() {
    setBusy(true); setError('');
    try { setImports((await api(`/api/trees/${treeId}/imports`)).imports); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  const selectedRoot = importing?.report.roots.find(p => p.reference === root);
  const rootOptions = importing ? [selectedRoot, ...importing.report.roots.filter(p => p.reference !== root && p.name.toLowerCase().includes(rootQuery.toLowerCase())).slice(0, 199)].filter(Boolean) : [];
  return <section className="archive-controls" aria-label="GEDCOM exchange">
    <div className="toolbar"><strong>GEDCOM exchange</strong><div className="toolbar">
      {!readOnly && treeId && <label>Import destination<select value={destination} disabled={busy} onChange={e => setDestination(e.target.value)}><option value="new">New separate tree</option><option value="current" disabled={draft}>Current database tree</option></select></label>}
      {!readOnly && <label className="file-button">Import GEDCOM<input disabled={busy} aria-label="Import GEDCOM" type="file" accept=".ged" onChange={readFile} /></label>}
      {treeId && <><button disabled={busy} onClick={exportTree}>Export GEDCOM</button>{!readOnly && <button disabled={busy} onClick={showImports}>Import provenance</button>}</>}
    </div></div>
    {privateMode && !readOnly && <label className="checkbox"><input type="checkbox" checked={includePrivate} onChange={e => setIncludePrivate(e.target.checked)} />Include private records and evidence in GEDCOM export</label>}
    {privateMode && includePrivate && <p className="notice">This download contains private family data. Only share it with trusted recipients.</p>}
    {draft && <p>GEDCOM export uses saved database records. Migrate the browser draft first to include its changes.</p>}
    {message && <p role="status">{message}</p>}
    {busy && <p role="status">Working with GEDCOM…</p>}
    {error && !importing && !exporting && !imports && <p role="alert">{error}</p>}
    {importing && <Modal title="GEDCOM import preview" onClose={() => { if (!busy) { setImporting(null); setError(''); } }}>
      <p>GEDCOM {importing.report.version} · {importing.report.people} people · {importing.report.families} families · {importing.report.sources} sources · {importing.report.media} media records</p>
      <p>{importing.destination === 'current' ? `This adds records to ${importing.report.destinationName} and keeps its current root. Matching people remain separate until reviewed and explicitly merged. A complete recovery snapshot is retained before import.` : 'This creates a separate database tree.'} Original source text and unsupported structures are retained. Media paths remain references; files are not fetched automatically.</p>
      {importing.destination === 'current' && <section aria-label="Possible import matches"><h3>Possible matching people</h3>{!importing.report.existingMatches.length && <p>No matching full names were found. Other duplicates may still exist.</p>}<ul>{importing.report.existingMatches.map((m, i) => <li key={i}>{m.incomingName} → {m.existingName} · {m.existingBirth || 'Date unknown'}</li>)}</ul>{importing.report.matchesTruncated && <p>Showing the first 200 possible matches.</p>}</section>}
      {importing.report.warnings.map(w => <p key={w} className="notice">{w}</p>)}
      {importing.report.unsupported.length > 0 && <details><summary>{importing.report.unsupported.length} retained unsupported structures</summary><ul>{importing.report.unsupported.slice(0, 50).map((n, i) => <li key={i}>Line {n.line}: {n.parent}.{n.tag}</li>)}</ul><button onClick={() => downloadJson(importing.report, 'gedcom-import-report.json')}>Download complete import report</button></details>}
      {importing.report.errors.map(e => <p key={e} role="alert">{e}</p>)}
      {error && <p role="alert">{error}</p>}
      <form onSubmit={confirmImport}><fieldset disabled={busy || importing.report.errors.length > 0} className="person-fields">
        {importing.destination === 'new' ? <>
          <label>New tree name<input required maxLength={500} value={name} onChange={e => { setName(e.target.value); dirty(); }} /></label>
          <label>Find root person<input type="search" value={rootQuery} onChange={e => setRootQuery(e.target.value)} /></label>
          <label>Root person<select required value={root} onChange={e => { setRoot(e.target.value); dirty(); }}>{rootOptions.map(p => <option key={p.reference} value={p.reference}>{p.name}</option>)}</select></label>
        </> : <label className="checkbox"><input type="checkbox" required checked={reviewMatches} onChange={e => { setReviewMatches(e.target.checked); dirty(); }} />I reviewed possible matches and understand that people remain separate until explicitly merged.</label>}
        {importing.report.roots.length > 200 && <p>Showing up to 200 root choices. Search by name to find another person.</p>}
        <button type="submit" disabled={importing.destination === 'current' && (!reviewMatches || draft)}>Confirm GEDCOM import</button>
      </fieldset></form>
    </Modal>}
    {exporting && <Modal title="GEDCOM export preview" onClose={() => setExporting(null)}>
      <p>{exporting.people} people · {exporting.families} families · {exporting.sources} sources</p>
      <p>{exporting.redacted ? 'This download contains only approved basic details and relationships between approved people.' : 'Export the supported GEDCOM 7.0 records and preserved original structures. A full-tree JSON backup retains native recovery data and stored attachment bytes.'}</p>
      {exporting.warnings.map(w => <p key={w} className="notice">{w}</p>)}
      <button onClick={() => downloadGedcom(exporting.source)}>Download GEDCOM file</button>
    </Modal>}
    {imports && <Modal title="Import provenance" onClose={() => setImports(null)}>
      {!imports.length && <p>No imports recorded.</p>}
      {imports.map(item => <div className="recovery-entry" key={item.id}><p><strong>{item.source_filename}</strong> · {item.source_format} {item.gedcom_version} · {item.status}</p><p className="record-text">SHA-256: {item.checksum_sha256}</p>{item.warnings.map(w => <p className="notice" key={w}>{w}</p>)}{item.source_available && <a href={`/api/trees/${treeId}/imports/${item.id}/source`} download>Download original source</a>}</div>)}
      {error && <p role="alert">{error}</p>}
    </Modal>}
  </section>;
}
