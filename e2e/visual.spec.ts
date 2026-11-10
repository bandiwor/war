import { expect, test, type Page } from '@playwright/test';

/**
 * Visual regression for the renderer and every bodycam shader. Frames are
 * rendered in frozen-time mode (?vt): fixed seed, fixed render time, no random
 * events, instant exposure, so output is reproducible on the same rasterizer.
 * Update baselines deliberately: npm run test:e2e -- --update-snapshots
 */
const BASE = '/?seed=1337&quality=medium&vt=12&ticks=1&scene=street';

const EFFECTS = [
  'autoExposure',
  'motionBlur',
  'bloom',
  'overexposure',
  'lensDistortion',
  'chromaticAberration',
  'lensDirt',
  'vignette',
  'rollingShutter',
  'shadowNoise',
  'grain',
  'compression',
  'signalLoss',
  'osd',
  'cameraShake',
] as const;

test.use({ viewport: { width: 640, height: 360 } });

async function frame(page: Page, query: string): Promise<Buffer> {
  await page.goto(`${BASE}&${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  return page.getByTestId('view').screenshot();
}

test.describe('scenes', () => {
  for (const [name, query] of [
    ['street-full-stack', 'fx=all&look=0.2,0'],
    ['wall-flashlight', 'fx=all&look=1.3,-0.15'],
    ['street-raw', 'fx=none&look=0.2,0'],
    ['whip-pan', 'fx=all&look=0.2,0&spin=3'],
    ['signal-loss-emi', 'fx=all&look=0.2,0&signal=0.9&stim=emi:0.7'],
    ['damage-fear', 'fx=all&look=0.2,0&stim=damage:0.8,fear:0.8'],
  ] as const) {
    test(name, async ({ page }) => {
      await frame(page, query);
      await expect(page.getByTestId('view')).toHaveScreenshot(`${name}.png`);
    });
  }
});

test.describe('each effect in isolation', () => {
  // The flashlight-on-wall view has blown highlights (overexposure, bloom) plus faked
  // motion and a forced signal event, so every effect has something to act on alone.
  const ISOLATION = 'look=1.3,-0.15&spin=2&signal=0.8';

  for (const id of EFFECTS) {
    test(id, async ({ page }) => {
      const without = await frame(page, `fx=none&${ISOLATION}`);
      const alone = await frame(page, `fx=${id}&${ISOLATION}`);
      expect(alone.equals(without), `${id} must change the image`).toBe(false);
      await expect(page.getByTestId('view')).toHaveScreenshot(`effect-${id}.png`);
    });
  }
});
