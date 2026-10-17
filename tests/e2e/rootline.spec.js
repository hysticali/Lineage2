// @ts-check
import { test, expect } from '@playwright/test';
import { addRelative } from '../helpers/workspace.cjs';


test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /The Lineage of/i })).toBeVisible();
});

test('fits the 1000-unit fan into the available chart viewport', async ({ page }) => {
  const wheel = page.locator('svg[viewBox="0 0 1000 1000"]');
  await expect(wheel).toBeVisible();

  await expect(wheel.locator('circle[r="428"]')).toHaveCount(1);
  await expect(wheel.locator('circle[r="486"]')).toHaveCount(0);

  const box = await wheel.boundingBox();
  expect(box?.width).toBeGreaterThan(350);
  expect(box?.width).toBeLessThanOrEqual(1000);

  const viewport = await page.locator('.chart-viewport').boundingBox();
  expect(box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.height).toBeLessThanOrEqual(viewport.height);

});

test('keeps the chart in 180 degree fan mode', async ({ page }) => {
  const wheel = page.locator('svg[viewBox="0 0 1000 1000"]');
  const wedgePaths = wheel.locator('path[fill^="hsl(248"], path[fill^="hsl(214"], path[fill^="hsl(188"], path[fill^="hsl(164"], path[fill^="hsl(118"], path[fill^="hsl(58"]');
  await expect(wedgePaths.first()).toBeVisible();

  const extent = await wedgePaths.evaluateAll((nodes) => {
    const boxes = nodes
      .filter((node) => !node.closest('g[opacity]'))
      .map((node) => node.getBBox());
    const minX = Math.min(...boxes.map((box) => box.x));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));
    return { minX, maxX, minY, maxY };
  });

  expect(extent.minX).toBeGreaterThanOrEqual(70);
  expect(extent.maxX).toBeLessThanOrEqual(930);
  expect(extent.minY).toBeGreaterThanOrEqual(70);
  expect(extent.maxY).toBeLessThanOrEqual(500);
});

test('selects a wedge and opens the person panel', async ({ page }) => {
  const wheel = page.locator('svg[viewBox="0 0 1000 1000"]');
  await wheel.locator('path[data-person-id="elena"]').click();

  await expect(page.getByRole('heading', { name: 'Elena Vasquez' })).toBeVisible();
  await expect(page.getByText('Concert Violinist')).toBeVisible();
  await expect(page.getByText('Click a person for details · Double-click to center', { exact: true })).toBeVisible();
});

test('keeps default first-row parents flush and evenly split', async ({ page }) => {
  const wheel = page.locator('svg[viewBox="0 0 1000 1000"]');

  const parentAngles = await wheel.evaluate((svg) => {
    const read = (id) => {
      const path = svg.querySelector(`path[data-generation="1"][data-person-id="${id}"]`);
      return {
        start: Number(path?.getAttribute('data-start-angle')),
        end: Number(path?.getAttribute('data-end-angle')),
      };
    };
    return {
      mother: read('elena'),
      father: read('marcus'),
    };
  });

  const motherWidth = parentAngles.mother.end - parentAngles.mother.start;
  const fatherWidth = parentAngles.father.end - parentAngles.father.start;
  const boundaryGap = parentAngles.father.start - parentAngles.mother.end;

  expect(boundaryGap).toBeCloseTo(0, 6);
  expect(motherWidth).toBeCloseTo(fatherWidth, 6);
});

test('keeps a gap between mother and father sibling fans on the first row', async ({ page }) => {
  const wheel = page.locator('svg[viewBox="0 0 1000 1000"]');
  await wheel.locator('path[data-person-id="marcus"]').click();
  await expect(page.getByRole('heading', { name: 'Marcus Hartwell' })).toBeVisible();

  const gap = await wheel.evaluate((svg) => {
    const endAngle = (id) =>
      Number(svg.querySelector(`path[data-generation="1"][data-person-id="${id}"]`)?.getAttribute('data-end-angle'));
    const startAngle = (id) =>
      Number(svg.querySelector(`path[data-generation="1"][data-person-id="${id}"]`)?.getAttribute('data-start-angle'));

    const motherEnd = endAngle('elena');
    const paternalStart = Math.min(startAngle('james'), startAngle('marcus'), startAngle('claire'));
    return paternalStart - motherEnd;
  });

  expect(gap).toBeGreaterThanOrEqual((7.5 * Math.PI) / 180);
});

