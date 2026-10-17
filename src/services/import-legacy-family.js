const { createHash, randomUUID } = require('node:crypto');
const { transformLegacyFamilyData } = require('../domain/legacy-transform');

async function importLegacyFamily(pool, input, options = {}) {
  const transformed = transformLegacyFamilyData(input, options);
  const client = await pool.connect();
  const importJobId = randomUUID();
  const checksum = createHash('sha256').update(JSON.stringify(input)).digest('hex');

  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM trees WHERE id = $1', [
      transformed.tree.id,
    ]);
    if (existing.rowCount > 0) {
      if (!options.replace) {
        throw new Error(
          `Tree ${transformed.tree.id} already exists; pass replace: true to replace it`,
        );
      }
      // Remove the previous import history explicitly; otherwise the jobs
      // would survive with tree_id set to NULL and no way to trace them.
      await client.query('DELETE FROM import_jobs WHERE tree_id = $1', [
        transformed.tree.id,
      ]);
      await client.query('DELETE FROM trees WHERE id = $1', [transformed.tree.id]);
    }

    await client.query(
      `INSERT INTO trees
        (id, name, source_gedcom_version, default_language)
       VALUES ($1, $2, $3, $4)`,
      [
        transformed.tree.id,
        transformed.tree.name,
        transformed.tree.sourceGedcomVersion,
        transformed.tree.defaultLanguage,
      ],
    );
    await client.query(
      `INSERT INTO import_jobs
        (id, tree_id, source_filename, source_format, checksum_sha256, status,
         warnings, started_at)
       VALUES ($1, $2, $3, 'JSON', $4, 'RUNNING', $5::jsonb, current_timestamp)`,
      [
        importJobId,
        transformed.tree.id,
        options.sourceFilename || 'family-data.json',
        checksum,
        JSON.stringify(transformed.warnings),
      ],
    );

    for (const entity of transformed.entities) {
      await client.query(
        'INSERT INTO entities (id, tree_id, entity_type) VALUES ($1, $2, $3)',
        [entity.id, entity.treeId, entity.entityType],
      );
    }
    for (const person of transformed.persons) {
      await client.query(
        'INSERT INTO persons (id, sex, created_from_import_id) VALUES ($1, $2, $3)',
        [person.id, person.sex, importJobId],
      );
    }
    for (const name of transformed.names) {
      await client.query(
        `INSERT INTO person_names
          (id, person_id, position, full_text, given_names, surname,
           language_tag, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          name.id,
          name.personId,
          name.position,
          name.fullText,
          name.givenNames,
          name.surname,
          name.languageTag,
          name.isPrimary,
        ],
      );
    }
    for (const place of transformed.places) {
      await client.query('INSERT INTO places (id, name) VALUES ($1, $2)', [
        place.id,
        place.name,
      ]);
    }
    for (const family of transformed.families) {
      await client.query(
        'INSERT INTO families (id, label, created_from_import_id) VALUES ($1, $2, $3)',
        [family.id, family.label, importJobId],
      );
    }
    for (const fact of transformed.facts) {
      await client.query(
        `INSERT INTO facts
          (id, person_id, position, fact_kind, gedcom_tag, value_text,
           date_original, date_calendar, date_modifier,
           date_start_year, date_start_month, date_start_day,
           date_end_year, date_end_month, date_end_day, place_id)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, $16)`,
        [
          fact.id,
          fact.personId,
          fact.position,
          fact.factKind,
          fact.gedcomTag,
          fact.valueText,
          fact.dateOriginal,
          fact.dateCalendar,
          fact.dateModifier,
          fact.dateStartYear,
          fact.dateStartMonth,
          fact.dateStartDay,
          fact.dateEndYear,
          fact.dateEndMonth,
          fact.dateEndDay,
          fact.placeId,
        ],
      );
    }
    for (const note of transformed.notes) {
      await client.query(
        `INSERT INTO notes
          (id, person_id, text_value, mime_type, language_tag)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          note.id,
          note.personId,
          note.textValue,
          note.mimeType,
          note.languageTag,
        ],
      );
    }
    for (const identifier of transformed.identifiers) {
      await client.query(
        `INSERT INTO identifiers
          (id, entity_id, identifier_type, value, authority_uri)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          identifier.id,
          identifier.entityId,
          identifier.identifierType,
          identifier.value,
          identifier.authorityUri,
        ],
      );
    }
    for (const partner of transformed.familyPartners) {
      await client.query(
        `INSERT INTO family_partners
          (family_id, person_id, position, role)
         VALUES ($1, $2, $3, $4)`,
        [partner.familyId, partner.personId, partner.position, partner.role],
      );
    }
    for (const child of transformed.familyChildren) {
      await client.query(
        `INSERT INTO family_children
          (family_id, person_id, position, pedigree, is_preferred)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          child.familyId,
          child.personId,
          child.position,
          child.pedigree,
          child.isPreferred,
        ],
      );
    }

    await client.query(
      'UPDATE trees SET root_person_id = $1, updated_at = current_timestamp WHERE id = $2',
      [transformed.tree.rootPersonId, transformed.tree.id],
    );
    await client.query(
      `UPDATE import_jobs
       SET status = 'COMPLETED', completed_at = current_timestamp
       WHERE id = $1`,
      [importJobId],
    );
    await client.query('COMMIT');

    return {
      importJobId,
      treeId: transformed.tree.id,
      people: transformed.persons.length,
      families: transformed.families.length,
      warnings: transformed.warnings,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    await recordFailedImport(client, {
      importJobId,
      treeId: transformed.tree.id,
      sourceFilename: options.sourceFilename || 'family-data.json',
      checksum,
      warnings: transformed.warnings,
      error,
    });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Persists a FAILED import job after the import transaction has been rolled
 * back. The tree link is only kept if the tree still exists (e.g. a refused
 * re-import); a brand-new tree is gone after rollback. Logging failures must
 * never mask the original import error, so they are only reported.
 */
async function recordFailedImport(
  client,
  { importJobId, treeId, sourceFilename, checksum, warnings, error },
) {
  try {
    const existing = await client.query('SELECT id FROM trees WHERE id = $1', [
      treeId,
    ]);
    await client.query(
      `INSERT INTO import_jobs
        (id, tree_id, source_filename, source_format, checksum_sha256, status,
         warnings, error_message, started_at, completed_at)
       VALUES ($1, $2, $3, 'JSON', $4, 'FAILED', $5::jsonb, $6,
               current_timestamp, current_timestamp)`,
      [
        importJobId,
        existing.rowCount > 0 ? treeId : null,
        sourceFilename,
        checksum,
        JSON.stringify(warnings),
        error.message,
      ],
    );
  } catch (loggingError) {
    console.error('Could not record failed import job', loggingError);
  }
}

module.exports = { importLegacyFamily };
