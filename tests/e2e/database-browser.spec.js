import { test, expect } from '@playwright/test';
import { openTools, closeTools, findPerson, addRelative } from '../helpers/workspace.cjs';

test.describe.configure({ mode: 'serial' });

test('database additions and edits survive a fresh browser and tree switching', async ({ page, browser }) => {
  await page.goto('http://127.0.0.1:43174');
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  await page.getByRole('button', { name: 'Show descendants' }).click();
  await page.getByRole('button', { name: 'Select Aria Hartwell', exact: true }).click();
  await addRelative(page, 'Add Child');
  const dialog = page.getByRole('dialog', { name: 'Add Family Member' });
  const uniqueName = `Database Child ${Date.now()}`;
  await dialog.getByLabel('Full Name *').fill(uniqueName);
  await dialog.getByRole('combobox', { name: 'Gender', exact: true }).selectOption('X');
  await dialog.getByLabel('Birth date', { exact: true }).fill('ABT 2020');
  await dialog.getByRole('combobox', { name: 'Parentage', exact: true }).selectOption('ADOPTED');
  await dialog.getByRole('button', { name: 'Add to Lineage' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Archive status')).toContainText('Saved in database');
  await page.getByRole('button', { name: `${uniqueName}. Enter to select; R to center.`, exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Edit person', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Person' });
  await edit.getByLabel('Notes').fill('Persisted research note');
  await edit.getByRole('button', { name: 'Save person' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('Persisted research note', { exact: true })).toBeVisible();

  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto('http://127.0.0.1:43174');
  await expect(freshPage.locator('header')).toContainText('46 people');
  await freshPage.getByRole('button', { name: 'Show descendants' }).click();
  await freshPage.getByRole('button', { name: `${uniqueName}. Enter to select; R to center.`, exact: true }).press('Enter');
  await expect(freshPage.getByText('Persisted research note', { exact: true })).toBeVisible();
  await expect(freshPage.getByText('Non-binary', { exact: true })).toBeVisible();
  await freshPage.getByLabel('Tree', { exact: true }).selectOption({ label: 'Second family' });
  await expect(freshPage.locator('header')).toContainText('45 people');
  await fresh.close();
});

test('stale database tabs preserve forms and allow reviewed refresh before retry', async ({ page, context }) => {
  await page.goto('http://127.0.0.1:43174');
  const second = await context.newPage();
  await second.goto('http://127.0.0.1:43174');
  for (const tab of [page, second]) {
    await tab.getByRole('button', { name: 'Select Aria Hartwell', exact: true }).click();
    await tab.getByRole('button', { name: 'Edit person', exact: true }).click();
  }
  await page.getByRole('dialog').getByLabel('Notes').fill('Saved in the first tab');
  await page.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await second.getByRole('dialog').getByLabel('Notes').fill('Kept in the second tab');
  await second.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(second.getByRole('dialog').getByRole('alert')).toContainText('changed in another session');
  await expect(second.getByRole('dialog').getByLabel('Notes')).toHaveValue('Kept in the second tab');
  await second.getByRole('button', { name: 'Refresh tree, keep form' }).click();
  await expect(second.getByRole('dialog').getByLabel('Notes')).toHaveValue('Kept in the second tab');
  await second.getByRole('button', { name: 'Save person', exact: true }).click();
  await expect(second.getByRole('dialog')).toBeHidden();
  await expect(second.getByText('Kept in the second tab', { exact: true })).toBeVisible();
});

test('local restore can be previewed and migrated into the database', async ({ page }) => {
  await page.goto('http://127.0.0.1:43174');
  await expect(page.locator('header')).toBeVisible();
  const current = await (await page.request.get('http://127.0.0.1:43174/api/family-data')).json();
  const localId = `local_${Date.now()}`;
  current.family[localId] = { id: localId, name: 'Migrated browser person', motherId: 'aria' };
  const backup = { format: 'rootline-archive', version: 1, tree: { name: 'Local edits' }, archive: { rootId: current.rootId, family: current.family, families: current.families } };
  await openTools(page, 'Browser drafts');
  await page.getByLabel('Restore backup', { exact: true }).setInputFiles({ name: 'local.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await openTools(page, 'Browser drafts');
  await page.getByRole('button', { name: 'Migrate local edits to database' }).click();
  const dialog = page.getByRole('dialog', { name: 'Migration preview' });
  await expect(dialog).toContainText('1 new people');
  await expect(dialog).toContainText('Migrated browser person');
  await dialog.getByRole('button', { name: 'Confirm migration' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Archive status')).toContainText('Saved in database');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole('button', { name: 'Show descendants' }).click();
  await expect(page.getByRole('button', { name: 'Migrated browser person. Enter to select; R to center.', exact: true })).toBeVisible();
});

test('records editor saves separate events, notes, sources, and evidence across reload', async ({ page }) => {
  await page.goto('http://127.0.0.1:43174/?person=aria&selected=aria');
  await page.getByRole('button', { name: 'Records and evidence', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Records and evidence — Aria Hartwell' });
  await dialog.getByRole('button', { name: 'Add name', exact: true }).click();
  await dialog.getByLabel('Full name', { exact: true }).fill('Aria Research Alias');
  await dialog.getByLabel('Name type').fill('ALSO_KNOWN_AS');
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(dialog.getByText('Aria Research Alias', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add event or attribute' }).click();
  await dialog.getByLabel('Event tag').fill('BIRT');
  await dialog.getByLabel('Date expression').fill('BET 1989 AND 1991');
  await dialog.getByLabel('Place', { exact: true }).fill('Research Town');
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(dialog.getByText('BET 1989 AND 1991 · Research Town', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add source', exact: true }).click();
  await dialog.getByLabel('Source title').fill('Research register');
  await dialog.getByLabel('Author', { exact: true }).fill('Town clerk');
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await dialog.getByRole('button', { name: 'Add citation', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Source', exact: true }).selectOption({ label: 'Research register' });
  const eventOption = await dialog.getByRole('combobox', { name: 'Evidence for', exact: true }).locator('option').filter({ hasText: 'BET 1989 AND 1991 Research Town' }).getAttribute('value');
  await dialog.getByRole('combobox', { name: 'Evidence for', exact: true }).selectOption(eventOption);
  await dialog.getByLabel('Page or locator').fill('Page 12');
  await dialog.getByLabel('Evidence text').fill('Retain this conflicting assertion for review');
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(dialog.getByText('Retain this conflicting assertion for review', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add note', exact: true }).click();
  await dialog.getByLabel('Note text').fill('Compare both registers before choosing a date.');
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(dialog.getByText('Compare both registers before choosing a date.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add attachment', exact: true }).click();
  await dialog.getByLabel('Caption', { exact: true }).fill('Register transcription');
  await dialog.getByLabel('Provenance', { exact: true }).fill('Transcribed from archive copy');
  await dialog.getByLabel('Attachment file (maximum 10 MB)', { exact: true }).setInputFiles({ name: 'register.txt', mimeType: 'text/plain', buffer: Buffer.from('Original register transcription\n') });
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(dialog.getByText('Register transcription', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('link', { name: 'Download register.txt' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('register.txt');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toBe('Original register transcription\n');
  await dialog.getByRole('button', { name: 'Close Records and evidence — Aria Hartwell' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Records and evidence', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Aria Research Alias', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Compare both registers before choosing a date.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Retain this conflicting assertion for review', { exact: true })).toBeVisible();
  await expect(dialog.getByText('BET 1989 AND 1991 · Research Town', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Provenance: Transcribed from archive copy', { exact: true })).toBeVisible();
});

test('database backup preview and edit history recover records and attachments', async ({ page }) => {
  await page.goto('http://127.0.0.1:43174/?person=aria&selected=aria');
  const current = (await (await page.request.get('http://127.0.0.1:43174/api/family-data')).json()).family.aria;
  const downloadPromise = page.waitForEvent('download');
  await openTools(page, 'Backups and history');
  await page.getByRole('button', { name: 'Download full tree backup', exact: true }).click();
  const download = await downloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const backupBytes = Buffer.concat(chunks);
  const backup = JSON.parse(backupBytes.toString());
  expect(backup.format).toBe('rootline-tree');
  expect(backup.tables.media_blobs).toHaveLength(1);
  async function changeNote(value) {
    await closeTools(page);
    await page.getByRole('button', { name: 'Edit person', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Notes', exact: true }).fill(value);
    await page.getByRole('dialog').getByRole('button', { name: 'Save person', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  }
  await changeNote('Temporary note to recover through history');
  await openTools(page, 'Backups and history');
  await page.getByRole('button', { name: 'Edit history', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Preview recovery before revision/ }).first().click();
  let preview = page.getByRole('dialog', { name: 'Database restore preview' });
  await expect(preview).toContainText('1 stored attachments');
  await preview.getByRole('button', { name: 'Confirm database restore', exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByText(current.bio, { exact: true })).toBeVisible();
  await changeNote('Temporary note to recover from full backup');
  await openTools(page, 'Backups and history');
  await page.getByLabel('Restore full tree backup', { exact: true }).setInputFiles({ name: 'full-tree.json', mimeType: 'application/json', buffer: backupBytes });
  preview = page.getByRole('dialog', { name: 'Database restore preview' });
  await expect(preview).toContainText('Replace the database tree');
  await preview.getByRole('button', { name: 'Confirm database restore', exact: true }).click();
  await expect(preview).toBeHidden();
  await expect(page.getByText(current.bio, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Records and evidence', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Download register.txt' })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('Retain this conflicting assertion for review', { exact: true })).toBeVisible();
});

test('records editor preserves a stale form for refresh and reviewed retry', async ({ page }) => {
  await page.goto('http://127.0.0.1:43174/?person=aria&selected=aria');
  await page.getByRole('button', { name: 'Records and evidence', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add note', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Note text', exact: true }).fill('Keep this unsaved records form');
  const family = await (await page.request.get('http://127.0.0.1:43174/api/family-data')).json();
  const response = await page.request.post(`http://127.0.0.1:43174/api/trees/${family.treeId}/people/aria/records`, { data: {
    requestId: await page.evaluate(() => crypto.randomUUID()), expectedRevision: family.revision,
    kind: 'note', fields: { text_value: 'Changed in another session' },
  } });
  expect(response.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Save record', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('changed in another session');
  await expect(dialog.getByRole('textbox', { name: 'Note text', exact: true })).toHaveValue('Keep this unsaved records form');
  await dialog.getByRole('button', { name: 'Refresh records, keep form' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Note text', exact: true })).toHaveValue('Keep this unsaved records form');
  await dialog.getByRole('button', { name: 'Save record', exact: true }).click();
  await expect(dialog.getByText('Keep this unsaved records form', { exact: true })).toBeVisible();
});

test('database restore removes stale selection and history references to deleted people', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:43174');
  const family = await (await page.request.get('http://127.0.0.1:43174/api/family-data')).json();
  const backup = await (await page.request.get(`http://127.0.0.1:43174/api/trees/${family.treeId}/backup`)).body();
  await page.getByRole('button', { name: 'Add person', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Full Name *').fill('Temporary Recovery Person');
  await page.getByRole('dialog').getByRole('button', { name: 'Add to Lineage' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await findPerson(page, 'Temporary Recovery Person');
  await page.locator('.people-results button').click();
  await page.getByRole('button', { name: 'Show descendants' }).click();
  await findPerson(page, 'Aria Hartwell');
  await page.locator('.people-results button').click();
  await findPerson(page, 'Temporary Recovery Person');
  await page.locator('.people-results button').click();
  await openTools(page, 'Backups and history');
  await page.getByLabel('Restore full tree backup', { exact: true }).setInputFiles({ name: 'before-person.json', mimeType: 'application/json', buffer: backup });
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm database restore' }).click();
  await expect(page.getByRole('heading', { name: 'Descendants of Aria Hartwell' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Temporary Recovery Person', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Return to previous center person' }).press('Enter');
  await page.getByRole('button', { name: 'Return to previous center person' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  expect(errors).toEqual([]);
});
