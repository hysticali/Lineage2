const { fingerprint, validateArchive } = require('../src/domain/archive');

const MAX_RECOVERIES = 10;

const storageKeyFor = (treeId) => `lineage-v3:${encodeURIComponent(treeId)}`;

function readRecoveries(storage, key) {
  const value = JSON.parse(storage.getItem(`${key}:recoveries`) || '[]');
  if (!Array.isArray(value)) throw new Error('Recovery storage is invalid; export it before continuing');
  return value;
}

function isQuotaError(error) {
  return Boolean(
    error &&
      (error.name === 'QuotaExceededError' ||
        error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        error.code === 22 ||
        error.code === 1014),
  );
}

function preserveRecovery(storage, key, raw, reason) {
  const entries = readRecoveries(storage, key);
  if (entries.some((entry) => entry.raw === raw)) return entries;
  entries.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), reason, raw });
  while (entries.length > MAX_RECOVERIES) entries.shift();
  const storageKey = `${key}:recoveries`;
  while (true) {
    try {
      storage.setItem(storageKey, JSON.stringify(entries));
      return entries;
    } catch (error) {
      if (isQuotaError(error) && entries.length > 1) {
        entries.shift();
        continue;
      }
      throw error;
    }
  }
}

function clearRecoveries(storage, key) {
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(`${key}:recoveries`);
  } else {
    storage.setItem(`${key}:recoveries`, '[]');
  }
  return [];
}

function legacyFingerprint(family) {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(family)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return (hash >>> 0).toString(16);
}

function loadLocalState(storage, source) {
  const key = storageKeyFor(source.treeId);
  const initialArchive = { rootId: source.rootId, family: source.family, ...(source.families && { families: source.families }) };
  const baseFingerprint = fingerprint(initialArchive);
  const result = { key, baseFingerprint, archive: initialArchive, centerId: source.rootId, recoveries: [], notice: '', blocked: false };
  try {
    result.recoveries = readRecoveries(storage, key);
    const scopedRaw = storage.getItem(key);
    // Old saves had no tree identity. Only adopt them in the static archive;
    // leave them available for an explicit previewed database migration later.
    const legacyRaw = !scopedRaw && source.mode === 'static' ? storage.getItem('lineage-v2') : null;
    const raw = scopedRaw || legacyRaw;
    if (!raw) return result;
    const saved = JSON.parse(raw);
    if (!saved?.family && !saved?.archive) return result;
    const savedArchive = saved.archive || { rootId: source.rootId, family: saved.family };
    let valid = true;
    try { validateArchive(savedArchive); } catch { valid = false; }
    const matches = legacyRaw
      ? !saved.baseFingerprint || saved.baseFingerprint === legacyFingerprint(source.family)
      : saved.baseFingerprint === baseFingerprint;
    if (legacyRaw || !matches || !valid) {
      result.recoveries = preserveRecovery(storage, key, raw, !valid ? 'Invalid saved archive' : matches ? 'Before storage upgrade' : 'Source archive changed');
    }
    if (valid && matches) {
      result.archive = savedArchive;
      result.centerId = savedArchive.family[saved.centerId] ? saved.centerId : savedArchive.rootId;
    } else {
      result.notice = 'Your previous edits are preserved in Recovery copies. Review a copy before restoring it to this archive.';
    }
  } catch (error) {
    // No automatic overwrite if reading or preserving the previous state failed.
    result.blocked = true;
    result.notice = `Browser storage could not be recovered: ${error.message}. Download a backup of any new work.`;
  }
  return result;
}

function recoveryArchive(entry, fallbackRootId) {
  const data = JSON.parse(entry.raw);
  const archive = data.archive || { rootId: data.rootId || fallbackRootId, family: data.family };
  validateArchive(archive);
  return archive;
}

module.exports = {
  MAX_RECOVERIES,
  storageKeyFor,
  readRecoveries,
  preserveRecovery,
  clearRecoveries,
  loadLocalState,
  recoveryArchive,
};
