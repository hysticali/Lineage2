import { test, expect } from '@playwright/test';
import { findPerson } from '../helpers/workspace.cjs';


test('search, direction changes, refresh, and browser history preserve the selected person', async ({ page }) => {
  await page.goto('/');
  await findPerson(page, 'Elena');
  await page.locator('.people-results button').click();
  const center = page.locator('[data-center-person-id]');
  await expect(center).toHaveAttribute('data-center-person-id', 'elena');
  await expect(center).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Elena Vasquez', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show descendants' }).click();
  await expect(page).toHaveURL(/person=elena.*view=descendants.*selected=elena/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Descendants of Elena Vasquez' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elena Vasquez', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show ancestors' }).click();
  await expect(center).toHaveAttribute('data-center-person-id', 'elena');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Descendants of Elena Vasquez' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'The Lineage of Elena Vasquez' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Descendants of Elena Vasquez' })).toBeVisible();
  await expect(center).toBeFocused();
});

test('people list paginates a large archive and reports empty search and branches', async ({ page }) => {
  const family = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`p${i}`, { id: `p${i}`, name: `Person ${String(i).padStart(4, '0')}`, birth: '1901', birthplace: 'Paris' }]));
  await page.route('**/family-data.json', route => route.fulfill({ json: { rootId: 'p0', family } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Find person', exact: true }).click();
  await page.getByRole('button', { name: 'Browse people' }).click();
  await expect(page.locator('.people-results button')).toHaveCount(25);
  await page.getByRole('button', { name: 'Next people' }).click();
  await expect(page.locator('.people-results button').first()).toContainText('Person 0025');
  await findPerson(page, '0999 Paris 1901');
  await expect(page.locator('.people-results button')).toHaveCount(1);
  await page.locator('.people-results button').click();
  await expect(page.locator('[data-center-person-id]')).toHaveAttribute('data-center-person-id', 'p999');
  await expect(page.getByText('No ancestors recorded for Person 0999. Select this person to add relatives.')).toBeVisible();
  await page.getByRole('button', { name: 'Show descendants' }).click();
  await expect(page.getByText('No descendants recorded for Person 0999. Select this person to add relatives.')).toBeVisible();
  await findPerson(page, 'absent');
  await expect(page.getByText('No people match. Try another name, date, or place.')).toBeVisible();
});

test('mobile zoom stays inside the chart and Fit restores its size', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?person=elena&selected=elena&view=descendants');
  const svg = page.locator('svg[viewBox="0 0 1000 1000"]');
  const original = await svg.boundingBox();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByLabel('Zoom level')).toHaveText('150%');
  expect((await svg.boundingBox()).width).toBeGreaterThan(original.width * 1.4);
  const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth, content: document.querySelector('.chart-stage').getBoundingClientRect().width, chart: document.querySelector('.chart-viewport').clientWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.content).toBeGreaterThan(widths.chart);
  await page.getByRole('button', { name: 'Fit chart' }).click();
  await expect(page.getByLabel('Zoom level')).toHaveText('100%');
  expect((await svg.boundingBox()).width).toBeCloseTo(original.width, 0);
});

test('invalid navigation identifiers fall back safely', async ({ page }) => {
  for (const id of ['missing', 'constructor', '__proto__']) {
    await page.goto(`/?person=${id}&selected=${id}&view=invalid`);
    await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
    await expect(page).toHaveURL(/person=aria.*view=ancestors/);
    expect(new URL(page.url()).searchParams.has('selected')).toBe(false);
  }
});

test('chart Back restores center, direction, selection, and focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Elena Vasquez. Enter to select; R to center.', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Show descendants' }).click();
  await expect(page.getByRole('heading', { name: 'Descendants of Elena Vasquez' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to previous center person' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elena Vasquez', exact: true })).toBeVisible();
  await expect(page.locator('[data-center-person-id]')).toBeFocused();
  await expect(page).toHaveURL(/person=aria.*view=ancestors.*selected=elena/);
});

test('database direct links and browser history retain the correct tree', async ({ page }) => {
  await page.goto('http://127.0.0.1:43174');
  const selector = page.getByLabel('Tree', { exact: true });
  await expect(selector.locator('option').filter({ hasText: 'Second family' })).toHaveCount(1);
  const firstTree = await selector.inputValue();
  await findPerson(page, 'Elena');
  await page.locator('.people-results button').click();
  await page.getByRole('button', { name: 'Show descendants' }).click();
  const directLink = page.url();
  await selector.selectOption({ label: 'Second family' });
  await expect(selector).not.toHaveValue(firstTree);
  await page.goBack();
  await expect(selector).toHaveValue(firstTree);
  await expect(page.getByRole('heading', { name: 'Descendants of Elena Vasquez' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elena Vasquez', exact: true })).toBeVisible();
  await page.goto(directLink);
  await expect(selector).toHaveValue(firstTree);
  await expect(page.getByRole('heading', { name: 'Descendants of Elena Vasquez' })).toBeVisible();
});
