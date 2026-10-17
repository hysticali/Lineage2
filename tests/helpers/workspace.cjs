async function openTools(page, group) {
  const drawer = page.getByRole('dialog', { name: 'Tree tools', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Tree tools', exact: true }).click();
  const category = drawer.getByRole('button', { name: group, exact: true });
  if (await category.getAttribute('aria-expanded') !== 'true') await category.click();
  return drawer;
}
async function closeTools(page) {
  const drawer = page.getByRole('dialog', { name: 'Tree tools', exact: true });
  if (await drawer.isVisible()) await drawer.getByRole('button', { name: 'Close Tree tools', exact: true }).click();
}
async function findPerson(page, query) {
  const drawer = page.getByRole('dialog', { name: 'Find a person', exact: true });
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Find person', exact: true }).click();
  await drawer.getByRole('searchbox', { name: 'Find a person', exact: true }).fill(query);
  return drawer;
}
async function personDetails(page) {
  const trigger = page.getByRole('button', { name: 'Person details', exact: true });
  if (await trigger.isVisible()) await trigger.click();
}
async function addRelative(page, name) {
  await personDetails(page);
  const menu = page.locator('.relative-actions');
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await menu.getByRole('button', { name, exact: true }).click();
}
async function openAccount(page) {
  const menu = page.locator('.account-menu');
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
}
module.exports = { openTools, closeTools, findPerson, personDetails, addRelative, openAccount };
