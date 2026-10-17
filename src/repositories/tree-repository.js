class TreeRepository {
  constructor(pool, { inTransaction = false } = {}) {
    this.pool = pool;
    this.inTransaction = inTransaction;
  }

  async queryMany(queries) {
    const results = [];
    for (const query of queries) results.push(await query());
    return results;
  }

  async health() {
    await this.pool.query('SELECT 1');
    return { status: 'ok' };
  }

  async listTrees(userId = null) {
    const [result, countsResult] = await this.queryMany([
      () => this.pool.query(`
      SELECT t.id, t.name, t.root_person_id, t.source_gedcom_version, t.revision,
             t.default_language, t.created_at, t.updated_at,
             pn.full_text AS root_person_name,
             (SELECT role FROM tree_memberships m WHERE m.tree_id = t.id AND m.user_id = $1) AS access_role
      FROM trees t
      LEFT JOIN person_names pn ON pn.person_id = t.root_person_id AND pn.is_primary
      WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM tree_memberships m WHERE m.tree_id = t.id AND m.user_id = $1))
      ORDER BY t.name, t.id
    `, [userId]),
      () => this.pool.query(`
        SELECT tree_id, COUNT(*)::integer AS people_count
        FROM entities
        WHERE entity_type = 'PERSON' AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM tree_memberships m WHERE m.tree_id = entities.tree_id AND m.user_id = $1))
        GROUP BY tree_id
      `, [userId]),
    ]);
    const counts = new Map(
      countsResult.rows.map((row) => [row.tree_id, row.people_count]),
    );
    return result.rows.map((row) => ({
      ...row,
      people_count: counts.get(row.id) || 0,
    }));
  }

  async getTree(treeId) {
    const result = await this.pool.query(
      `SELECT t.id, t.name, t.root_person_id, t.source_gedcom_version, t.revision,
              t.default_language, t.created_at, t.updated_at,
              pn.full_text AS root_person_name
       FROM trees t
       LEFT JOIN person_names pn
         ON pn.person_id = t.root_person_id AND pn.is_primary
       WHERE t.id = $1`,
      [treeId],
    );
    return result.rows[0] || null;
  }

  async getDefaultTree(userId = null) {
    const result = await this.pool.query(
      'SELECT id FROM trees WHERE ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM tree_memberships m WHERE m.tree_id = trees.id AND m.user_id = $1)) ORDER BY created_at, id LIMIT 1', [userId],
    );
    return result.rows[0] || null;
  }

  async listPeople(treeId) {
    const result = await this.pool.query(
      `SELECT p.id, p.sex, pn.full_text AS name, pn.given_names,
              pn.surname, refn.value AS reference_id
       FROM persons p
       JOIN entities e ON e.id = p.id
       LEFT JOIN person_names pn ON pn.person_id = p.id AND pn.is_primary
       LEFT JOIN LATERAL (SELECT value FROM identifiers
         WHERE entity_id = p.id AND identifier_type = 'REFN' ORDER BY id LIMIT 1) refn ON true
       WHERE e.tree_id = $1
       ORDER BY pn.surname NULLS LAST, pn.given_names NULLS LAST, p.id`,
      [treeId],
    );
    return result.rows;
  }

  async getWheelFamilyData(treeId) {
    if (!this.inTransaction) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await new TreeRepository(client, { inTransaction: true }).getWheelFamilyData(treeId);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
    const tree = await this.getTree(treeId);
    if (!tree) return null;

    const [peopleResult, factsResult, notesResult, partnersResult, childrenResult, aliasesResult] =
      await this.queryMany([
        () => this.pool.query(
          `SELECT p.id, p.sex, p.living_status, p.is_public, pn.full_text AS name,
                  EXISTS (SELECT 1 FROM restrictions r WHERE r.entity_id = p.id AND r.restriction = 'PRIVACY') AS private_record,
                  EXISTS (SELECT 1 FROM restrictions r WHERE r.entity_id = p.id AND r.restriction = 'CONFIDENTIAL') AS confidential,
                  EXISTS (SELECT 1 FROM restrictions r WHERE r.entity_id = p.id AND r.restriction = 'LOCKED') AS locked,
                  COALESCE(p.display_reference, refn.value, p.id::text) AS display_id
           FROM persons p
           JOIN entities e ON e.id = p.id
           LEFT JOIN person_names pn ON pn.person_id = p.id AND pn.is_primary
           LEFT JOIN LATERAL (SELECT value FROM identifiers
             WHERE entity_id = p.id AND identifier_type = 'REFN' ORDER BY id LIMIT 1) refn ON true
           WHERE e.tree_id = $1`,
          [treeId],
        ),
        () => this.pool.query(
          `SELECT f.person_id, f.gedcom_tag, f.value_text, f.date_original,
                  p.name AS place_name, f.position
           FROM facts f
           JOIN entities e ON e.id = f.id
           LEFT JOIN places p ON p.id = f.place_id
           WHERE e.tree_id = $1 AND f.person_id IS NOT NULL
           ORDER BY f.person_id, f.position, f.id`,
          [treeId],
        ),
        () => this.pool.query(
          `SELECT n.person_id, n.text_value
           FROM notes n
           JOIN entities e ON e.id = n.id
           WHERE e.tree_id = $1 AND n.person_id IS NOT NULL
           ORDER BY n.position, n.id`,
          [treeId],
        ),
        () => this.pool.query(
          `SELECT fp.family_id, fp.person_id, fp.role, fp.position, fp.parent_slot
           FROM family_partners fp
           JOIN entities e ON e.id = fp.family_id
           WHERE e.tree_id = $1
           ORDER BY fp.family_id, fp.position`,
          [treeId],
        ),
        () => this.pool.query(
          `SELECT fc.family_id, fc.person_id, fc.pedigree,
                  fc.is_preferred, fc.position
           FROM family_children fc
           JOIN entities e ON e.id = fc.family_id
           WHERE e.tree_id = $1
           ORDER BY fc.family_id, fc.position`,
          [treeId],
        ),
        () => this.pool.query(`SELECT i.entity_id, i.value FROM identifiers i JOIN entities e ON e.id = i.entity_id
          WHERE e.tree_id = $1 AND e.entity_type = 'PERSON' AND i.identifier_type IN ('UID', 'REFN') ORDER BY i.value, i.entity_id`, [treeId]),
      ]);

    const idByUuid = new Map();
    const personByUuid = new Map();
    const family = {};
    for (const row of peopleResult.rows) {
      idByUuid.set(row.id, row.display_id);
      const person = {
        id: row.display_id,
        uuid: row.id,
        name: row.name || 'Unknown Person',
        ...(row.sex && { gender: row.sex }),
        ...(row.living_status !== 'UNKNOWN' && { livingStatus: row.living_status }),
        ...(row.is_public && { isPublic: true }),
        ...(row.private_record && { privateRecord: true }),
        ...(row.confidential && { confidential: true }),
        ...(row.locked && { locked: true }),
      };
      personByUuid.set(row.id, person);
      family[row.display_id] = person;
    }

    const projectedFacts = new Set();
    for (const fact of factsResult.rows) {
      const person = personByUuid.get(fact.person_id);
      if (!person) continue;
      const key = `${fact.person_id}:${fact.gedcom_tag}`;
      if (projectedFacts.has(key)) continue;
      projectedFacts.add(key);
      if (fact.gedcom_tag === 'BIRT') {
        if (fact.date_original) person.birth = fact.date_original;
        if (fact.place_name) person.birthplace = fact.place_name;
      } else if (fact.gedcom_tag === 'DEAT') {
        if (fact.date_original) person.death = fact.date_original;
      } else if (fact.gedcom_tag === 'OCCU') {
        person.occupation = fact.value_text;
      }
    }

    for (const note of notesResult.rows) {
      const person = personByUuid.get(note.person_id);
      if (person && person.bio === undefined) person.bio = note.text_value;
    }

    const membersByFamily = new Map();
    function familyMembers(familyId) {
      if (!membersByFamily.has(familyId)) {
        membersByFamily.set(familyId, { partners: [], children: [] });
      }
      return membersByFamily.get(familyId);
    }
    for (const partner of partnersResult.rows) {
      familyMembers(partner.family_id).partners.push(partner);
    }
    for (const child of childrenResult.rows) {
      familyMembers(child.family_id).children.push(child);
    }

    for (const members of membersByFamily.values()) {
      for (const partner of members.partners) {
        const person = personByUuid.get(partner.person_id);
        if (!person) continue;
        const spouseIds = members.partners
          .filter((candidate) => candidate.person_id !== partner.person_id)
          .map((candidate) => idByUuid.get(candidate.person_id))
          .filter(Boolean);
        if (spouseIds.length > 0) {
          person.spouseIds = [...new Set([...(person.spouseIds || []), ...spouseIds])];
        }
      }

      for (const child of members.children) {
        const person = personByUuid.get(child.person_id);
        if (!person) continue;
        const siblingIds = members.children
          .filter((candidate) => candidate.person_id !== child.person_id)
          .map((candidate) => idByUuid.get(candidate.person_id))
          .filter(Boolean);
        if (siblingIds.length > 0) {
          person.siblingIds = [
            ...new Set([...(person.siblingIds || []), ...siblingIds]),
          ];
        }

        if (!child.is_preferred) continue;
        // The wheel only models motherId/fatherId. Place partners with a
        // explicit display slot first, then a known role or sex, and let
        // remaining partners take an open slot,
        // including same-sex parents and parents of unknown/non-binary sex.
        const unplaced = [];
        const displayPartners = [...members.partners].sort((a, b) => Number(Boolean(b.parent_slot)) - Number(Boolean(a.parent_slot)));
        for (const partner of displayPartners) {
          const parentId = idByUuid.get(partner.person_id);
          const parent = personByUuid.get(partner.person_id);
          if (!parentId) continue;
          if (
            !person.motherId &&
            (partner.parent_slot === 'mother' || (!partner.parent_slot && (partner.role === 'WIFE' || (partner.role === 'PARTNER' && parent?.gender === 'F'))))
          ) {
            person.motherId = parentId;
          } else if (
            !person.fatherId &&
            (partner.parent_slot === 'father' || (!partner.parent_slot && (partner.role === 'HUSB' ||
              (partner.role === 'PARTNER' && parent?.gender === 'M'))))
          ) {
            person.fatherId = parentId;
          } else {
            unplaced.push(parentId);
          }
        }
        for (const parentId of unplaced) {
          if (person.motherId === parentId || person.fatherId === parentId) continue;
          if (!person.fatherId) person.fatherId = parentId;
          else if (!person.motherId) person.motherId = parentId;
        }
      }
    }

    const aliasCandidates = new Map();
    for (const row of aliasesResult.rows) {
      const canonical = idByUuid.get(row.entity_id);
      if (aliasCandidates.has(row.value) && aliasCandidates.get(row.value) !== canonical) aliasCandidates.set(row.value, null);
      else if (!aliasCandidates.has(row.value)) aliasCandidates.set(row.value, canonical);
    }
    return {
      treeId: tree.id,
      treeName: tree.name,
      revision: tree.revision,
      aliases: Object.fromEntries([...aliasCandidates].filter(([alias, canonical]) => canonical && alias !== canonical)),
      families: [...membersByFamily.entries()].map(([id, members]) => ({
        id,
        partners: members.partners.map((partner) => ({ personId: idByUuid.get(partner.person_id), role: partner.role, slot: partner.parent_slot })),
        children: members.children.map((child) => ({ personId: idByUuid.get(child.person_id), pedigree: child.pedigree, preferred: child.is_preferred })),
      })),
      rootId: idByUuid.get(tree.root_person_id) || tree.root_person_id,
      family,
    };
  }
}

module.exports = { TreeRepository };
