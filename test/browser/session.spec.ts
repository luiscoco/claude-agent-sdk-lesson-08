import { test, expect } from '@playwright/test';
test('closing during session creation cleans up a late response', async ({ page }) => {
  let deleted = false;
  await page.route('**/api/sessions', async (route) => {
    await new Promise((r) => setTimeout(r, 500));
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'late-session' }),
    });
  });
  await page.route('**/api/sessions/late-session', async (route) => {
    deleted = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"closed":true}' });
  });
  await page.goto('/');
  await page.frameLocator('#fixture').locator('h1').waitFor();
  await page.locator('#start').click();
  await page.locator('#close').click();
  await expect.poll(() => deleted).toBeTruthy();
  await expect(page.locator('#identity')).toHaveText('No session');
  await expect(page.locator('#start')).toBeEnabled();
});
test('actual browser SDK suspends delivery, preserves identity and catches up durable output', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.frameLocator('#fixture').locator('h1').waitFor();
  await page.locator('#request-dialog').uncheck();
  await page.locator('#start').click();
  await expect(page.locator('#worker')).toHaveText('running');
  await expect(page.locator('#received')).not.toHaveText('0');
  const id = await page.locator('#identity').textContent();
  await page.locator('#suspend').click();
  await expect(page.locator('#stream')).toContainText('suspended');
  await page.waitForTimeout(200);
  const received = await page.locator('#received').textContent(),
    produced = Number(await page.locator('#produced').textContent());
  await expect
    .poll(async () => Number(await page.locator('#produced').textContent()))
    .toBeGreaterThan(produced);
  await expect(page.locator('#received')).toHaveText(received!);
  await expect(page.locator('#worker')).toHaveText('completed', { timeout: 12000 });
  await expect(page.locator('#outcome')).toHaveText('Awaiting a result message.');
  await page.locator('#resume').click();
  await expect(page.locator('#outcome')).toContainText('Practice observations');
  await expect(page.locator('#identity')).toHaveText(id!);
  await page.locator('#inspect').click();
  await expect(page.locator('#usage')).toContainText('SYNTHETIC');
  await expect(page.locator('#context')).toContainText('800 / 2000');
  const dl = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await dl).suggestedFilename()).toBe('lesson-08-observations.json');
  await page.locator('#close').click();
  await expect(page.locator('#stream')).toContainText('closed');
  expect(errors).toEqual([]);
});
test('declared dialog invokes actual onUserDialog and resumes from user choice', async ({
  page,
}) => {
  await page.goto('/');
  await page.frameLocator('#fixture').locator('h1').waitFor();
  await page.locator('#start').click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#worker')).toHaveText('waiting-dialog');
  await page.getByRole('button', { name: 'Review page', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('#outcome')).toContainText('Practice observations', { timeout: 12000 });
  await expect(page.locator('#dialog-status')).toHaveText('Dialog completed');
  await page.locator('#close').click();
});
test('undeclared dialog is skipped and explicit dismissal is distinct', async ({ page }) => {
  await page.goto('/');
  await page.frameLocator('#fixture').locator('h1').waitFor();
  await page.locator('#advertise').uncheck();
  await page.locator('#start').click();
  await expect(page.locator('#outcome')).toContainText('Practice observations', { timeout: 12000 });
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.locator('#close').click();
  await page.locator('#advertise').check();
  await page.locator('#start').click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Dismiss dialog' }).click();
  await expect(page.locator('#dialog-status')).toHaveText('Dialog dismissed');
  await page.locator('#close').click();
});
test('phone layout, guide and knowledge check', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'One session. Two lifecycles.' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: '02 Host responsibilities' }).click();
  await expect(page.locator('#guide')).toContainText('usage_EXPERIMENTAL');
  await page.getByRole('button', { name: '03 Knowledge check' }).click();
  for (const [i, a] of [0, 1, 2, 0].entries())
    await page.locator(`input[name="q${i}"][value="${a}"]`).check();
  await page.locator('#grade').click();
  await expect(page.locator('#score')).toContainText('4 / 4');
});
test('missing live credentials is actionable and does not create a fake result', async ({
  page,
}) => {
  await page.route('**/api/sessions', (r) =>
    r.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Configure your local API key.' }),
    }),
  );
  await page.goto('/');
  await page.frameLocator('#fixture').locator('h1').waitFor();
  await page.locator('#mode').selectOption('live');
  await page.locator('#start').click();
  await expect(page.locator('#notice')).toContainText('Configure your local API key.');
  await expect(page.locator('#outcome')).toContainText('Awaiting');
  await expect(page.locator('#start')).toBeEnabled();
});
