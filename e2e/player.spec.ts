import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseReplay } from '../src/application/replay/replay';

/** Stage 2: first-person controller, footsteps with audio, collider overlay, replays. */
test.use({ viewport: { width: 480, height: 270 } });
test.setTimeout(180_000);

async function boot(page: Page, query = ''): Promise<void> {
  await page.goto(`/?seed=1337&quality=low&scene=street${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 60_000 });
}

const stats = (page: Page) => page.evaluate(() => window.__warDebug?.stats());

test('walking with the keyboard moves the player and plays footsteps', async ({ page }) => {
  await boot(page);
  // A user gesture unlocks Web Audio (autoplay policy).
  await page.mouse.click(240, 135);
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await stats(page))?.footsteps ?? 0, { timeout: 60_000 })
    .toBeGreaterThan(3);
  await page.keyboard.up('KeyW');
  const s = await stats(page);
  expect(s?.audioPlayed).toBeGreaterThan(0);
  expect(s?.replayTicks).toBeGreaterThan(30); // the black box is recording
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-menu')).toContainText('last surface asphalt');
});

test('physics collider overlay toggles', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.__warDebug?.setColliders(true);
  });
  await expect.poll(async () => (await stats(page))?.drawCalls ?? 0).toBeGreaterThan(0);
  const withLines = (await stats(page))?.drawCalls ?? 0;
  await page.evaluate(() => {
    window.__warDebug?.setColliders(false);
  });
  await expect.poll(async () => (await stats(page))?.drawCalls ?? 0).toBeLessThan(withLines);
});

test('a stored replay plays back deterministically in the browser (PLAY mode)', async ({
  page,
}) => {
  const replay = readFileSync(
    new URL('../tests/golden/replays/sandbox-route.replay.json', import.meta.url),
    'utf8',
  );
  await page.goto('/?quality=low');
  await page.evaluate((text) => {
    sessionStorage.setItem('war.replay', text);
  }, replay);
  await boot(page, '&replay=session');
  await page.keyboard.press('Backquote');
  const menu = page.getByTestId('debug-menu');
  await expect(menu).toContainText('playing 1260 ticks');
  // The route's footsteps happen without any keyboard input.
  await expect
    .poll(async () => (await stats(page))?.footsteps ?? 0, { timeout: 90_000 })
    .toBeGreaterThan(5);
  // Browser playback reaches the same state as the Node golden test at a checkpoint.
  const parsed = parseReplay(JSON.parse(replay));
  await page.evaluate(() => {
    window.__warDebug?.pauseAtTick(600);
  });
  await expect
    .poll(async () => Number(/tick\s+(\d+)/.exec((await menu.textContent()) ?? '')?.[1]), {
      timeout: 90_000,
    })
    .toBe(600);
  await expect(menu).toContainText(
    `hash   ${parsed.checkpoints.find((c) => c.t === 600)?.hash ?? 'missing'}`,
  );
});
