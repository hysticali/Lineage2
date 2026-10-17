import archiveTools from '../src/domain/archive';
const { validateArchive } = archiveTools;

export async function loadFamilyData(treeId = '') {
  const response = await fetch(treeId ? `/api/trees/${encodeURIComponent(treeId)}/family-data` : '/api/family-data', { headers: { Accept: 'application/json' } });
  const type = response.headers.get('content-type') || '';
  // A plain static server returns an HTML 404 for /api. JSON errors indicate a
  // real backend and must never be treated as permission to show sample data.
  const backendPage = document.querySelector('meta[name="lineage-mode"]')?.content === 'database';
  if (!treeId && !backendPage && response.status === 404 && !type.includes('application/json')) {
    const sample = await fetch('/family-data.json');
    if (!sample.ok) throw new Error(`Sample archive could not be loaded (${sample.status})`);
    const data = await sample.json();
    validateArchive(data);
    return { ...data, mode: 'static', treeId: 'static:family-data.json', treeName: 'Sample family archive' };
  }
  if (!response.ok) throw new Error(`Database archive is unavailable (${response.status}). Your browser edits are preserved.`);
  const data = await response.json();
  validateArchive(data);
  if (!data.treeId) throw new Error('Database response is missing its tree identity');
  return { ...data, mode: 'database', treeName: data.treeName || 'Family archive' };
}

export async function savePerson(treeId, personId, body) {
  const response = await fetch(`/api/trees/${encodeURIComponent(treeId)}/people${personId ? `/${encodeURIComponent(personId)}` : ''}`, {
    method: personId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Save failed. Your form is preserved.');
  return data.archive;
}

export async function listTrees() {
  const response = await fetch('/api/trees');
  if (!response.ok) throw new Error('Could not load the tree list');
  return (await response.json()).trees;
}