test('persists added people and renders siblings whose parents are unknown', async ({ page, context }) => {
  await page.locator('path[data-person-id="miguel"]').click();
  await page.locator('path[data-person-id="rafael"]').click();
  await addRelative(page, 'Add Sibling');

  const dialog = page.getByRole('dialog', { name: 'Add Family Member' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Full Name *').fill('Test Sibling');
  await dialog.getByRole('button', { name: 'Add to Lineage' }).click();

  const addedWedge = page.locator('path[data-person-id^="p_"]');
  await expect(addedWedge).toHaveCount(1);
  await expect(page.locator('header').getByText('46 people')).toBeVisible();

  const restoredPage = await context.newPage();
  await restoredPage.goto('/');
  await expect(restoredPage.locator('header').getByText('46 people')).toBeVisible();
  const storedNames = await restoredPage.evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem('lineage-v3:static%3Afamily-data.json')).archive.family).map(
      (person) => person.name,
    ),
  );
  expect(storedNames).toContain('Test Sibling');
});

test('falls back to the configured root when saved navigation is stale', async ({ page, context }) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'lineage-v2',
      JSON.stringify({ centerId: 'missing-person', expanded: ['also-missing'] }),
    ),
  );

  const restoredPage = await context.newPage();
  await restoredPage.goto('/');
  await expect(
    restoredPage.getByRole('heading', { name: 'The Lineage of Aria Hartwell' }),
  ).toBeVisible();
  await expect(restoredPage.locator('svg[viewBox="0 0 1000 1000"]')).toBeVisible();
});

test('keeps the wheel first and uses a details sheet without horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const layout = await page.evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
    wheelWidth: document.querySelector('svg[viewBox="0 0 1000 1000"]').getBoundingClientRect().width }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.wheelWidth).toBeGreaterThan(300);
  await expect(page.locator('.app-sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select Aria Hartwell', exact: true }).click();
  await page.getByRole('button', { name: 'Person details', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Person details', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aria Hartwell', exact: true })).toBeVisible();
});

test('supports keyboard selection and recentering of chart people', async ({ page }) => {
  const elena = page.locator('g[aria-label^="Elena Vasquez"]');
  await elena.focus();
  await elena.press('Enter');
  await expect(page.getByRole('heading', { name: 'Elena Vasquez' })).toBeVisible();

  await elena.focus();
  await elena.press('r');
  await expect(
    page.getByRole('heading', { name: 'The Lineage of Elena Vasquez' }),
  ).toBeVisible();
});

test('exposes the add-person form as a dismissible modal dialog', async ({ page }) => {
  await page.locator('path[data-person-id="elena"]').click();
  await addRelative(page, 'Add Spouse');

  const dialog = page.getByRole('dialog', { name: 'Add Family Member' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Full Name *')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('links the spouse as the other parent when adding a child', async ({ page }) => {
  await page.getByRole('button', { name: 'Show descendants' }).click();
  await page.locator('[aria-label="Select Aria Hartwell"]').click();
  await addRelative(page, 'Add Child');

  const dialog = page.getByRole('dialog', { name: 'Add Family Member' });
  await dialog.getByLabel('Full Name *').fill('Test Child');
  await dialog.getByRole('button', { name: 'Add to Lineage' }).click();
  await expect(dialog).toBeHidden();

  const child = await page.evaluate(() =>
    Object.values(JSON.parse(localStorage.getItem('lineage-v3:static%3Afamily-data.json')).archive.family).find(
      (person) => person.name === 'Test Child',
    ),
  );
  expect(child.motherId).toBe('aria');
  expect(child.fatherId).toBe('dylan');
});

test('discards saved edits made against different source data', async ({ page, context }) => {
  await page.evaluate(() =>
    localStorage.setItem(
      'lineage-v2',
      JSON.stringify({
        version: 2,
        baseFingerprint: 'stale',
        family: { ghost: { id: 'ghost', name: 'Ghost Person' } },
        centerId: 'ghost',
      }),
    ),
  );

  const restoredPage = await context.newPage();
  await restoredPage.goto('/');
  await expect(
    restoredPage.getByRole('heading', { name: 'The Lineage of Aria Hartwell' }),
  ).toBeVisible();
  await expect(restoredPage.locator('header').getByText('45 people')).toBeVisible();
});

test('switches direction from the selected person and keeps their details open', async ({ page }) => {
  await page.locator('path[data-person-id="elena"]').click();
  await expect(page.getByRole('heading', { name: 'Elena Vasquez', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Show descendants' }).click();
  await expect(page.getByRole('heading', { name: 'Descendants of Elena Vasquez' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Elena Vasquez', exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="Select Elena Vasquez"]')).toBeVisible();

  await page.getByRole('button', { name: 'Aria Hartwell. Enter to select; R to center.', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Show ancestors' }).click();
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aria Hartwell', exact: true })).toBeVisible();
  await expect(page.locator('[aria-label="Select Aria Hartwell"]')).toBeVisible();

  // A second toggle keeps a selection that is already the center.
  await page.getByRole('button', { name: 'Show descendants' }).click();
  await expect(page.getByRole('heading', { name: 'Descendants of Aria Hartwell' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aria Hartwell', exact: true })).toBeVisible();
});
