import React from 'react';
import Modal from './Modal';

const kinds = { name: 'name', event: 'event or attribute', note: 'note', source: 'source', citation: 'citation', media: 'attachment' };
const fieldsByKind = {
  name: [['full_text', 'Full name', true], ['name_type', 'Name type'], ['given_names', 'Given names'], ['surname', 'Surname'], ['language_tag', 'Language']],
  event: [['gedcom_tag', 'Event tag', true], ['type_text', 'Description'], ['value_text', 'Value'], ['date_original', 'Date expression'], ['place_name', 'Place']],
  note: [['text_value', 'Note text', true]],
  source: [['title', 'Source title', true], ['author', 'Author'], ['publication_text', 'Publication'], ['abbreviation', 'Abbreviation']],
  citation: [['page_text', 'Page or locator'], ['data_text', 'Evidence text']],
  media: [['title', 'Caption', true], ['description', 'Description'], ['provenance', 'Provenance']],
};

export default function PersonRecords({ treeId, personId, personName, onSaved, onClose }) {
  const [records, setRecords] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [fields, setFields] = React.useState({});
  const [error, setError] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const requestId = React.useRef(crypto.randomUUID());
  const formRef = React.useRef(null);
  const endpoint = `/api/trees/${encodeURIComponent(treeId)}/people/${encodeURIComponent(personId)}/records`;
  async function load() {
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load records');
      setRecords(data); requestId.current = crypto.randomUUID();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  React.useEffect(() => { load(); }, [endpoint]);
  React.useEffect(() => {
    if (editing) formRef.current?.querySelector('input, select, textarea')?.focus();
  }, [editing]);
  function begin(kind, record = null) {
    setEditing({ kind, id: record?.id }); setError(''); setStatus('');
    requestId.current = crypto.randomUUID();
    const initial = Object.fromEntries(fieldsByKind[kind].map(([key]) => [key, record?.[key] || '']));
    if (kind === 'name') initial.is_primary = record?.is_primary || false;
    if (kind === 'event' || kind === 'note') initial.owner_id = record?.person_id || record?.family_id || record?.fact_id || records.personId;
    if (kind === 'event') { initial.fact_kind = record?.fact_kind || 'EVENT'; initial.gedcom_tag ||= 'EVEN'; }
    if (kind === 'citation') {
      initial.source_id = record?.source_id || records.sources[0]?.id || '';
      initial.target_entity_id = record?.target_entity_id || records.personId;
      initial.quality = record?.quality ?? null;
    }
    if (kind === 'media') initial.target_entity_id = record?.target_entity_id || records.personId;
    setFields(initial);
  }
  async function chooseFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.size || file.size > 10485760) { setError('Choose a file of 1 byte to 10 MB.'); return; }
    setBusy(true); setError('');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Could not read the attachment.'));
        reader.readAsDataURL(file);
      });
      setFields(current => ({ ...current, filename: file.name, mime_type: file.type || 'application/octet-stream', data_base64: base64 }));
      requestId.current = crypto.randomUUID();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  function change(key, value) {
    setFields(current => ({ ...current, [key]: value }));
    requestId.current = crypto.randomUUID(); setError('');
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setStatus('Saving…');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        requestId: requestId.current, expectedRevision: records.revision,
        kind: editing.kind, recordId: editing.id, fields,
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Save failed. Your form is preserved.');
      setRecords(data.records); onSaved(data.archive); setEditing(null); setStatus('Saved in database');
    } catch (error) { setError(error.message); setStatus('Not saved — your form is preserved'); }
    finally { setBusy(false); }
  }
  const targets = records ? [
    { id: records.personId, label: personName },
    ...records.families.map(f => ({ id: f.id, label: `Family: ${f.label || f.members} (${f.id.slice(0, 8)})` })),
    ...records.events.map(f => ({ id: f.id, label: `${f.gedcom_tag}: ${f.date_original || 'Date unknown'} ${f.place_name || ''} (${f.id.slice(0, 8)})` })),
    ...records.names.map(n => ({ id: n.id, label: `Name: ${n.full_text}` })),
    ...records.notes.map(n => ({ id: n.id, label: `Note: ${n.text_value.slice(0, 60)}` })),
  ] : [];
  const targetLabel = id => targets.find(t => t.id === id)?.label || id;
  const ownerOptions = targets.filter(t => t.id === records?.personId || records?.families.some(f => f.id === t.id) || (editing?.kind === 'note' && records?.events.some(f => f.id === t.id)));
  const section = (title, kind, items, describe) => <section className="record-section" aria-label={title}>
    <div className="toolbar"><h3>{title}</h3><button disabled={busy} onClick={() => begin(kind)}>Add {kinds[kind]}</button></div>
    {!items.length && <p>No {title.toLowerCase()} recorded.</p>}
    <ul>{items.map(item => <li key={`${item.id}:${item.target_entity_id || ''}:${item.file_id || ''}`}><div>{describe(item)}</div><button disabled={busy} onClick={() => begin(kind, item)}>Edit {kinds[kind]}</button></li>)}</ul>
  </section>;
  return <Modal title={`Records and evidence — ${personName}`} onClose={() => { if (!busy) onClose(); }}>
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {!records && !error && <p role="status">Loading records…</p>}
    {error && <button disabled={busy} onClick={load}>{editing ? 'Refresh records, keep form' : 'Retry loading records'}</button>}
    {records && (editing ? <form ref={formRef} onSubmit={save}>
      <h3>{editing.id ? 'Edit' : 'Add'} {kinds[editing.kind]}</h3>
      <fieldset disabled={busy} className="person-fields">
        {fields.owner_id && <label>Applies to<select value={fields.owner_id} onChange={e => change('owner_id', e.target.value)}>{ownerOptions.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>}
        {editing.kind === 'event' && <>
          <p>Keep separate assertions as separate events. Date expressions such as ABT 1900 or BET 1900 AND 1902 are stored as written; an empty date remains unknown.</p>
          <label>Record type<select value={fields.fact_kind} onChange={e => change('fact_kind', e.target.value)}><option value="EVENT">Event</option><option value="ATTRIBUTE">Attribute</option></select></label>
        </>}
        {editing.kind === 'source' && editing.id && <p>This source may be cited by other people in this tree. Changes update the shared source.</p>}
        {editing.kind === 'media' && <>
          <p>Attachments are stored in the database with their caption and provenance. Keep the original file; database backups include the stored bytes.</p>
          {!editing.id && <label>Attachment file (maximum 10 MB)<input type="file" required onChange={chooseFile} /></label>}
          <label>Attached to<select disabled={Boolean(editing.id)} value={fields.target_entity_id} onChange={e => change('target_entity_id', e.target.value)}>{targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        </>}
        {editing.kind === 'citation' && <>
          <label>Source<select required value={fields.source_id} onChange={e => change('source_id', e.target.value)}><option value="">Choose a source</option>{records.sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
          {!records.sources.length && <p>Add a source before creating its citation.</p>}
          <label>Evidence for<select required value={fields.target_entity_id} onChange={e => change('target_entity_id', e.target.value)}>{targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <label>Evidence quality<select value={fields.quality ?? ''} onChange={e => change('quality', e.target.value === '' ? null : Number(e.target.value))}><option value="">Unknown</option><option value="0">0 — Unreliable</option><option value="1">1 — Questionable</option><option value="2">2 — Secondary evidence</option><option value="3">3 — Direct evidence</option></select></label>
        </>}
        {fieldsByKind[editing.kind].map(([key, label, required]) => <label key={key}>{label}{['text_value', 'data_text', 'publication_text'].includes(key)
          ? <textarea required={required} value={fields[key]} onChange={e => change(key, e.target.value)} />
          : <input required={required} value={fields[key]} onChange={e => change(key, e.target.value)} />}</label>)}
        {editing.kind === 'name' && <label className="checkbox"><input type="checkbox" checked={fields.is_primary} onChange={e => change('is_primary', e.target.checked)} />Use as primary name in the chart</label>}
        <div className="toolbar"><button type="button" onClick={() => setEditing(null)}>Cancel record edit</button><button type="submit">{busy ? 'Saving…' : 'Save record'}</button></div>
      </fieldset>
    </form> : <>
      <p>Repeated events retain separate assertions. The chart summarizes the first event of each type; this view shows every recorded assertion and its evidence.</p>
      {section('Names', 'name', records.names, n => <><strong>{n.full_text}</strong> {n.is_primary && '(Primary)'}<p>{[n.name_type, n.language_tag].filter(Boolean).join(' · ')}</p></>)}
      {section('Events and attributes', 'event', records.events, f => <><strong>{f.gedcom_tag} {f.type_text}</strong><p>{[f.date_original || 'Date unknown', f.place_name, f.value_text].filter(Boolean).join(' · ')}</p><small>{targetLabel(f.person_id || f.family_id)}</small></>)}
      {section('Notes', 'note', records.notes, n => <><p className="record-text">{n.text_value}</p><small>{targetLabel(n.person_id || n.family_id || n.fact_id)}</small></>)}
      {section('Sources', 'source', records.sources, s => <><strong>{s.title}</strong><p>{[s.author, s.publication_text].filter(Boolean).join(' · ')}</p></>)}
      {section('Citations', 'citation', records.citations, c => <><strong>{c.source_title}</strong><p>{c.page_text}</p><p className="record-text">{c.data_text}</p><small>Evidence for {targetLabel(c.target_entity_id)} · Quality {c.quality ?? 'unknown'}</small></>)}
      {section('Attachments', 'media', records.media || [], m => <><strong>{m.title}</strong><p>{m.description}</p><p>Provenance: {m.provenance || 'Not recorded'}</p><small>Attached to {targetLabel(m.target_entity_id)}</small>{m.file_id && <p>{m.byte_length != null ? <><a href={`/api/trees/${encodeURIComponent(treeId)}/media/${m.file_id}`} download={m.file_reference}>Download {m.file_reference}</a> ({m.byte_length} bytes)</> : <>Referenced file: {m.file_reference}. Its bytes were not imported; add an attachment to store the original file.</>}</p>}</>)}
    </>)}
  </Modal>;
}
