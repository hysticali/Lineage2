import { test, expect } from '@playwright/test';
import { openTools, findPerson, addRelative } from '../helpers/workspace.cjs';

async function geometry(page) {
  return page.locator('.chart-viewport').evaluate(viewport => {
    const svg = viewport.querySelector('svg'), matrix = svg.getScreenCTM(), box = viewport.getBoundingClientRect();
    const hub = new DOMPoint(500, 500).matrixTransform(matrix);
    const world = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(matrix.inverse());
    return { hub: { x: hub.x, y: hub.y }, world: { x: world.x, y: world.y }, viewport: { x: box.x, y: box.y, width: box.width, height: box.height }, documentHeight: document.documentElement.scrollHeight, documentWidth: document.documentElement.scrollWidth, scrollY };
  });
}
function closePoint(actual, expected, tolerance = 1) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThan(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThan(tolerance);
}

for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 375, height: 812 }]]) {
  test(`${device} zoom anchors the hub at every level without growing the page`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/?person=elena&selected=elena');
    await expect(page.getByRole('heading', { name: 'The Lineage of Elena Vasquez' })).toBeVisible();
    const initial = await geometry(page);
    for (let percent = 125; percent <= 300; percent += 25) {
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await expect(page.getByLabel('Zoom level')).toHaveText(`${percent}%`);
      const current = await geometry(page);
      closePoint(current.hub, initial.hub);
      expect(current.viewport).toEqual(initial.viewport);
      expect(current.documentHeight).toBe(initial.documentHeight);
      expect(current.documentWidth).toBeLessThanOrEqual(viewport.width);
    }
    await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Show descendants' }).click();
    closePoint((await geometry(page)).hub, initial.hub);
    expect(new URL(page.url()).searchParams.get('selected')).toBe('elena');
    await page.getByRole('button', { name: 'Fit chart' }).click();
    await expect(page.getByLabel('Zoom level')).toHaveText('100%');
    closePoint((await geometry(page)).hub, initial.hub);
    await page.screenshot({ path: `/tmp/lineage-workspace-${device}.png`, fullPage: true });
  });
}

test('pan preserves the viewed world point through zoom and resize; Center and Fit have distinct effects', async ({ page }) => {
  await page.goto('/?selected=elena');
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const before = await geometry(page);
  await page.mouse.move(before.hub.x, before.hub.y);
  await page.mouse.down(); await page.mouse.move(before.hub.x + 80, before.hub.y + 45, { steps: 8 }); await page.mouse.up();
  const panned = await geometry(page);
  expect(panned.hub.x).toBeGreaterThan(before.hub.x + 60);
  expect(new URL(page.url()).searchParams.get('selected')).toBe('elena');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  closePoint((await geometry(page)).world, panned.world, .1);
  await page.setViewportSize({ width: 1550, height: 950 });
  await expect.poll(async () => (await geometry(page)).viewport.width).not.toBe(panned.viewport.width);
  closePoint((await geometry(page)).world, panned.world, .1);
  await page.getByRole('button', { name: 'Center wheel', exact: true }).click();
  await expect(page.getByLabel('Zoom level')).toHaveText('225%');
  closePoint((await geometry(page)).world, { x: 500, y: 500 }, .1);
  const viewport = page.getByRole('region', { name: 'Family wheel', exact: true });
  await viewport.focus(); await viewport.press('ArrowRight');
  expect((await geometry(page)).world.x).toBeGreaterThan(500);
  await viewport.press('Home');
  closePoint((await geometry(page)).world, { x: 500, y: 500 }, .1);
  await page.getByRole('button', { name: 'Fit chart' }).click();
  await expect(page.getByLabel('Zoom level')).toHaveText('100%');
  closePoint((await geometry(page)).world, { x: 500, y: 500 }, .1);
  expect(new URL(page.url()).searchParams.get('selected')).toBe('elena');
});

test('tools and nested recovery dialogs keep wheel geometry stable and trap focus only in the active layer', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download backup', exact: true })).toHaveCount(0);
  const initial = await geometry(page);
  const drawer = await openTools(page, 'Browser drafts');
  expect((await geometry(page)).viewport).toEqual(initial.viewport);
  expect((await geometry(page)).scrollY).toBe(initial.scrollY);
  await drawer.getByRole('button', { name: 'Discard local edits', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Discard local edits', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(confirmation.getByRole('button', { name: 'Close Discard local edits', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirmation.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await confirmation.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden(); await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Discard local edits', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Tree tools', exact: true })).toBeFocused();
  expect(await page.locator('#root').evaluate(element => element.inert)).toBe(false);
  expect((await geometry(page)).viewport).toEqual(initial.viewport);
});

test('search is an overlay, keyboard shortcuts respect inputs, and choosing a result returns chart focus', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  const initial = await geometry(page);
  await page.keyboard.press('/');
  const drawer = page.getByRole('dialog', { name: 'Find a person', exact: true });
  const input = drawer.getByRole('searchbox', { name: 'Find a person', exact: true });
  await expect(input).toBeFocused();
  expect((await geometry(page)).viewport).toEqual(initial.viewport);
  await input.fill('Elena');
  await drawer.locator('.people-results button').click();
  await expect(drawer).toBeHidden();
  await expect(page.locator('[data-center-person-id="elena"]')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Elena Vasquez', exact: true })).toBeVisible();
  await findPerson(page, '/');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Find person', exact: true })).toBeFocused();
});

test('mobile details and relative editing use sheets without a top toolbar stack', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  const initial = await geometry(page);
  expect(initial.viewport.y).toBeLessThan(275);
  await page.getByRole('button', { name: 'Select Aria Hartwell', exact: true }).click();
  await addRelative(page, 'Add Spouse');
  const form = page.getByRole('dialog', { name: 'Add Family Member', exact: true });
  await expect(form.getByLabel('Full Name *')).toBeFocused();
  await form.getByLabel('Full Name *').fill('Mobile relative draft');
  await page.keyboard.press('Escape');
  await expect(form).toBeHidden();
  closePoint((await geometry(page)).hub, initial.hub);
  await expect(page.getByRole('button', { name: 'Person details', exact: true })).toBeFocused();
  for (const name of ['Zoom in', 'Zoom out', 'Center wheel', 'Fit chart']) {
    expect((await page.getByRole('button', { name, exact: true }).boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  expect((await geometry(page)).documentWidth).toBeLessThanOrEqual(375);
});

test('touch panning stays inside the zoomed wheel', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage(); await page.goto('http://127.0.0.1:4173');
    await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).tap();
    const initial = await geometry(page), client = await context.newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: initial.hub.x, y: initial.hub.y }] });
    // Deliver a real drag across frames; an instantaneous synthetic swipe can
    // make Chromium classify the following tap as part of the same gesture.
    for (let step = 1; step <= 8; step++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: initial.hub.x + 45 * step / 8, y: initial.hub.y + 25 * step / 8 }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await geometry(page)).hub.x).toBeGreaterThan(initial.hub.x + 30);
    expect((await geometry(page)).scrollY).toBe(initial.scrollY);
    await page.getByRole('button', { name: 'Center wheel', exact: true }).tap();
    await expect.poll(async () => (await geometry(page)).world.x).toBeCloseTo(500, 1);
    closePoint((await geometry(page)).hub, initial.hub);
  } finally { await context.close(); }
});
