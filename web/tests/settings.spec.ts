import { expect, test, type Page } from '@playwright/test';
import { devLogin, settle, devSignIn } from './helpers';

test('the theme setting persists across a reload with no flash', async ({ page }) => {
  await devLogin(page, 'director');
  // Light is the default.
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto('/settings');
  await settle(page);
  await page.getByLabel('Dark').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Reload with every module script blocked: only the inline pre-paint script can set the
  // theme, so a dark first paint proves there is no light flash before hydration.
  await page.route(/\.(m?js|tsx?|css)(\?.*)?$|\/@vite\/|\/@id\/|\/node_modules\//, (r) => (r.request().resourceType() === 'document' ? r.continue() : r.abort()));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'dark');
  await page.unrouteAll({ behavior: 'ignoreErrors' });

  await page.reload();
  await settle(page);
  await expect(page.getByLabel('Dark')).toBeChecked();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g)!.map(Number) as [number, number, number];
  expect(r + g + b, `dark body background, got ${bg}`).toBeLessThan(200);

  // System follows the device.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByLabel('System').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Density persists too.
  await page.getByLabel('Compact').check();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await page.getByLabel('Comfortable').check();
  await page.getByLabel('Light').check();
});

test('signed-out visitors are sent to /login, which links to Discord and back to where they were', async ({ page }) => {
  await page.goto('/finance?id=req-0005');
  await expect(page).toHaveURL(/\/login\?next=/);
  await expect(page.getByRole('link', { name: 'Sign in with Discord' })).toHaveAttribute('href', /^\/auth\/login\?next=%2Ffinance/);
  // In developer mode the login page may show the skip-Discord panel carrying the same next=;
  // otherwise (production, or a keyed test build without the key) sign in through /auth/dev.
  const devLink = page.locator('[data-dev-login="officer"]');
  if (await devLink.count()) {
    await expect(devLink).toHaveAttribute('href', /next=%2Ffinance%3Fid%3Dreq-0005/);
    await devLink.click();
    // The link opens the confirmation page; its button posts the sign-in form.
    await page.getByRole('button', { name: 'Continue' }).click();
  } else {
    await devSignIn(page, { as: 'officer' }, '/finance?id=req-0005');
  }
  await expect(page).toHaveURL(/\/finance\?id=req-0005/);
});

/**
 * What the signed-in user's hosting tiles should show right now: their published or completed
 * events that have already started (the product's rule), worked out from the events list so
 * the spec holds on any date as seeded events slip into the past.
 */
async function expectedHosting(page: Page) {
  const meId = ((await (await page.request.get('/api/me')).json()) as { user: { id: string } }).user.id;
  const res = await page.request.get('/api/events?limit=200');
  expect(res.ok()).toBe(true);
  const { items } = (await res.json()) as { items: { id: string; name: string; startsAt: string; status: string; host: { id: string } | null; metrics: { checkedIn: number } }[] };
  const hosted = items
    .filter((e) => e.host?.id === meId && (e.status === 'published' || e.status === 'completed') && Date.parse(e.startsAt) <= Date.now())
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
  return { count: hosted.length, attendees: hosted.reduce((n, e) => n + e.metrics.checkedIn, 0), last: hosted[0] };
}

test('settings shows the signed-in officer\'s own hosting stats, a Discord placeholder and the tour entry', async ({ page }) => {
  await devLogin(page, 'officer');
  await page.goto('/settings');
  await settle(page);
  const want = await expectedHosting(page);
  expect(want.last, 'the seed gives this officer at least one started event').toBeTruthy();
  const row = page.locator('[data-stat-row]');
  await expect(row.locator('.stat-tile')).toHaveCount(4);
  await expect(row.locator('[data-stat="events-hosted"] .stat-tile-value')).toHaveText(String(want.count));
  await expect(row.locator('[data-stat="attendees"] .stat-tile-value')).toHaveText(String(want.attendees));
  const discord = row.locator('[data-stat="discord-messages"]');
  await expect(discord).toContainText('Coming soon');
  await expect(discord).not.toContainText(/\d/);
  const last = row.locator('[data-stat="last-event-hosted"]');
  await expect(last).toContainText(want.last!.name);
  await expect(last).toHaveAttribute('href', `/events?id=${want.last!.id}`);
  await expect(page.getByRole('heading', { name: 'your profile' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Replay dashboard tour' })).toHaveAttribute('href', '/?tutorial=1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a director who has hosted nothing sees zeros and the empty state', async ({ page }) => {
  await devLogin(page, 'director');
  await page.goto('/settings');
  await settle(page);
  const row = page.locator('[data-stat-row]');
  await expect(row.locator('[data-stat="events-hosted"] .stat-tile-value')).toHaveText('0');
  await expect(row.locator('[data-stat="attendees"] .stat-tile-value')).toHaveText('0');
  await expect(row.locator('[data-stat="last-event-hosted"]')).toContainText('not hosted');
});

test('a failed stats request shows a retry, not zeros', async ({ page }) => {
  await devLogin(page, 'officer');
  const want = await expectedHosting(page);
  await page.route('**/api/me/stats', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
  await page.goto('/settings');
  await settle(page);
  const hosted = page.locator('[data-stat="events-hosted"]');
  await expect(hosted).toContainText('Could not load');
  await expect(hosted.locator('.stat-tile-value')).toHaveText('—');
  await page.unroute('**/api/me/stats');
  await hosted.getByRole('button', { name: 'Retry' }).click();
  await expect(hosted.locator('.stat-tile-value')).toHaveText(String(want.count));
});
