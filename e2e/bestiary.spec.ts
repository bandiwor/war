import { expect, test, type Page } from '@playwright/test';
import { MOBS, MOB_IDS } from '../src/domain/mobs/registry';
import { WEAPON_IDS } from '../src/domain/weapons/registry';

/**
 * Stage 6 acceptance: every placeholder mob appears in the bestiary
 * automatically (the list comes from the registry: the test compares
 * against MOB_IDS, so adding a registry entry is all it takes), each can be
 * viewed on the test stage in every animation, spawned into the world, and
 * inspected while its AI runs.
 */
test.use({ viewport: { width: 960, height: 600 } });
test.setTimeout(240_000);

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?seed=1337&quality=low${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 90_000 });
}

test('every registry mob is in the bestiary and plays every animation on the test stage', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page, '&scene=street');
  await page.keyboard.press('Backquote');
  const menu = page.getByTestId('debug-menu');
  await menu.getByRole('button', { name: 'Bestiary', exact: true }).click();
  const listed = await page.evaluate(() => window.__warDebug?.bestiary());
  expect(listed?.mobs).toEqual([...MOB_IDS]);
  expect(listed?.weapons).toEqual([...WEAPON_IDS]);
  for (const id of MOB_IDS) await expect(menu.locator(`button[data-mob="${id}"]`)).toBeVisible();
  for (const id of MOB_IDS) {
    await menu.locator(`button[data-mob="${id}"]`).click();
    await expect(menu).toContainText(MOBS[id].label);
    // The test stage renders this mob…
    const before = (await page.evaluate(() => window.__warDebug?.previewState()))?.frames ?? 0;
    await expect
      .poll(async () => (await page.evaluate(() => window.__warDebug?.previewState()))?.frames ?? 0)
      .toBeGreaterThan(before + 1);
    expect((await page.evaluate(() => window.__warDebug?.previewState()))?.mob).toBe(id);
    // …and offers exactly its registry animations, each one playable.
    await expect(menu.locator('button[data-anim]')).toHaveCount(MOBS[id].animations.length);
    const played = await page.evaluate(
      ([mob, anims]) =>
        anims.map((a) => {
          window.__warDebug?.previewMob(mob, a);
          return window.__warDebug?.previewState()?.anim;
        }),
      [id, [...MOBS[id].animations]] as const,
    );
    expect(played).toEqual([...MOBS[id].animations]);
  }
  for (const label of ['bones', 'hitboxes', 'vision']) await menu.getByLabel(label).check();
  await expect(page.getByTestId('bestiary-stage')).toBeVisible();
  expect(errors).toEqual([]);
});

test('spawned mobs perceive, decide and act; the inspector shows their utility scores', async ({
  page,
}) => {
  await boot(page, '&scene=street');
  await page.evaluate(() => {
    window.__warDebug?.cheat('god', true);
    window.__warDebug?.setAiOverlay({ cones: true, paths: true, nav: true });
    window.__warDebug?.spawnMob('sentry', 7);
  });
  await expect
    .poll(() => page.evaluate(() => window.__warDebug?.mobCount() ?? 0), { timeout: 30_000 })
    .toBe(1);
  // The flashlight is on and the sentry faces us: it sees, then closes in.
  await expect
    .poll(async () => (await page.evaluate(() => window.__warDebug?.inspectNearest()))?.action, {
      timeout: 30_000,
    })
    .toMatch(/chase|attack/);
  const n = await page.evaluate(() => window.__warDebug?.inspectNearest());
  expect(n?.sensing).toBe(true);
  expect(Object.keys(n?.scores ?? {})).toEqual([
    'idle',
    'wander',
    'investigate',
    'chase',
    'attack',
    'search',
    'flee',
    'home',
  ]);
  await page.keyboard.press('Backquote');
  const menu = page.getByTestId('debug-menu');
  await menu.getByRole('button', { name: 'Bestiary', exact: true }).click();
  await expect(page.getByTestId('ai-inspector')).toContainText('nearest sentry');
  await expect(page.getByTestId('ai-inspector')).toContainText('GOD');
});

test('the open world populates itself with mobs', async ({ page }) => {
  await boot(page, '');
  await expect
    .poll(() => page.evaluate(() => window.__warDebug?.mobCount() ?? 0), { timeout: 60_000 })
    .toBeGreaterThan(2);
});
