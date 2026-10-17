function resolveNavigationPerson(family, aliases, id, fallback = null) {
  if (typeof id === 'string' && Object.hasOwn(family, id)) return id;
  const alias = typeof id === 'string' && Object.hasOwn(aliases || {}, id) ? aliases[id] : null;
  return typeof alias === 'string' && Object.hasOwn(family, alias) ? alias : fallback;
}
module.exports = { resolveNavigationPerson };
