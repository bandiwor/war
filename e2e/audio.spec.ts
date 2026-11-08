import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 3 in the browser: the AudioWorklet ambience runs, each zone drives a
 * different layer balance, the situation (danger) changes the mix, geometry
 * probes produce room acoustics, and distant events play.
 */
test.use({ viewport: { width: 480, height: 270 } });
test.setTimeout(180_000);

type AudioStats = NonNullable<ReturnType<NonNullable<Window['__warDebug']>['audioStats']>>;

async function boot(page: Page): Promise<void> {
  await page.goto('/?seed=1337&quality=low');
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 60_000 });
  await page.mouse.click(240, 135); // user gesture: unlock Web Audio
  await expect
    .poll(async () => (await audio(page))?.workletReady ?? false, { timeout: 30_000 })
    .toBe(true);
}

async function audio(page: Page): Promise<AudioStats | null> {
  return page.evaluate(() => window.__warDebug?.audioStats() ?? null);
}

/** Average layer levels over ~1.5 s after switching zone (the worklet smooths gains). */
async function zoneLevels(page: Page, zone: string): Promise<Partial<Record<string, number>>> {
  await page.evaluate((z) => window.__warDebug?.setZone(z), zone);
  await page.waitForTimeout(2500);
  const samples: Partial<Record<string, number>>[] = [];
  for (let i = 0; i < 6; i++) {
    samples.push((await audio(page))?.levels ?? {});
    await page.waitForTimeout(250);
  }
  const avg: Partial<Record<string, number>> = {};
  for (const s of samples)
    for (const [k, v] of Object.entries(s)) avg[k] = (avg[k] ?? 0) + (v ?? 0) / samples.length;
  return avg;
}

test('ambience worklet runs and the street reads as a semi-open canyon', async ({ page }) => {
  await boot(page);
  await expect
    .poll(async () => (await audio(page))?.levels['wind'] ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const s = await audio(page);
  expect(s?.zones['abandonedCity']).toBeGreaterThan(0.9);
  expect(s?.rt60).toBeGreaterThan(0.1);
  expect(s?.enclosure).toBeGreaterThan(0);
  expect(s?.enclosure).toBeLessThan(1);
});

test('zones sound different in the running game', async ({ page }) => {
  await boot(page);
  const forest = await zoneLevels(page, 'forest');
  const subway = await zoneLevels(page, 'subway');
  const industrial = await zoneLevels(page, 'industrial');
  expect(forest['insects'] ?? 0).toBeGreaterThan((subway['insects'] ?? 0) * 5);
  expect(subway['drips'] ?? 0).toBeGreaterThan(forest['drips'] ?? 0);
  expect(subway['rumble'] ?? 0).toBeGreaterThan(forest['rumble'] ?? 0);
  expect(industrial['hum'] ?? 0).toBeGreaterThan((forest['hum'] ?? 0) + 0.001);
});

test('danger brings in the heartbeat; distant events play', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    window.__warDebug?.setAudioOverride('danger', 1);
  });
  await expect
    .poll(async () => (await audio(page))?.levels['heartbeat'] ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0.001);
  await page.keyboard.press('Backquote');
  const menu = page.getByTestId('debug-menu');
  await menu.getByRole('button', { name: 'Audio' }).click();
  const before = (await audio(page))?.distantPlayed ?? 0;
  await menu.getByRole('button', { name: 'howl' }).click();
  await expect.poll(async () => (await audio(page))?.distantPlayed ?? 0).toBeGreaterThan(before);
  await expect(menu).toContainText('RT60');
});
