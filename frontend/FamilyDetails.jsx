import React from 'react';

const labels = { BIRTH: 'Biological', ADOPTED: 'Adopted', FOSTER: 'Foster', SEALING: 'Sealing', UNKNOWN: 'Unknown parentage' };

export default function FamilyDetails({ personId, archive }) {
  const groups = (archive.families || []).filter((group) => group.children.some((child) => child.personId === personId));
  if (!groups.length) return null;
  return <section className="family-details" aria-label="Parent families">
    <h3>Parent families</h3>
    {groups.map((group) => {
      const child = group.children.find((member) => member.personId === personId);
      return <div key={group.id}>
        <p>{labels[child.pedigree] || child.pedigree}{child.preferred ? ' · Shown in fan' : ''}</p>
        <p>{group.partners.length ? group.partners.map((parent) => archive.family[parent.personId]?.name || 'Unknown person').join(' + ') : 'Parents not recorded; explicit sibling link'}</p>
      </div>;
    })}
  </section>;
}
