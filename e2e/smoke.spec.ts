import { expect, test, type Page } from '@playwright/test';

async function boot(page: Page, settings: Record<string, unknown> = {}) {
  await page.goto('/');
  await page.evaluate((s) => localStorage.setItem('tumbadosmith.settings.v1', JSON.stringify(s)), { lang: 'es', ...settings });
  await page.reload();
}

test('home shows both instruments and switches language', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.logo')).toContainText('Tumbadosmith');
  await expect(page.locator('[data-instrument=guitar]')).toContainText('Guitarra');
  await page.getByRole('button', { name: 'EN' }).click();
  await expect(page.locator('[data-instrument=guitar]')).toContainText('Guitar');
  await page.reload();
  await expect(page.locator('[data-instrument=bass]')).toContainText('Bass');
});

test('menu connects the input and opens the tuner', async ({ page }) => {
  await boot(page);
  await page.click('[data-instrument=guitar]');
  await expect(page.locator('.input-status')).toHaveAttribute('data-state', 'on');
  await page.getByText('Afinador').click();
  await expect(page.locator('.string-btn')).toHaveCount(6);
  // Chromium's fake microphone plays a tone, so the tuner shows a reading.
  await expect(page.locator('.tuner-cents')).toContainText('¢', { timeout: 5000 });
});

test('each instrument lists its riffs', async ({ page }) => {
  await boot(page);
  await page.click('[data-instrument=bass]');
  await page.getByText('Riffs', { exact: true }).click();
  await expect(page.locator('.riff')).toHaveCount(6);
  await expect(page.locator('[data-riff^=bajo-]')).toHaveCount(6);
  await page.getByRole('button', { name: '← Atrás' }).click();
  await page.getByRole('button', { name: '← Atrás' }).click();
  await page.click('[data-instrument=guitar]');
  await page.getByText('Riffs', { exact: true }).click();
  await expect(page.locator('[data-riff^=gtr-]')).toHaveCount(6);
});

test('demo mode plays a riff through the detector and scores it', async ({ page }) => {
  await boot(page, { demo: true });
  await page.click('[data-instrument=bass]');
  await page.getByText('Riffs', { exact: true }).click();
  await page.locator('[data-riff=bajo-raiz-quinta] .btn.primary').click();
  await page.getByText('Toca para empezar').click();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'results', { timeout: 30_000 });
  const acc = Number((await page.getByTestId('accuracy').innerText()).replace('%', ''));
  expect(acc).toBeGreaterThanOrEqual(90);
  await page.getByRole('button', { name: 'Volver a riffs' }).last().click();
  await expect(page.locator('[data-riff=bajo-raiz-quinta] .chip.good').first()).toBeVisible();
});

test('settings persist', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: /Ajustes/ }).click();
  const lowOnTop = page.getByRole('switch').nth(3);
  const before = await lowOnTop.isChecked();
  await lowOnTop.click();
  await page.reload();
  await page.getByRole('button', { name: /Ajustes/ }).click();
  expect(await page.getByRole('switch').nth(3).isChecked()).toBe(!before);
});

test('no horizontal scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await boot(page);
  for (const go of [async () => {}, async () => page.getByRole('button', { name: /Ajustes/ }).click()]) {
    await go();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
  }
});
