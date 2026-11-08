import { expect, test } from '@playwright/test';

test('boots, renders the street and ticks the simulation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=1337&quality=low');
  await expect(page).toHaveTitle('War');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  await expect(page.getByTestId('view')).toBeVisible();
  await expect
    .poll(async () => Number(await app.getAttribute('data-tick')), { timeout: 15_000 })
    .toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('debug menu: tabs, pause and single step', async ({ page }) => {
  await page.goto('/?seed=1337&quality=low');
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 60_000 });
  const menu = page.getByTestId('debug-menu');
  await expect(menu).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('seed   1337');
  await menu.getByRole('button', { name: 'Pause' }).click();
  const tickOf = async (): Promise<number> =>
    Number(/tick\s+(\d+)/.exec((await menu.textContent()) ?? '')?.[1]);
  const paused = await tickOf();
  await page.waitForTimeout(500);
  expect(await tickOf()).toBe(paused);
  await menu.getByRole('button', { name: 'Step' }).click();
  await expect.poll(tickOf).toBe(paused + 1);
  await menu.getByRole('button', { name: 'Render' }).click();
  await expect(menu).toContainText('draws');
  await expect(menu).toContainText('post     autoExposure');
  await page.keyboard.press('Backquote');
  await expect(menu).toBeHidden();
});

test('every bodycam effect toggles from the debug menu', async ({ page }) => {
  // 15 effects × 2 toggles, each confirmed on a rendered frame; software GL is slow.
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/?seed=1337&quality=low');
  await expect(page.locator('#app')).toHaveAttribute('data-debug', '1', { timeout: 60_000 });
  await page.keyboard.press('Backquote');
  const menu = page.getByTestId('debug-menu');
  await menu.getByRole('button', { name: 'Bodycam' }).click();
  const boxes = menu.locator('input[type=checkbox][data-effect]');
  const count = await boxes.count();
  expect(count).toBe(15);
  const graph = (): Promise<string> => page.evaluate(() => window.__warDebug?.stats().graph ?? '');
  for (let i = 0; i < count; i++) {
    const box = boxes.nth(i);
    const id = (await box.getAttribute('data-effect')) ?? '';
    await expect(box).toBeChecked();
    await box.uncheck();
    if (id === 'cameraShake') continue; // camera-stage effect: not a post pass
    await expect.poll(graph, { intervals: [50], timeout: 20_000 }).not.toContain(id);
    await box.check();
    await expect.poll(graph, { intervals: [50], timeout: 20_000 }).toContain(id);
  }
});

test('benchmark mode walks a scripted path and reports frame times', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 270 });
  await page.goto('/?seed=1337&quality=low&bench=3');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-bench', /fps/, { timeout: 60_000 });
  const report: unknown = JSON.parse((await app.getAttribute('data-bench')) ?? '{}');
  expect(report).toMatchObject({ seconds: 3, drawCalls: expect.any(Number) });
  await expect(page.locator('.bench-report')).toContainText('BENCHMARK');
  expect(Number(await app.getAttribute('data-tick'))).toBeGreaterThan(10);
});
