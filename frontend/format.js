const GENERATIONAL_SUFFIX = /^(?:jr\.?|sr\.?|ii|iii|iv|v)$/i;

function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  while (parts.length > 1 && GENERATIONAL_SUFFIX.test(parts[parts.length - 1].replace(/,+$/, ''))) {
    parts.pop();
  }
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function splitDisplayName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { first: 'Unknown', rest: '' };
  return { first: parts[0], rest: parts.slice(1).join(' ') };
}

function truncateLabel(text, maxChars) {
  const value = String(text || '').trim();
  if (!value || maxChars < 1) return '';
  if (value.length <= maxChars) return value;
  return maxChars === 1 ? '…' : `${value.slice(0, maxChars - 1)}…`;
}

function formatLifespan(birth, death) {
  const b = String(birth || '').trim();
  const d = String(death || '').trim();
  if (b && d) return `${b}–${d}`;
  if (b) return `b. ${b}`;
  if (d) return `d. ${d}`;
  return '';
}

function generationLabel(gen, viewDirection, lineageSide = null, isSibling = false) {
  const ancestorNames = ['Self', 'Parent', 'Grandparent', 'Great-grandparent', '2× Great-grandparent', '3× Great-grandparent', '4× Great-grandparent'];
  const descendantNames = ['Self', 'Child', 'Grandchild', 'Great-grandchild', '2× Great-grandchild', '3× Great-grandchild', '4× Great-grandchild'];
  const list = viewDirection === 'descendants' ? descendantNames : ancestorNames;
  const base = list[Math.min(gen, list.length - 1)] || `Generation ${gen}`;
  const side = lineageSide === 'maternal' ? 'Maternal ' : lineageSide === 'paternal' ? 'Paternal ' : '';
  return `${side}${base}${isSibling ? ' · Sibling' : ''}`;
}

module.exports = {
  getInitials,
  splitDisplayName,
  truncateLabel,
  formatLifespan,
  generationLabel,
};
