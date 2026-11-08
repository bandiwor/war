import { expect, test } from '@playwright/test';

test('boots, shows the War OSD and ticks the simulation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?seed=1337');
  await expect(page).toHaveTitle('War');
  const osd = page.getByTestId('osd');
  await expect(osd).toContainText('REC');
  await expect(osd).toContainText('WAR');
  await expect
    .poll(async () => Number(await osd.getAttribute('data-tick')), { timeout: 5000 })
    .toBeGreaterThan(30);
  expect(errors).toEqual([]);
});

test('debug menu toggles with ~ and supports pause + single step', async ({ page }) => {
  await page.goto('/?seed=1337');
  const menu = page.getByTestId('debug-menu');
  await expect(menu).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('seed   1337');
  await menu.getByRole('button', { name: 'Pause' }).click();
  const tickOf = async (): Promise<number> =>
    Number(/tick\s+(\d+)/.exec((await menu.textContent()) ?? '')?.[1]);
  const paused = await tickOf();
  await page.waitForTimeout(300);
  expect(await tickOf()).toBe(paused);
  await menu.getByRole('button', { name: 'Step' }).click();
  await expect.poll(tickOf).toBe(paused + 1);
  await page.keyboard.press('Backquote');
  await expect(menu).toBeHidden();
});
