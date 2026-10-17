// GEDCOM 7 container syntax. Semantic record conversion lives separately so
// unsupported structures retain their payloads, pointers, and child order.
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_DEPTH = 64;
class GedcomError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

function children(node, tag) { return (node?.children || []).filter(child => child.tag === tag); }
function child(node, tag) { return children(node, tag)[0] || null; }

function decodeValue(raw, line) {
  if (raw === undefined) return { value: '', pointer: null };
  if (raw === '') throw new GedcomError(`Line ${line}: remove the delimiter after an empty payload`);
  if (raw.startsWith('@@')) return { value: raw.slice(1), pointer: null };
  if (raw.startsWith('@')) {
    if (!/^@[A-Z0-9_]+@$/.test(raw)) throw new GedcomError(`Line ${line}: escape a leading literal @ by doubling it`);
    return { value: '', pointer: raw };
  }
  return { value: raw, pointer: null };
}

function parseGedcom(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_BYTES) throw new GedcomError('GEDCOM must be UTF-8 text of at most 20 MB');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]/u.test(source) || /[\ud800-\udfff]/u.test(source)) throw new GedcomError('GEDCOM contains prohibited control characters or invalid Unicode');
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length > 1000000) throw new GedcomError('GEDCOM exceeds 1,000,000 lines');
  const records = [], stack = [], xrefs = new Map(), pointers = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(0|[1-9][0-9]*) (?:@([A-Z0-9_]+)@ )?([A-Z][A-Z0-9_]*|_[A-Z0-9_]+)(?: (.*))?$/.exec(lines[i]);
    if (!match) throw new GedcomError(`Line ${i + 1}: invalid GEDCOM level, tag, or delimiters`);
    const level = Number(match[1]), tag = match[3], xref = match[2] ? `@${match[2]}@` : null;
    if (level > MAX_DEPTH) throw new GedcomError(`Line ${i + 1}: structure exceeds ${MAX_DEPTH} levels`);
    if (xref && (level !== 0 || xref === '@VOID@' || ['HEAD', 'TRLR'].includes(tag))) throw new GedcomError(`Line ${i + 1}: cross reference is allowed only on a record`);
    if (tag === 'CONC') throw new GedcomError(`Line ${i + 1}: CONC is not supported in GEDCOM 7; use CONT for multiline text`);
    const decoded = decodeValue(match[4], i + 1);
    const node = { tag, xref, ...decoded, children: [], line: i + 1 };
    if (level > 0) {
      const parent = stack[level - 1];
      if (!parent) throw new GedcomError(`Line ${i + 1}: skipped level or child of a continuation`);
      if (tag === 'CONT') {
        if (xref || decoded.pointer || parent.pointer || parent.children.length) throw new GedcomError(`Line ${i + 1}: continuation must follow text before any substructures`);
        parent.value += `\n${decoded.value}`;
        stack.length = level;
        continue;
      }
      parent.children.push(node);
    } else {
      if (tag === 'CONT') throw new GedcomError(`Line ${i + 1}: continuation must have a parent`);
      records.push(node);
    }
    stack.length = level; stack[level] = node;
    if (xref) {
      if (xrefs.has(xref)) throw new GedcomError(`Line ${i + 1}: duplicate cross reference ${xref}`);
      xrefs.set(xref, node);
    }
    if (decoded.pointer && decoded.pointer !== '@VOID@') pointers.push(node);
  }
  const head = records[0], trailer = records.at(-1);
  if (head?.tag !== 'HEAD' || trailer?.tag !== 'TRLR' || records.filter(r => r.tag === 'HEAD').length !== 1 || records.filter(r => r.tag === 'TRLR').length !== 1) throw new GedcomError('GEDCOM requires one HEAD first and one TRLR last');
  if (head.value || head.pointer || trailer.value || trailer.pointer || trailer.children.length) throw new GedcomError('HEAD and TRLR cannot have payloads; TRLR cannot have children');
  const gedc = children(head, 'GEDC');
  const versions = children(gedc[0], 'VERS');
  const version = versions[0]?.value;
  if (gedc.length !== 1 || versions.length !== 1 || !/^7\.0(?:\.\d+)?$/.test(version || '')) throw new GedcomError('This release accepts GEDCOM 7.0 UTF-8 files; GEDCOM 5.5.1 and GEDZIP are not supported');
  for (const node of pointers) if (!xrefs.has(node.pointer)) throw new GedcomError(`Line ${node.line}: missing pointer target ${node.pointer}`);
  const warnings = [];
  if (!source.startsWith('\uFEFF')) warnings.push('The recommended UTF-8 byte-order mark is absent.');
  return { records, xrefs, version, warnings };
}

function encodeText(value) { return value.startsWith('@') ? `@${value}` : value; }

function serializeGedcom(records) {
  const lines = [];
  const pending = [...records].reverse().map(node => ({ node, level: 0 }));
  while (pending.length) {
    const { node, level } = pending.pop();
    if (level > MAX_DEPTH || !/^(?:[A-Z][A-Z0-9_]*|_[A-Z0-9_]+)$/.test(node.tag)) throw new GedcomError('Cannot export invalid tags or excessive structure depth');
    if (node.pointer && !/^@[A-Z0-9_]+@$/.test(node.pointer)) throw new GedcomError('Cannot export an invalid pointer');
    if (node.xref && (level !== 0 || !/^@[A-Z0-9_]+@$/.test(node.xref) || node.xref === '@VOID@')) throw new GedcomError('Cannot export an invalid cross reference');
    const parts = String(node.value || '').split(/\r\n|\r|\n/);
    const prefix = `${level} ${node.xref ? `${node.xref} ` : ''}${node.tag}`;
    const payload = node.pointer || encodeText(parts[0]);
    lines.push(prefix + (payload ? ` ${payload}` : ''));
    if (node.pointer && (parts.length > 1 || parts[0])) throw new GedcomError('A pointer cannot also contain text');
    for (const part of parts.slice(1)) lines.push(`${level + 1} CONT${part ? ` ${encodeText(part)}` : ''}`);
    for (let i = (node.children || []).length - 1; i >= 0; i--) pending.push({ node: node.children[i], level: level + 1 });
  }
  const source = '\uFEFF' + lines.join('\n') + '\n';
  parseGedcom(source);
  return source;
}

module.exports = { MAX_BYTES, MAX_DEPTH, GedcomError, children, child, parseGedcom, serializeGedcom };
