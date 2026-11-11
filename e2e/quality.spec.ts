import { expect, test } from '@playwright/test';

/**
 * Stage 10: automatic quality scaling in the browser. On a machine that
 * cannot hold 60 FPS at the requested preset, the governor lowers the
 * internal resolution (then gives up shadows and costly post passes) within
 * seconds; with ?auto=0 it leaves everything as asked. On a machine that
 * can, it keeps full quality. Either way the outcome matches the frame rate.
 */
test.use({ viewport: { width: 1280, height: 720 } });
test.setTimeout(240_000);

type Stats = ReturnType<NonNullable<Window['__warDebug']>['stats']>;

test('the governor trades resolution for frame rate, and only when it has to', async ({ page }) => {
  await page.goto('/?seed=1337&quality=high');
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 90_000 });
  await page.waitForTimeout(12_000);
  const s: Stats | undefined = await page.evaluate(() => window.__warDebug?.stats());
  if (s === undefined) throw new Error('no stats');
  if (s.fps < 50) {
    expect(s.autoScale).toBeLessThan(1);
  } else {
    expect(s.autoScale).toBe(1);
    expect(s.autoTier).toBe('full');
  }

  await page.goto('/?seed=1337&quality=high&auto=0');
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 90_000 });
  await page.waitForTimeout(6_000);
  const off = await page.evaluate(() => window.__warDebug?.stats());
  expect(off?.autoScale).toBe(1);
  expect(off?.autoTier).toBe('full');
});

test('the debug menu profiles every simulation system in the running game', async ({ page }) => {
  await page.goto('/?seed=1337&quality=low');
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 90_000 });
  await page.evaluate(() => {
    window.__warDebug?.profileSystems(true);
  });
  await page.waitForTimeout(3000);
  const t = await page.evaluate(() => window.__warDebug?.systemTimings() ?? []);
  expect(t.length).toBeGreaterThan(20);
  expect(t.map((x) => x.name)).toEqual(
    expect.arrayContaining(['physics.step', 'ai.perceive', 'story.step']),
  );
  const share = t.reduce((s, x) => s + x.share, 0);
  expect(share).toBeCloseTo(1, 3);
  for (let i = 1; i < t.length; i++)
    expect(t[i - 1]?.ms ?? 0).toBeGreaterThanOrEqual(t[i]?.ms ?? 0);
});
