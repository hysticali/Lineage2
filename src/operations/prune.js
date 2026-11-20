function positiveInt(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function pruneDatabase(pool, options = {}) {
  const keepHistory = positiveInt(options.keepHistory ?? 100, 'keepHistory');
  const receiptDays = positiveInt(options.receiptDays ?? 30, 'receiptDays');
  const securityDays = positiveInt(options.securityDays ?? 365, 'securityDays');
  const apply = options.apply === true;

  const queries = [
    {
      key: 'tree_changes',
      sql: apply
        ? `DELETE FROM tree_changes WHERE id IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (PARTITION BY tree_id ORDER BY revision DESC, id DESC) AS rn
               FROM tree_changes
             ) ranked WHERE rn > $1
           )`
        : `SELECT COUNT(*)::integer AS count FROM (
             SELECT ROW_NUMBER() OVER (PARTITION BY tree_id ORDER BY revision DESC, id DESC) AS rn
             FROM tree_changes
           ) ranked WHERE rn > $1`,
      params: [keepHistory],
    },
    {
      key: 'mutation_receipts',
      sql: apply
        ? `DELETE FROM mutation_receipts WHERE created_at < current_timestamp - $1 * interval '1 day'`
        : `SELECT COUNT(*)::integer AS count FROM mutation_receipts WHERE created_at < current_timestamp - $1 * interval '1 day'`,
      params: [receiptDays],
    },
    {
      key: 'security_events',
      sql: apply
        ? `DELETE FROM security_events WHERE created_at < current_timestamp - $1 * interval '1 day'`
        : `SELECT COUNT(*)::integer AS count FROM security_events WHERE created_at < current_timestamp - $1 * interval '1 day'`,
      params: [securityDays],
    },
    {
      key: 'auth_sessions',
      sql: apply
        ? `DELETE FROM auth_sessions WHERE expires_at <= current_timestamp`
        : `SELECT COUNT(*)::integer AS count FROM auth_sessions WHERE expires_at <= current_timestamp`,
      params: [],
    },
    {
      key: 'auth_failures',
      sql: apply
        ? `DELETE FROM auth_failures WHERE window_start <= current_timestamp - interval '15 minutes'`
        : `SELECT COUNT(*)::integer AS count FROM auth_failures WHERE window_start <= current_timestamp - interval '15 minutes'`,
      params: [],
    },
  ];

  const client = await pool.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const counts = {};
    for (const item of queries) {
      const result = await client.query(item.sql, item.params);
      counts[item.key] = apply ? result.rowCount : result.rows[0].count;
    }
    await client.query('COMMIT');
    return { apply, keepHistory, receiptDays, securityDays, counts };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { pruneDatabase };

