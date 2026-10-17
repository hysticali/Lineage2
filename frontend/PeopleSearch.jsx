import React from 'react';
import graph from '../src/domain/graph';

export default function PeopleSearch({ family, onSelect }) {
  const [query, setQuery] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const result = React.useMemo(() => graph.searchPeople(family, query, offset, 25), [family, query, offset]);
  React.useEffect(() => setOffset(0), [family]);
  return <section className="people-search" aria-label="Find a person">
    <div className="toolbar"><label htmlFor="people-search">Find a person</label><button onClick={() => { setQuery(''); setOffset(0); }}>Browse people</button></div>
    <input id="people-search" type="search" value={query} placeholder="Name, date, or birthplace" onChange={(event) => { setQuery(event.target.value); setOffset(0); }} />
      <p role="status">{result.total} matching people</p>
      {!result.total && <p>No people match. Try another name, date, or place.</p>}
      <ul className="people-results">{result.people.map((person) => <li key={person.id}><button onClick={() => onSelect(person.id)}><strong>{person.name}</strong><span>{[person.birth, person.birthplace].filter(Boolean).join(' · ')}</span></button></li>)}</ul>
      <div className="toolbar">
        <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Previous people</button>
        <span>{result.total ? offset + 1 : 0}–{Math.min(offset + 25, result.total)} of {result.total}</span>
        <button disabled={offset + 25 >= result.total} onClick={() => setOffset(offset + 25)}>Next people</button>
      </div>
  </section>;
}
