import { test, expect } from '@playwright/test';
import { openTools } from '../helpers/workspace.cjs';

import fs from 'node:fs/promises';
import familyData from '../../family-data.json';

const key = 'lineage-v3:static%3Afamily-data.json';
const backupFor = (archive) => ({ format: 'rootline-archive', version: 1, tree: { id: 'test', name: 'Test archive' }, archive });
const upload = async (page, value) => {
  await openTools(page, 'Browser drafts');
  await page.getByLabel('Restore backup', { exact: true }).setInputFiles({
  name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  });
};

test('backup, restore, reset, and recovery preserve complete family records', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  const archive = structuredClone(familyData);
  archive.family.newperson = { id: 'newperson', name: 'Backup Person', motherId: 'aria', birth: 'ABT 2020', research: { note: 'Keep extension data' } };
  archive.rootId = 'newperson';
  await upload(page, backupFor(archive));
  const preview = page.getByRole('dialog', { name: 'Restore preview' });
  await expect(preview).toContainText('46 people');
  await expect(page.locator('header')).toContainText('45 people');
  await preview.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.getByRole('heading', { name: 'The Lineage of Backup Person' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.locator('header')).toContainText('46 people');

  const downloadPromise = page.waitForEvent('download');
  await openTools(page, 'Browser drafts');
  await page.getByRole('button', { name: 'Download backup', exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(exported.archive).toEqual(archive);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('header')).toContainText('45 people');
  await upload(page, exported);
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.locator('header')).toContainText('46 people');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The Lineage of Backup Person' })).toBeVisible();

  await openTools(page, 'Browser drafts');
  await page.getByRole('button', { name: 'Discard local edits', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('header')).toContainText('46 people');
  await openTools(page, 'Browser drafts');
  await page.getByRole('button', { name: 'Discard local edits', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm discard' }).click();
  await expect(page.locator('header')).toContainText('45 people');
  await openTools(page, 'Browser drafts');
  await page.getByRole('button', { name: /Recovery copies/ }).click();
  const entry = page.locator('.recovery-entry').filter({ hasText: 'Before discarding local edits' });
  await entry.getByRole('button', { name: 'Preview copy' }).click();
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.locator('header')).toContainText('46 people');
});

test('invalid restore leaves the active archive untouched', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header')).toContainText('45 people');
  const invalid = structuredClone(familyData);
  invalid.family.aria.motherId = 'missing';
  await upload(page, backupFor(invalid));
  await expect(page.getByRole('alert')).toContainText('Missing relative');
  await expect(page.getByRole('dialog', { name: 'Restore preview', exact: true })).toHaveCount(0);
  await expect(page.locator('header')).toContainText('45 people');
});

test('source changes preserve local edits as a downloadable recovery copy', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header')).toContainText('45 people');
  const added = structuredClone(familyData);
  added.family.local = { id: 'local', name: 'Local Addition' };
  await upload(page, backupFor(added));
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.locator('header')).toContainText('46 people');
  const changed = structuredClone(familyData);
  changed.family.aria.name = 'Updated Aria';
  await page.route('**/family-data.json', (route) => route.fulfill({ json: changed }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The Lineage of Updated Aria' })).toBeVisible();
  await expect(page.getByText('Your previous edits are preserved', { exact: false })).toBeVisible();
  await openTools(page, 'Browser drafts');
  await page.getByRole('button', { name: /Recovery copies/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.recovery-entry').filter({ hasText: 'Source archive changed' }).getByRole('button', { name: 'Download copy' }).click();
  const download = await downloadPromise;
  const recovered = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(recovered.archive.family.local.name).toBe('Local Addition');
});

test('reordered source keys do not discard saved additions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header')).toContainText('45 people');
  const added = structuredClone(familyData);
  added.family.local = { id: 'local', name: 'Local Addition' };
  await upload(page, backupFor(added));
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.locator('header')).toContainText('46 people');
  await page.route('**/family-data.json', (route) => route.fulfill({ json: { ...familyData, family: Object.fromEntries(Object.entries(familyData.family).reverse()) } }));
  await page.reload();
  await expect(page.locator('header')).toContainText('46 people');
});

test('database errors show retry instead of silently loading the sample archive', async ({ page }) => {
  let sampleRequests = 0;
  await page.route('**/family-data.json', (route) => { sampleRequests++; return route.fulfill({ json: familyData }); });
  await page.route('**/api/family-data', (route) => route.fulfill({ status: 503, json: { error: 'Database unavailable' } }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Database archive is unavailable');
  expect(sampleRequests).toBe(0);
  await page.route('**/api/family-data', (route) => route.fulfill({ json: { ...familyData, treeId: 'one', treeName: 'Database family' } }));
  await page.getByRole('button', { name: 'Retry loading archive' }).click();
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  await expect(page.getByLabel('Archive status')).toContainText('Local database');
  expect(sampleRequests).toBe(0);
});

test('tree identities isolate local saves', async ({ page }) => {
  await page.route('**/api/family-data', (route) => route.fulfill({ json: { ...familyData, treeId: 'one' } }));
  await page.route('**/api/trees/one/family-data', (route) => route.fulfill({ json: { ...familyData, treeId: 'one' } }));
  await page.goto('/');
  await expect(page.locator('header')).toContainText('45 people');
  const added = structuredClone(familyData);
  added.family.local = { id: 'local', name: 'Only in tree one' };
  await upload(page, backupFor(added));
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.locator('header')).toContainText('46 people');
  await page.route('**/api/family-data', (route) => route.fulfill({ json: { ...familyData, treeId: 'two' } }));
  await page.reload();
  await expect(page.locator('header')).toContainText('46 people');
  // Reload preserves the URL's tree even if the default tree has changed.
  await page.goto('/');
  await expect(page.locator('header')).toContainText('45 people');
  const savedCount = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lineage-v3:one')).archive.family).length);
  expect(savedCount).toBe(46);
});

test('storage failures are visible and block destructive restores', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await expect(page.getByLabel('Archive status')).toContainText('Not saved');
  await page.getByRole('button', { name: 'Back up now', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Tree tools', exact: true }).getByRole('button', { name: 'Download backup', exact: true })).toBeVisible();
  await upload(page, backupFor(familyData));
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Could not save a recovery copy');
  await expect(page.locator('header')).toContainText('45 people');
});
