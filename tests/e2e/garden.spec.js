import { test, expect } from '@playwright/test';

test.describe('Botanical Garden theme and view', () => {
  test('defaults to Atlas, toggles to Garden with URL & localStorage persistence, and returns cleanly to Atlas', async ({ page }) => {
    await page.goto('/');

    // Default load is Atlas: data-theme absent, no ?chart= in URL, .wheel-svg visible
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'garden');
    expect(new URL(page.url()).searchParams.has('chart')).toBe(false);
    await expect(page.locator('.wheel-svg')).toBeVisible();
    await expect(page.locator('.garden-svg')).toHaveCount(0);

    // Click Garden toggle
    const gardenBtn = page.getByRole('button', { name: 'Botanical Garden flower view' });
    const atlasBtn = page.getByRole('button', { name: 'Midnight Atlas wheel view' });
    await gardenBtn.click();

    await expect(gardenBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(atlasBtn).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'garden');
    expect(new URL(page.url()).searchParams.get('chart')).toBe('garden');
    expect(await page.evaluate(() => localStorage.getItem('rootline:chart-view'))).toBe('garden');

    // Renders .garden-svg with golden stamen hub, curved stems, Gen 1+2 petals, and companion spouse leaf-bloom
    await expect(page.locator('.garden-svg')).toBeVisible();
    await expect(page.locator('.garden-hub')).toHaveAttribute('data-center-person-id', 'aria');
    await expect(page.locator('.garden-hub')).toContainText('Aria');
    expect(await page.locator('.garden-stem').count()).toBeGreaterThanOrEqual(2);
    expect(await page.locator('.garden-petal[data-generation="1"]').count()).toBe(2);
    expect(await page.locator('.garden-petal[data-generation="2"]').count()).toBe(4);
    await expect(page.locator('.garden-spouse[data-person-id="dylan"]')).toBeVisible();
    await expect(page.locator('.garden-spouse[data-person-id="dylan"]')).toContainText('Dylan');

    // Reload preserves Garden via URL & localStorage
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'garden');
    await expect(page.locator('.garden-svg')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('chart')).toBe('garden');

    // Navigating to bare '/' also persists Garden from localStorage
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'garden');
    await expect(page.locator('.garden-svg')).toBeVisible();

    // Switch back to Atlas
    await atlasBtn.click();
    await expect(atlasBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'garden');
    expect(new URL(page.url()).searchParams.has('chart')).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem('rootline:chart-view'))).toBe('atlas');
    await expect(page.locator('.wheel-svg')).toBeVisible();
    await expect(page.locator('.garden-svg')).toHaveCount(0);
  });

  test('selecting petals opens PersonCard, sprouts deeper blooms, recenters via R or double-click, and toggles Descendants', async ({ page }) => {
    await page.goto('/?chart=garden');
    await expect(page.locator('.garden-svg')).toBeVisible();

    // Select a Gen 2 petal to open PersonCard and sprout Gen 3 bloom
    const initialGen3 = await page.locator('.garden-petal[data-generation="3"]').count();
    expect(initialGen3).toBe(0);

    const luciaPetal = page.locator('.garden-petal[data-person-id="lucia"]').first();
    await luciaPetal.click();
    await expect(page.getByRole('heading', { name: 'Lucia Moreno', exact: true })).toBeVisible();
    // Clicking Lucia expands her deeper branch (Gen 3 petals sprout)
    await expect.poll(() => page.locator('.garden-petal[data-generation="3"]').count()).toBeGreaterThan(0);

    // Selecting a Gen 1 petal (Elena Vasquez) opens PersonCard and expands her siblings if present
    const elenaPetal = page.locator('.garden-petal[data-person-id="elena"]').first();
    await elenaPetal.click();
    await expect(page.getByRole('heading', { name: 'Elena Vasquez', exact: true })).toBeVisible();

    // Pressing R on focused petal recenters the garden on Elena Vasquez
    await elenaPetal.focus();
    await elenaPetal.press('r');
    await expect(page.locator('.garden-hub')).toHaveAttribute('data-center-person-id', 'elena');
    await expect(page.getByRole('heading', { name: 'The Lineage of Elena Vasquez' })).toBeVisible();

    // Switch Ancestors -> Descendants renders children petals & descendant blooms
    await page.getByRole('button', { name: 'Show descendants' }).click();
    await expect(page.getByRole('heading', { name: 'Descendants of Elena Vasquez' })).toBeVisible();
    await expect(page.locator('.wheel-direction-badge')).toHaveText('Descendant garden');
    expect(await page.locator('.garden-petal[data-person-id="aria"]').count()).toBeGreaterThan(0);

    // Double-clicking a descendant petal recenters on that person
    await page.locator('.garden-petal[data-person-id="aria"]').first().dblclick();
    await expect(page.locator('.garden-hub')).toHaveAttribute('data-center-person-id', 'aria');

    // Switch back to Ancestors
    await page.getByRole('button', { name: 'Show ancestors' }).click();
    await expect(page.getByRole('heading', { name: 'The Lineage of Aria Hartwell' })).toBeVisible();
  });

  test('starting a new 1-person tree in Garden mode shows green + Mother and + Father buds and allows adding a parent', async ({ page }) => {
    await page.goto('/?chart=garden');
    await expect(page.locator('.garden-svg')).toBeVisible();

    await page.getByRole('button', { name: 'Start your own tree' }).click();
    await page.getByLabel(/Starting person/i).fill('Sage Lindholm');
    await page.getByRole('button', { name: 'Create new tree' }).click();

    await expect(page.locator('.garden-hub')).toContainText('Sage');
    const motherBud = page.locator('.garden-bud[data-slot="mother"]');
    const fatherBud = page.locator('.garden-bud[data-slot="father"]');
    await expect(motherBud).toBeVisible();
    await expect(fatherBud).toBeVisible();

    // Click the + Mother bud to open Add Family Member modal and add a mother
    await motherBud.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Full name').fill('Astrid Lindholm');
    await page.getByRole('button', { name: 'Add to Lineage' }).click();

    // Mother petal now appears in the garden and Gen 1 + Mother bud is replaced
    await expect(page.locator('.garden-petal[data-generation="1"]', { hasText: 'Astrid' })).toBeVisible();
    await expect(page.locator('.garden-bud[data-generation="1"][data-slot="mother"]')).toHaveCount(0);
    await expect(page.locator('.garden-bud[data-generation="1"][data-slot="father"]')).toBeVisible();
  });

  test('keyboard Tab shows tooltip, mouse click selects cleanly, reduced motion disables animations, and 200% zoom has 0px overflow', async ({ page }) => {
    await page.goto('/?chart=garden');
    await expect(page.locator('.garden-svg')).toBeVisible();

    // Focus a petal via keyboard (focus/Tab) and verify .wheel-tooltip appears
    const elenaPetal = page.locator('.garden-petal[data-person-id="elena"]').first();
    await elenaPetal.focus();
    await expect(page.locator('.wheel-tooltip')).toBeVisible();
    await expect(page.locator('.wheel-tooltip')).toContainText('Elena Vasquez');

    // Mouse click still selects cleanly
    const marcusPetal = page.locator('.garden-petal[data-person-id="marcus"]').first();
    await marcusPetal.click();
    await expect(page.getByRole('heading', { name: 'Marcus Hartwell', exact: true })).toBeVisible();

    // prefers-reduced-motion: reduce disables animations
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const petalAnim = await page.locator('.garden-petal-shape').first().evaluate((el) => getComputedStyle(el).animationName);
    const stemAnim = await page.locator('.garden-stem').first().evaluate((el) => getComputedStyle(el).animationName);
    expect(petalAnim).toBe('none');
    expect(stemAnim).toBe('none');

    // 200% text zoom (html { font-size: 32px }) scales cleanly with 0px horizontal overflow
    await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
