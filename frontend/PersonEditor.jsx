import React from 'react';
import Modal from './Modal';
import wheel from '../src/domain/wheel';

export default function PersonEditor({ context, family, database, onSubmit, onClose, onRefresh }) {
  const target = family[context.personId];
  const editing = context.type === 'edit';
  const spouses = wheel.getSpouses(context.personId, family);
  const [fields, setFields] = React.useState(() => Object.fromEntries(
    ['name', 'gender', 'birth', 'death', 'birthplace', 'occupation', 'bio'].map((key) => [key,
      editing ? target?.[key] || '' : key === 'gender' ? context.type === 'father' ? 'M' : 'F' : '',
    ]),
  ));
  const [existingPersonId, setExistingPersonId] = React.useState('');
  const [coParentId, setCoParentId] = React.useState(context.type === 'child' && spouses.length === 1 ? spouses[0].id : '');
  const [pedigree, setPedigree] = React.useState('UNKNOWN');
  const [preferred, setPreferred] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const requestId = React.useRef(crypto.randomUUID());
  const dirty = () => { requestId.current = crypto.randomUUID(); setError(''); };
  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await onSubmit(`p_${requestId.current}`, fields, {
        ...context, requestId: requestId.current, existingPersonId, coParentId, pedigree, preferred,
      });
      onClose();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  const relative = !editing && context.type !== 'person';
  return <Modal title={editing ? 'Edit Person' : 'Add Family Member'} onClose={() => { if (!busy) onClose(); }}>
    <p>{editing ? target?.name : relative ? `${context.type === 'parent' ? 'Additional parent' : context.type} of ${target?.name}` : 'Add an independent person to this tree'}</p>
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="person-fields">
        {database && relative && <label>Use an existing person
          <select value={existingPersonId} onChange={(event) => { setExistingPersonId(event.target.value); dirty(); }}>
            <option value="">Create a new person</option>
            {Object.values(family).filter((person) => person.id !== context.personId).sort((a, b) => a.name.localeCompare(b.name)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>}
        {!existingPersonId && <>
          <label>Full Name *<input autoFocus required maxLength={500} value={fields.name} onChange={(event) => { setFields({ ...fields, name: event.target.value }); dirty(); }} /></label>
          <label>Gender<select value={fields.gender} onChange={(event) => { setFields({ ...fields, gender: event.target.value }); dirty(); }}>
            <option value="F">Female</option><option value="M">Male</option><option value="X">Non-binary</option><option value="U">Unknown</option>
          </select></label>
          {[
            ['birth', 'Birth date', 'e.g. 1942 or ABT 1942'], ['death', 'Death date', 'Leave blank if unknown'],
            ['birthplace', 'Birthplace', 'City, Country'], ['occupation', 'Occupation', 'Occupation'],
          ].map(([key, label, placeholder]) => <label key={key}>{label}<input value={fields[key]} placeholder={placeholder} onChange={(event) => { setFields({ ...fields, [key]: event.target.value }); dirty(); }} /></label>)}
          <label>Notes<textarea rows={3} value={fields.bio} onChange={(event) => { setFields({ ...fields, bio: event.target.value }); dirty(); }} /></label>
        </>}
        {context.type === 'child' && <label>Other parent<select value={coParentId} onChange={(event) => { setCoParentId(event.target.value); dirty(); }}>
          <option value="">No other parent recorded</option>
          {Object.values(family).filter((person) => person.id !== context.personId && person.id !== existingPersonId).sort((a, b) => a.name.localeCompare(b.name)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select></label>}
        {database && relative && context.type !== 'spouse' && <>
          <label>Parentage<select value={pedigree} onChange={(event) => { setPedigree(event.target.value); dirty(); }}>
            <option value="UNKNOWN">Unknown</option><option value="BIRTH">Biological</option><option value="ADOPTED">Adopted</option><option value="FOSTER">Foster</option><option value="SEALING">Sealing</option>
          </select></label>
          {context.type === 'parent' && <label className="checkbox"><input type="checkbox" checked={preferred} onChange={(event) => { setPreferred(event.target.checked); dirty(); }} />Use this family in the fan</label>}
        </>}
        {error && <p role="alert">{error}</p>}
        {error && database && <button type="button" onClick={async () => {
          setBusy(true);
          try { await onRefresh(); dirty(); } catch (error) { setError(error.message); }
          finally { setBusy(false); }
        }}>Refresh tree, keep form</button>}
        <div className="toolbar"><button type="submit">{busy ? 'Saving…' : editing ? 'Save person' : 'Add to Lineage'}</button><button type="button" onClick={onClose}>Cancel</button></div>
      </fieldset>
    </form>
  </Modal>;
}
