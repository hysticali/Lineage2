import React from 'react';
import Modal from './Modal';

async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Duplicate review failed');
  return data;
}

export default function DuplicateReview({ treeId, archive, selectedId, blocked, onSaved }) {
  const [open, setOpen] = React.useState(false), [busy, setBusy] = React.useState(false);
  const [candidates, setCandidates] = React.useState(null), [plan, setPlan] = React.useState(null);
  const [survivorId, setSurvivorId] = React.useState(''), [duplicateId, setDuplicateId] = React.useState('');
  const [query, setQuery] = React.useState(''), [choices, setChoices] = React.useState({});
  const [error, setError] = React.useState(''), [message, setMessage] = React.useState('');
  const requestId = React.useRef(crypto.randomUUID());
  const people = Object.values(archive.family).sort((a, b) => a.name.localeCompare(b.name));
  const options = [...new Set([survivorId, duplicateId, ...people.filter(p => `${p.name} ${p.birth || ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 198).map(p => p.id)])].map(id => archive.family[id]).filter(Boolean);
  async function start() {
    setOpen(true); setBusy(true); setError(''); setMessage(''); setPlan(null); setQuery('');
    setSurvivorId(selectedId || people[0]?.id || ''); setDuplicateId('');
    try { setCandidates(await api(`/api/trees/${treeId}/duplicates`)); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  function changePerson(which, id) {
    (which === 'survivor' ? setSurvivorId : setDuplicateId)(id); setPlan(null); setError('');
    requestId.current = crypto.randomUUID();
  }
  async function preview() {
    setBusy(true); setError('');
    try {
      const next = await api(`/api/trees/${treeId}/merge/preview`, { survivorId, duplicateId });
      setPlan(next); setChoices(next.choices); requestId.current = crypto.randomUUID();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  function changeChoice(key, value) { setChoices(current => ({ ...current, [key]: value })); requestId.current = crypto.randomUUID(); setError(''); }
  async function merge() {
    setBusy(true); setError('');
    try {
      const data = await api(`/api/trees/${treeId}/merge`, { survivorId, duplicateId, choices, expectedRevision: plan.revision, requestId: requestId.current });
      onSaved(data.archive); setOpen(false); setMessage('People merged. All assertions were retained. Use Edit history to recover the state before the merge.');
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  function familyLabel(item) {
    const family = archive.families?.find(f => f.id === item.id);
    const parents = family?.partners.map(p => archive.family[p.personId]?.name).filter(Boolean).join(' + ') || 'Unknown parents';
    return `${parents} · ${item.pedigree} (${item.id.slice(0, 8)})`;
  }
  return <section className="archive-controls" aria-label="Duplicate review">
    <div className="toolbar"><strong>Review duplicate people</strong><button disabled={blocked || busy} onClick={start}>Review duplicates</button></div>
    {blocked && <p>Migrate or discard the browser draft before merging database people.</p>}
    {message && <p role="status">{message}</p>}
    {open && <Modal title="Duplicate people review" onClose={() => { if (!busy) setOpen(false); }}>
      <p>Suggestions identify matching names, not confirmed identities. Compare dates, relatives, and evidence. You can also choose any two people manually.</p>
      {candidates?.candidates.length === 0 && <p>No matching-name suggestions. Manual review is available below.</p>}
      {candidates?.truncated && <p>Showing the first 200 suggestions. Search below to review another pair.</p>}
      <ul className="duplicate-candidates">{candidates?.candidates.map(c => <li key={`${c.survivorId}:${c.duplicateId}`}><button disabled={busy} onClick={() => { setSurvivorId(c.survivorId); setDuplicateId(c.duplicateId); setPlan(null); setError(''); }}>{c.name} · {c.firstBirth || 'Date unknown'} / {c.secondBirth || 'Date unknown'}</button></li>)}</ul>
      <fieldset disabled={busy} className="person-fields">
        <label>Find people to compare<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <label>Surviving individual<select value={survivorId} onChange={e => changePerson('survivor', e.target.value)}><option value="">Choose a person</option>{options.map(p => <option key={p.id} value={p.id}>{p.name} · {p.birth || 'Date unknown'} ({p.id.slice(0, 8)})</option>)}</select></label>
        <label>Duplicate individual<select value={duplicateId} onChange={e => changePerson('duplicate', e.target.value)}><option value="">Choose another person</option>{options.map(p => <option key={p.id} value={p.id}>{p.name} · {p.birth || 'Date unknown'} ({p.id.slice(0, 8)})</option>)}</select></label>
        <button disabled={!survivorId || !duplicateId || survivorId === duplicateId} onClick={preview}>Preview person merge</button>
      </fieldset>
      {plan && <section aria-label="Merge preview">
        <p><strong>{plan.duplicate.name}</strong> will become part of <strong>{plan.survivor.name}</strong>. The surviving identity is retained, and the old identifier remains an alias.</p>
        <p>Transfer {plan.transferred.names} names, {plan.transferred.events} events, {plan.transferred.notes} notes, {plan.transferred.partnerLinks} partner links, {plan.transferred.parentFamilies} parent-family links, {plan.transferred.citations} direct citations, and {plan.transferred.mediaLinks} direct media links.</p>
        {plan.warnings.map(w => <p key={w} className="notice">{w}</p>)}
        {plan.errors.map(e => <p key={e} role="alert">{e}</p>)}
        <fieldset disabled={busy} className="person-fields">
          <label>Primary name after merge<select value={choices.primaryNameId || ''} onChange={e => changeChoice('primaryNameId', e.target.value)}>{plan.names.map(n => <option key={n.id} value={n.id}>{n.name} ({n.owner})</option>)}</select></label>
          <label>Gender after merge<select value={choices.genderChoice} onChange={e => changeChoice('genderChoice', e.target.value)}><option value="survivor">Survivor: {plan.survivor.gender || 'Unknown'}</option><option value="duplicate">Duplicate: {plan.duplicate.gender || 'Unknown'}</option></select></label>
          {plan.parentFamilies.length > 0 && <label>Parent family shown in fan<select value={choices.preferredFamilyId || ''} onChange={e => changeChoice('preferredFamilyId', e.target.value)}>{plan.parentFamilies.map(f => <option key={f.id} value={f.id}>{familyLabel(f)}</option>)}</select></label>}
          <p>A full recovery snapshot will be retained before applying the merge. This changes database records for every session.</p>
          <button disabled={plan.errors.length > 0} onClick={merge}>Confirm person merge</button>
        </fieldset>
      </section>}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Working with duplicate records…</p>}
    </Modal>}
  </section>;
}
