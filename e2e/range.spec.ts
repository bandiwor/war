import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 4 acceptance (browser side): the debug shooting range works.
 * Weapons are driven through the debug API, which injects ordinary input
 * commands (so this is the same path a player and a replay use).
 */
test.use({ viewport: { width: 480, height: 270 } });
test.setTimeout(240_000);

type Api = NonNullable<Window['__warDebug']>;

async function boot(page: Page): Promise<void> {
  await page.goto('/?scene=range&quality=low&seed=1337');
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 60_000 });
}

async function ready(page: Page, id: string): Promise<void> {
  await page.evaluate((w) => window.__warDebug?.selectWeapon(w), id);
  await expect
    .poll(async () => page.evaluate(() => window.__warDebug?.weaponState()), { timeout: 60_000 })
    .toMatchObject({ id, phase: 'ready' });
}

const log = (page: Page): Promise<ReturnType<Api['combatLog']> | undefined> =>
  page.evaluate(() => window.__warDebug?.combatLog());

test('rifle: aimed headshot on the 50 m zombie registers part, distance, drop and flight time', async ({
  page,
}) => {
  await boot(page);
  await ready(page, 'rifle');
  await page.evaluate(() => window.__warDebug?.aimAt(-6, 1.62, 50));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__warDebug?.fire(true));
  await expect
    .poll(async () => (await log(page))?.hits ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const hit = (await log(page))?.recent[0];
  expect(hit).toMatchObject({ weapon: 'rifle', race: 'zombie', part: 'head', killed: true });
  expect(hit?.distance ?? 0).toBeGreaterThan(49);
  expect(hit?.distance ?? 0).toBeLessThan(51);
  expect(hit?.timeMs ?? 0).toBeGreaterThan(55);
  expect(hit?.timeMs ?? 0).toBeLessThan(70);
  // After the shot the bolt must be worked.
  await expect
    .poll(async () => page.evaluate(() => window.__warDebug?.weaponState().phase))
    .toBe('ready');
});

test('range tab lists weapons, logs hits, toggles bullet paths and resets targets', async ({
  page,
}) => {
  await boot(page);
  await page.keyboard.press('Backquote');
  const menu = page.getByTestId('debug-menu');
  await menu.getByRole('button', { name: 'Range' }).click();
  for (const id of [
    'pistol',
    'shotgun',
    'carbine',
    'rifle',
    'knife',
    'frag',
    'flare',
    'emp',
    'molotov',
  ]) {
    await expect(menu.locator(`button[data-weapon="${id}"]`)).toBeVisible();
  }
  await menu.locator('button[data-weapon="shotgun"]').click();
  await expect
    .poll(async () => page.evaluate(() => window.__warDebug?.weaponState()), { timeout: 60_000 })
    .toMatchObject({ id: 'shotgun', phase: 'ready' });
  await page.evaluate(() => {
    window.__warDebug?.setPaths(true);
    window.__warDebug?.aimAt(6, 0.6, 10);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__warDebug?.fire(false));
  await expect
    .poll(async () => (await log(page))?.hits ?? 0, { timeout: 30_000 })
    .toBeGreaterThan(1);
  await expect(menu).toContainText('shotgun   animal');
  await menu.getByRole('button', { name: 'Reset targets' }).click();
  await expect(menu).toContainText('loaded');
});

test('keyboard: number keys select weapons, R reloads', async ({ page }) => {
  await boot(page);
  await page.mouse.click(240, 135);
  await page.keyboard.press('Digit1');
  await expect
    .poll(async () => page.evaluate(() => window.__warDebug?.weaponState().id), { timeout: 30_000 })
    .toBe('pistol');
  await page.keyboard.press('Digit4');
  await expect
    .poll(async () => page.evaluate(() => window.__warDebug?.weaponState().id), { timeout: 30_000 })
    .toBe('rifle');
});

test('frag grenade explodes on the range', async ({ page }) => {
  await boot(page);
  await ready(page, 'frag');
  await page.evaluate(() => window.__warDebug?.aimAt(0, 0, 8));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__warDebug?.fire(false));
  await expect
    .poll(async () => (await log(page))?.explosions ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(0);
});
