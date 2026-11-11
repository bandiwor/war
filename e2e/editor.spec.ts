import { expect, test, type Page } from '@playwright/test';
import { MOBS, MOB_IDS } from '../src/domain/mobs/registry';

/**
 * Stage 9 acceptance: the level editor, built into the game. Its palette
 * comes from the registries; placing, moving and painting go through
 * undoable commands (keyboard undo/redo); the automatic checks flag a
 * stuck spawn live; "play from here" boots the real game on the level, and
 * F4 goes back to the editor with the level kept.
 */
test.use({ viewport: { width: 1280, height: 760 } });
test.setTimeout(300_000);

async function openEditor(page: Page): Promise<void> {
  await page.goto('/?editor=1&quality=low');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', '1', { timeout: 120_000 });
}

test('palette from the registries, live checks, undo/redo, export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('war.e2e.cleared') === null) {
      localStorage.clear();
      sessionStorage.setItem('war.e2e.cleared', '1');
    }
  });
  await openEditor(page);
  const palette = await page.evaluate(() => window.__warEditor?.palette() ?? []);
  for (const id of MOB_IDS) expect(palette).toContain(`mob: ${MOBS[id].label}`);
  // The sample level is clean.
  await expect(page.getByTestId('checks')).toHaveAttribute('data-errors', '0');

  // The spawn dropped inside a container: the checks flag a stuck spawn within a moment.
  await page.evaluate(() => window.__warEditor?.place('spawn', 16, -14));
  await expect(page.getByTestId('checks')).not.toHaveAttribute('data-errors', '0', {
    timeout: 10_000,
  });
  await expect(page.locator('[data-code="spawn-blocked"]')).toBeVisible();
  // Keyboard undo puts it back; the checks clear.
  await page.locator('.ed-status').click();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('checks')).toHaveAttribute('data-errors', '0', { timeout: 10_000 });

  // Place a wolf with the real UI: tool 2, pick it in the palette, click the view.
  const before = await page.evaluate(() => window.__warEditor?.level().mobs.length ?? 0);
  await page.keyboard.press('Digit2');
  await page.getByTestId('palette').selectOption('mobs:wolf');
  const box = await page.getByTestId('editor-canvas').boundingBox();
  if (box === null) throw new Error('no canvas');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(() => page.evaluate(() => window.__warEditor?.level().mobs.length))
    .toBe(before + 1);
  await expect(page.getByTestId('inspector')).toContainText('wolf');
  await page.locator('.ed-status').click();
  await page.keyboard.press('Control+z');
  await expect
    .poll(() => page.evaluate(() => window.__warEditor?.level().mobs.length))
    .toBe(before);
  await page.keyboard.press('Control+Shift+z');
  await expect
    .poll(() => page.evaluate(() => window.__warEditor?.level().mobs.length))
    .toBe(before + 1);

  // A terrain stroke and a decor scatter, both undoable; the export parses back.
  const heights = () =>
    page.evaluate(() => window.__warEditor?.level().terrain.heights.join('') ?? '');
  const flat = await heights();
  const decor = await page.evaluate(() => window.__warEditor?.level().decor.length ?? 0);
  await page.evaluate(() => {
    window.__warEditor?.paint(0, 0, 4, { kind: 'raise' });
    window.__warEditor?.scatter(-20, -20, 5, 'barrel', 4);
  });
  expect(await heights()).not.toBe(flat);
  expect(await page.evaluate(() => window.__warEditor?.level().decor.length)).toBe(decor + 4);
  await page.evaluate(() => window.__warEditor?.undo());
  await page.evaluate(() => window.__warEditor?.undo());
  expect(await heights()).toBe(flat);
  const text = await page.evaluate(() => window.__warEditor?.text() ?? '');
  expect(JSON.parse(text)).toMatchObject({ format: 'war-level', version: 2, id: 'yard' });
  expect(errors).toEqual([]);
});

test('play from here boots the real game on the level; F4 returns to the editor', async ({
  page,
}) => {
  await openEditor(page);
  await page.evaluate(() => {
    window.__warEditor?.load(window.__warEditor.text());
    window.__warEditor?.place('mob: Boar', 4, -18);
  });
  const mobs = await page.evaluate(() => window.__warEditor?.level().mobs.length ?? 0);
  await page.getByTestId('play-from-here').click();
  await page.waitForURL(/level=session/);
  await expect(page.locator('#app')).toHaveAttribute('data-level', 'yard', { timeout: 120_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 120_000 });
  // The placed mobs are in the simulation (spawn zones add more over time).
  await expect
    .poll(() => page.evaluate(() => window.__warDebug?.mobCount() ?? 0), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(mobs);
  // The level's story runs too.
  await expect
    .poll(() => page.evaluate(() => window.__warDebug?.storyState()?.quests['yardPower']))
    .toBe('active');
  await page.keyboard.press('F4');
  await page.waitForURL(/editor=1/);
  await expect(page.locator('#app')).toHaveAttribute('data-ready', '1', { timeout: 120_000 });
  expect(await page.evaluate(() => window.__warEditor?.level().mobs.length)).toBe(mobs);
});
