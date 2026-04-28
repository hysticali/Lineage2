// @ts-check
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /The Lineage of/i })).toBeVisible();
});

test('renders the 1000px fan workspace with the requested geometry', async ({ page }) => {
  const wheel = page.locator('svg[viewBox="0 0 1000 1000"]');
  await expect(wheel).toBeVisible();

  await expect(wheel.locator('circle[r="428"]')).toHaveCount(1);
  await expect(wheel.locator('circle[r="486"]')).toHaveCount(0);

  const box = await wheel.boundingBox();
  expect(box?.width).toBeGreaterThan(700);
  expect(box?.width).toBeLessThanOrEqual(1000);

  const maxWidth = await wheel.evaluate((svg) => {
    const wrapper = svg.parentElement;
    if (!wrapper) return null;
    return getComputedStyle(wrapper).maxWidth;
  });
  expect(maxWidth).toBe('1000px');
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
  const elenaLabel = wheel.locator('tspan', { hasText: 'Elena' }).first();
  const labelBox = await elenaLabel.boundingBox();
  expect(labelBox).not.toBeNull();

  await page.mouse.click(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);

  await expect(page.getByRole('heading', { name: 'Elena Vasquez' })).toBeVisible();
  await expect(page.getByText('Concert Violinist')).toBeVisible();
  await expect(page.getByText(/Click any wedge to select and reveal siblings/i)).toBeVisible();
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
  const marcusLabel = wheel.locator('tspan', { hasText: 'Marcus' }).first();
  const labelBox = await marcusLabel.boundingBox();
  expect(labelBox).not.toBeNull();

  await page.mouse.click(labelBox.x + labelBox.width / 2, labelBox.y + labelBox.height / 2);
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
