import { expect, test, type Page } from '@playwright/test';

/**
 * Stage 8 acceptance in the browser: the campaign starts with Overwatch on
 * the radio (subtitled), things in the world can be used ([E]), what you
 * find goes in the journal (J), saves survive a reload with F5/F9, and a
 * choice at the Institute shows its ending.
 */
test.use({ viewport: { width: 960, height: 600 } });
test.setTimeout(300_000);

async function boot(page: Page, query = ''): Promise<void> {
  await page.goto(`/?seed=1337&quality=low${query}`);
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 90_000 });
}

const state = (page: Page) => page.evaluate(() => window.__warDebug?.storyState() ?? null);

async function visit(page: Page, id: string, press = true): Promise<void> {
  await page.evaluate((x) => window.__warDebug?.storyGo(x), id);
  if (!press) return;
  await expect
    .poll(async () => (await state(page))?.prompt ?? null, { timeout: 20_000 })
    .not.toBeNull();
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page))?.used ?? [], { timeout: 20_000 }).toContain(id);
}

test('radio, prompt, journal, quicksave and quickload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A clean slate on the first load only (the F9 reload must find the save).
  await page.addInitScript(() => {
    if (sessionStorage.getItem('war.e2e.cleared') === null) {
      localStorage.clear();
      sessionStorage.setItem('war.e2e.cleared', '1');
    }
  });
  await boot(page);
  await page.evaluate(() => {
    window.__warDebug?.cheat('god', true);
  });
  // Nothing of the ending shows during play.
  await expect(page.getByTestId('ending')).toBeHidden();
  const s0 = await state(page);
  expect(s0?.chapter).toBe('arrival');
  expect(s0?.quests['rally']).toBe('active');
  // Overwatch's first call, subtitled with its channel.
  await expect(page.getByTestId('subtitle')).toContainText('OVERWATCH', { timeout: 20_000 });
  await expect(page.getByTestId('subtitle')).toContainText('CH 4');

  // Reach the rally point, then take Reyes's bodycam.
  await visit(page, 'reyesCamera', false);
  await page.evaluate(() => window.__warDebug?.teleport([-128, 0.05, -20]));
  await expect.poll(async () => (await state(page))?.toasts.join('|') ?? '').toContain('✓');
  await visit(page, 'reyesCamera', false);
  await expect(page.getByTestId('story-prompt')).toContainText('[E] Take: KESTREL-1 bodycam', {
    timeout: 20_000,
  });
  await page.keyboard.press('KeyE');
  await expect.poll(async () => (await state(page))?.logs ?? []).toContain('reyesCam');
  await expect.poll(async () => (await state(page))?.chapter).toBe('power');
  // The journal holds the recording.
  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('journal')).toBeVisible();
  await expect(page.getByTestId('journal')).toContainText('KESTREL-1 bodycam, last upload');
  await page.keyboard.press('KeyJ');
  await expect(page.getByTestId('journal')).toBeHidden();
  // The chapter change autosaved; F5 quicksaves on top.
  await expect
    .poll(() => page.evaluate(() => window.__warDebug?.saveSlots().map((x) => x.slot)))
    .toContain('auto');
  await page.keyboard.press('F5');
  await expect
    .poll(() => page.evaluate(() => window.__warDebug?.saveSlots().map((x) => x.slot)))
    .toContain('quick');

  // F9: the page reloads into the save.
  await page.keyboard.press('F9');
  await page.waitForURL(/load=quick/);
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 90_000 });
  const loaded = await state(page);
  expect(loaded?.chapter).toBe('power');
  expect(loaded?.used).toContain('reyesCamera');
  expect(loaded?.quests['substation']).toBe('active');
  expect(errors).toEqual([]);
});

test('a choice at the Institute ends the story', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
  });
  await boot(page);
  await page.evaluate(() => {
    window.__warDebug?.cheat('god', true);
  });
  const route: [string, boolean][] = [
    ['rallyPoint', false],
    ['reyesCamera', true],
    ['generatorA', true],
    ['generatorB', true],
    ['mainBreaker', true],
    ['stationGate', false],
    ['reyesLast', true],
    ['keycard', true],
    ['forestEdge', false],
    ['seedStation', true],
    ['instituteGate', false],
    ['sorelLab', true],
    ['coreTerminal', true],
    ['transmitter', true],
  ];
  for (const [site, press] of route) {
    if (!press) {
      // Waypoints: walk past them (teleport onto the road there).
      const at = await page.evaluate((id) => {
        const map: Record<string, [number, number, number]> = {
          rallyPoint: [-128, 0.05, -20],
          stationGate: [0, 0.05, 8],
          forestEdge: [-128, 0.05, 100],
          instituteGate: [96, 0.05, 160],
        };
        return map[id] ?? null;
      }, site);
      if (at === null) throw new Error(site);
      await page.evaluate((p) => window.__warDebug?.teleport(p), at);
      // Wait until the story has seen us there (a condition scan runs every 6 ticks).
      await expect
        .poll(
          async () => {
            const s = await state(page);
            return s === null ? Infinity : Math.hypot(s.at[0] - at[0], s.at[1] - at[2]);
          },
          { timeout: 20_000 },
        )
        .toBeLessThan(2);
      await page.waitForTimeout(300);
      continue;
    }
    await visit(page, site);
  }
  await expect(page.getByTestId('ending')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('ending')).toContainText('BROADCAST');
  expect((await state(page))?.ending).toBe('broadcast');
});
