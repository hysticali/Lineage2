# GEDCOM exchange contract

Status: implemented and verified for the subset below, including browser
preview/import/export, source retention, reviewed existing-tree imports,
duplicate merging, and recovery. This is a subset implementation with opaque
retention, not a complete GEDCOM conformance validator.

Reference checked on 2026-10-15: the official
[FamilySearch GEDCOM 7 specification, revision 7.0.18](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html).
The implementation targets UTF-8 GEDCOM 7.0 `.ged` files. GEDCOM 5.5.1 and GEDZIP
are outside the first release and must be rejected with a clear explanation.

The specification defines hierarchical records and pointers, repeated
assertions, and extension schemas. Family partner tags must not determine a
person's sex or gender. Names retain their payload and optional structured
pieces. Implement these rules against the official grammar and record sections,
with tests for reciprocal family links, ordering, multiline text, and literal
at-sign escaping.

## First-release application subset

| Record or structure | Application behavior |
| --- | --- |
| Header, trailer, version | Require one complete document; retain original header and schema metadata. |
| Individuals | Names and name pieces, sex, identifiers, notes, restrictions, repeated events/attributes. |
| Families | Partners, children, preferred parent families and pedigree; multiple partners across multiple families; missing parents remain missing. |
| Events and attributes | Common person/family tags, type, value, original date expression, place, notes, citations. |
| Sources and citations | Source title/author/publication/abbreviation; evidence target, page, text, quality. |
| Media | Retain file references, captions, format, and links; never fetch remote files or resolve source paths automatically. Stored application attachments remain downloadable and part of full-tree backups. |
| Unsupported structures | Preserve original source and raw subtrees with a visible warning; retain pointer meaning when exporting. |

All import attempts must preview counts, version, root choices, validation
errors, warnings, and unsupported structures before creating a tree. The default
import creates an independent tree with fresh application UUIDs and import-local
cross references. A reviewed import can also add separate records to the current
tree, preserving its root and retaining a full recovery snapshot. Possible
matching names are listed before confirmation; people are combined only through
an explicit person merge. Conflicting extension schemas require a separate
tree so their meanings remain unambiguous.
Retain the original source filename, UTF-8 bytes, checksum, import report, and
pointer mapping. Parsing or relationship failures must leave no partial tree.

Export must use current relational records rather than the fan projection.
It must report data that cannot be represented in the supported subset, retain
extension URI definitions, and avoid silently inventing precise dates, parent
gender, or missing people. The full-tree JSON backup remains the complete native
recovery format, including stored binary attachments and application metadata.

## Delivered behavior and limits

- Import accepts at most 20 MB of UTF-8 text, 100,000 individuals, 1,000,000 lines, and 64 nested levels. The browser rejects invalid UTF-8 instead of silently replacing bytes.
- Preview lists counts, root choices, errors, warnings, and retained unsupported structures. Root choices use a bounded name-filtered select. An import checksum prevents confirmation of a file that changed after preview.
- Original bytes, filename, checksum, header, structure bindings, and pointer mappings are stored in PostgreSQL. **Import provenance** downloads the original file. Full-tree backup version 2 retains this metadata, verifies its checksums and structures on restore, and also accepts older version 1 backups without GEDCOM data.
- Name pieces, common events/attributes, literal dates, places, notes, sources, citations, repositories, family memberships, preferred parentage, restrictions, and media references are mapped into relational records. Shared notes, place maps, name notes/translations, additional repository detail, and other unsupported content remain in raw structures and are reported.
- Imported dates retain their original expressions and substructures. Native date edits outside the simple supported date grammar export through `DATE.PHRASE`, preserving the expression without inventing precision. Calendar arithmetic is not implemented.
- Export overlays current relational assertions onto original structures. Untouched unsupported fields retain their payloads, ordering, extension definitions, and pointer meaning. Multiple imported headers remain downloadable with their source files; the export uses the earliest header and combines compatible schemas.
- Native name-language metadata without an explicit translated name is reported as requiring a full-tree backup. Stored binary attachments are referenced by filename in `.ged`; their bytes remain downloadable and are included in full-tree JSON/PostgreSQL backups.
- A matching-name suggestion does not establish identity. Merge preview exposes names, gender, parent-family choices, transferred records, conflicts, and graph errors. All names/events/notes/evidence remain separate assertions. The surviving identity remains stable, former identifiers resolve as aliases, and edit history can restore the complete pre-merge state.
- Merges reject ancestry cycles, cross-tree references, conflicting pedigree/status for the same shared family, and incompatible partner roles or identifier authorities. Ambiguous relationships remain separate until resolved.
- Imported identifiers remain in original structures; native UUIDs provide collision-free application identity. Re-importing a file creates independent application records rather than automatically matching external identifiers.
- In private mode, exports default to the privacy-filtered basic-detail subset, built without raw original structures or private evidence. Owners/editors can explicitly include private data. Native living-status and publication approvals require full-tree backups; GEDCOM re-import starts with unknown, unpublished people and retains imported restrictions. The export report explains this limit.

## Rootline extensions

These URIs define application-specific data. Preferred tag spellings can receive
a suffix if an original file already uses the spelling with another meaning.
Import recognizes the declared URI, not a gender inference or an arbitrary
foreign tag with a similar name.

| URI | Meaning |
| --- | --- |
| `urn:rootline:gedcom:root` | Chosen root individual; used to preserve the root on re-import. |
| `urn:rootline:gedcom:partner` | An additional family partner beyond the standard two layout tags. |
| `urn:rootline:gedcom:fact` | An assertion whose native tag or kind does not fit the supported standard context. |
| `urn:rootline:gedcom:tag` | Original tag of that extended assertion. |
| `urn:rootline:gedcom:kind` | `EVENT` or `ATTRIBUTE` for that assertion. |
| `urn:rootline:gedcom:description` | Native attachment description. |
| `urn:rootline:gedcom:provenance` | Native attachment provenance. |

Undocumented original extensions stay undocumented; export does not invent URI
meanings for them. Other genealogy software may preserve Rootline extensions
without interpreting them. Use the native backup for complete application data.

## Verification coverage

- Parse and reject malformed levels, duplicate cross references, missing records, broken pointers, cycles, unsupported versions, and oversized files.
- Round-trip fixtures with multiple families, same-sex or unknown-sex partners, adopted/foster children, missing parents, repeated/conflicting dates, notes, citations, and custom extension data.
- Compare supported semantic records after export/re-import, allowing fresh application UUIDs and export-local pointer labels.
- Verify original source download and preservation of unsupported structures after ordinary edits.
- Exercise import preview/confirmation and export through the browser, including failed imports and repeat-safe retries.
- Exercise duplicate review, merge preview, aliases, rollback, and reviewed imports into existing trees, including extension-schema conflicts.
