import archiveTools from '../src/domain/archive';
import { readJson } from './http';
const { validateArchive } = archiveTools;

export async function loadFamilyData(treeId = '', options = {}) {
  const response = await fetch(treeId ? `/api/trees/${encodeURIComponent(treeId)}/family-data` : '/api/family-data', { headers: { Accept: 'application/json' }, signal: options.signal });
  const type = response.headers.get('content-type') || '';
  // A plain static server returns an HTML 404 for /api. JSON errors indicate a
  // real backend and must never be treated as permission to show sample data.
  const backendPage = document.querySelector('meta[name="lineage-mode"]')?.content === 'database';
  if (!treeId && !backendPage && response.status === 404 && !type.includes('application/json')) {
    const sample = await fetch('/family-data.json', { signal: options.signal });
    const data = await readJson(sample, 'Sample archive could not be loaded');
    validateArchive(data);
    return { ...data, mode: 'static', treeId: 'static:family-data.json', treeName: 'Sample family archive' };
  }
  if (!response.ok) throw new Error(`Database archive is unavailable (${response.status}). Your browser edits are preserved.`);
  const data = await readJson(response, 'Database archive is unavailable');
  validateArchive(data);
  if (!data.treeId) throw new Error('Database response is missing its tree identity');
  return { ...data, mode: 'database', treeName: data.treeName || 'Family archive' };
}

export async function savePerson(treeId, personId, body) {
  const response = await fetch(`/api/trees/${encodeURIComponent(treeId)}/people${personId ? `/${encodeURIComponent(personId)}` : ''}`, {
    method: personId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await readJson(response, 'Save failed. Your form is preserved');
  return data.archive;
}

export async function listTrees() {
  const response = await fetch('/api/trees');
  return (await readJson(response, 'Could not load the tree list')).trees;
}
