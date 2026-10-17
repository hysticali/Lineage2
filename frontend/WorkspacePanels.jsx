import React from 'react';
import Modal from './Modal';
import PeopleSearch from './PeopleSearch';

export function useMobileLayout() {
  const [mobile, setMobile] = React.useState(() => matchMedia('(max-width: 800px)').matches);
  React.useEffect(() => {
    const query = matchMedia('(max-width: 800px)'), update = () => setMobile(query.matches);
    query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

export function PeopleDrawer({ family, onSelect, onClose }) {
  const chosen = React.useRef(false);
  return <Modal title="Find a person" variant="drawer" onClose={onClose}
    returnFocus={() => chosen.current ? document.querySelector('[data-center-person-id]') : null}>
    <p className="drawer-intro">Search names, dates, or places. Choose someone to center their family wheel.</p>
    <PeopleSearch family={family} onSelect={id => { chosen.current = true; onSelect(id); onClose(); }} />
  </Modal>;
}

export function ToolsDrawer({ groups, initialGroup, onClose }) {
  const [active, setActive] = React.useState(initialGroup || null);
  return <Modal title="Tree tools" variant="drawer" onClose={onClose}>
    <p className="drawer-intro">Manage your archive here. The family wheel stays in place behind this panel.</p>
    <div className="tool-groups">{groups.map(group => <section className="tool-group" key={group.id}>
      <button className="tool-group-heading" aria-label={group.title} aria-expanded={active === group.id} aria-controls={`tools-${group.id}`} onClick={() => setActive(active === group.id ? null : group.id)}>
        <span><strong>{group.title}</strong><small>{group.description}</small></span><span aria-hidden="true">{active === group.id ? '−' : '+'}</span>
      </button>
      {active === group.id && <div id={`tools-${group.id}`} className="tool-group-content">{group.content}</div>}
    </section>)}</div>
  </Modal>;
}
