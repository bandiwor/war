import { expect, test, type Page } from '@playwright/test';

/** Phone controls: the on-screen stick, look pad and buttons drive the same input path. */
test.use({ viewport: { width: 640, height: 360 }, hasTouch: true });
test.setTimeout(180_000);

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?seed=1337&touch=1${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 60_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-touch', '1');
  await expect(page.getByTestId('touch-controls')).toBeVisible();
}

test('the stick walks the player (footsteps are heard and recorded)', async ({ page }) => {
  await boot(page, '');
  // Drag the stick upward and hold it: pointer events, as a thumb would send them.
  const stick = await page.getByTestId('touch-stick').boundingBox();
  if (stick === null) throw new Error('no stick');
  const sx = stick.x + 100;
  const sy = stick.y + stick.height - 90;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy - 70, { steps: 4 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__warDebug?.stats()))?.footsteps ?? 0, {
      timeout: 60_000,
    })
    .toBeGreaterThan(2);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__warDebug?.stats().replayTicks)).toBeGreaterThan(30);
});

test('tapping FIRE shoots and WPN cycles the weapon', async ({ page }) => {
  await boot(page, '&scene=range');
  await expect
    .poll(async () => page.evaluate(() => window.__warDebug?.weaponState().phase), {
      timeout: 60_000,
    })
    .toBe('ready');
  const first = await page.evaluate(() => window.__warDebug?.weaponState().id);
  await page.getByTestId('touch-fire').tap();
  await expect
    .poll(async () => (await page.evaluate(() => window.__warDebug?.combatLog()))?.shots ?? 0, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await page.getByTestId('touch-nextWeapon').tap();
  await expect
    .poll(async () => page.evaluate(() => window.__warDebug?.weaponState().id), {
      timeout: 30_000,
    })
    .not.toBe(first);
});

test('AIM is a toggle', async ({ page }) => {
  await boot(page, '&scene=range');
  const aim = page.getByTestId('touch-aim');
  await aim.tap();
  await expect(aim).toHaveClass(/\bon\b/);
  await aim.tap();
  await expect(aim).not.toHaveClass(/\bon\b/);
});
