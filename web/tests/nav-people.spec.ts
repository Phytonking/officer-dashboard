import { test, expect, type Page } from '@playwright/test';
import { devLoginSkipTour, watchErrors } from './helpers';

/**
 * V0.10 sidebar People folder: order, open/closed remembered across reloads, the icons-only
 * inline rail (keyboard, R-2) and the phone menu sheet.
 */
const toggle = (page: Page) => page.locator('#nav-people-toggle');
const panel = (page: Page) => page.locator('#nav-people-panel');
const reset = async (page: Page, path = '/') => {
  await page.evaluate(() => { try { localStorage.removeItem('cseed-people'); } catch { /* */ } });
  await page.goto(path);
};
const setRail = async (page: Page) => {
  await page.request.put('/api/me/prefs', { data: { sidebarWidth: 64 } });
  await page.evaluate(() => { try { localStorage.setItem('cseed-sidebar', '64'); } catch { /* */ } });
  await page.reload();
};
const resetWidth = async (page: Page) => {
  await page.request.put('/api/me/prefs', { data: { sidebarWidth: 0 } });
  await page.evaluate(() => { try { localStorage.removeItem('cseed-sidebar'); } catch { /* */ } });
};
async function openMenu(page: Page) {
  await page.locator('[data-nav-toggle]').click();
  await expect(page.locator('html')).toHaveClass(/nav-open/);
}

test.describe('sidebar People folder', () => {
  test.beforeEach(async ({ page }) => {
    await devLoginSkipTour(page, 'officer');
    await resetWidth(page);
  });
  test.afterEach(async ({ page }) => { await resetWidth(page).catch(() => {}); });

  test('order: Design sits directly above People, which holds the three pages', async ({ page }, info) => {
    const errors = watchErrors(page);
    await reset(page);
    if (info.project.name === 'phone') await openMenu(page);
    // Wide sidebar: top-level entries in order. Rail/phone expose the same DOM order.
    const top = await page.locator('#sidebar .nav-list > li > .nav-link').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav')));
    expect(top).toEqual(['home', 'buildspace', 'events', 'finance', 'design', 'people']);
    const subs = await panel(page).locator('a').evaluateAll((els) => els.map((e) => [e.getAttribute('data-nav'), e.getAttribute('href')]));
    expect(subs).toEqual([['officers', '/officers'], ['members', '/members'], ['contacts', '/contacts']]);
    await expect(panel(page).locator('a').first()).toContainText('Board/Officers');
    expect(errors.filter((e) => !/\b(40[134])\b/.test(e))).toEqual([]);
  });

  test('open by default, collapse is remembered across reloads', async ({ page }, info) => {
    test.skip(info.project.name === 'tablet', 'tablet defaults to the icons-only rail');
    await reset(page);
    if (info.project.name === 'phone') await openMenu(page);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page).getByRole('link', { name: 'Members' })).toBeVisible();

    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page).getByRole('link', { name: 'Members' })).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('cseed-people'))).toBe('0');

    await page.reload();
    if (info.project.name === 'phone') await openMenu(page);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page).getByRole('link', { name: 'Members' })).toBeHidden();

    await toggle(page).click();
    await expect(panel(page).getByRole('link', { name: 'Members' })).toBeVisible();
    await page.reload();
    if (info.project.name === 'phone') await openMenu(page);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  });

  test('a collapsed folder auto-expands on one of its pages and marks the page current', async ({ page }, info) => {
    test.skip(info.project.name === 'tablet', 'rail is covered below');
    await page.evaluate(() => localStorage.setItem('cseed-people', '0'));
    await page.goto('/members');
    if (info.project.name === 'phone') await openMenu(page);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page).locator('[data-nav="members"]')).toHaveAttribute('aria-current', 'page');
    await expect(panel(page).locator('[data-nav="members"]')).toBeVisible();
    await page.goto('/events');
    if (info.project.name === 'phone') await openMenu(page);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('the tour targets still resolve', async ({ page }, info) => {
    await reset(page);
    await expect(page.locator('[data-tour="sidebar"]#sidebar')).toHaveCount(1);
    if (info.project.name === 'phone') await expect(page.locator('[data-tour="nav-toggle"]')).toBeVisible();
    else await expect(page.locator('[data-tour="sidebar-resize"]')).toBeVisible();
  });

  test('icons-only rail: the three pages stack inline under the People icon', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'no rail on phones');
    await reset(page);
    await setRail(page);
    await expect(page.locator('#sidebar .nav-label').first()).toBeHidden();
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle(page)).toHaveAttribute('aria-controls', 'nav-people-panel');
    const sb = (await page.locator('#sidebar').boundingBox())!;
    const t = (await toggle(page).boundingBox())!;
    const subs = panel(page).locator('a');
    await expect(subs).toHaveCount(3);
    let prev = t.y;
    for (let i = 0; i < 3; i++) {
      await expect(subs.nth(i)).toBeVisible();
      const b = (await subs.nth(i).boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(sb.x);
      expect(b.x + b.width).toBeLessThanOrEqual(sb.x + sb.width); // inside the rail, no flyout
      expect(b.y).toBeGreaterThan(prev);
      prev = b.y;
      expect(await subs.nth(i).getAttribute('title')).toBeTruthy();
    }
    // Click collapses inline, click again expands; nothing moves sideways.
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(subs.first()).toBeHidden();
    await toggle(page).click();
    await expect(subs.first()).toBeVisible();
    await subs.nth(2).click();
    await expect(page).toHaveURL(/\/contacts/);
    await expect(page.locator('.nav-folder')).toHaveAttribute('data-current', '');
  });

  test('R-2: Tab then Enter on People opens (never closes) it; keys keep focus', async ({ page }, info) => {
    test.skip(info.project.name === 'phone', 'no keyboard rail on phones');
    await page.evaluate(() => localStorage.setItem('cseed-people', '0'));
    await page.goto('/events');
    await setRail(page);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    // Tab to the button by keyboard (focus-visible), then Enter.
    await page.locator('a[data-nav="design"]').focus();
    await page.keyboard.press('Tab');
    await expect(toggle(page)).toBeFocused();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false'); // focus alone changes nothing
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(page).locator('a').first()).toBeVisible();
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    // Arrows: Down enters the group, moves, Up returns, Left collapses and keeps focus on the button.
    await page.keyboard.press('ArrowDown');
    await expect(panel(page).locator('a').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(panel(page).locator('a').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page)).toBeFocused();
  });

  test('resizing the sidebar keeps the folder inline and its state', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'sidebar is resizable on desktop');
    await reset(page);
    await toggle(page).click(); // collapse on the wide sidebar
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    for (const w of [64, 240, 320, 64]) {
      await page.evaluate((px) => {
        document.documentElement.dataset.sidebar = px <= 64 ? 'rail' : 'wide';
        document.documentElement.style.setProperty('--sidebar', px + 'px');
        window.dispatchEvent(new Event('cseed-sidebar'));
      }, w);
      await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(panel(page).locator('a').first()).toBeHidden();
    }
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    const sb = (await page.locator('#sidebar').boundingBox())!;
    for (const w of [240, 64, 320]) {
      await page.evaluate((px) => {
        document.documentElement.dataset.sidebar = px <= 64 ? 'rail' : 'wide';
        document.documentElement.style.setProperty('--sidebar', px + 'px');
        window.dispatchEvent(new Event('cseed-sidebar'));
      }, w);
      const links = panel(page).locator('a');
      await expect(links.first()).toBeVisible();
      const s = (await page.locator('#sidebar').boundingBox())!;
      for (let i = 0; i < 3; i++) {
        const b = (await links.nth(i).boundingBox())!;
        expect(b.x + b.width).toBeLessThanOrEqual(s.x + s.width + 0.5);
      }
    }
    expect(sb.width).toBeGreaterThan(0);
  });

  test('phone menu sheet: expandable group', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'phone only');
    await reset(page);
    await openMenu(page);
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page).getByRole('link', { name: 'Members' })).toBeHidden();
    await toggle(page).click();
    await panel(page).getByRole('link', { name: 'Members' }).click();
    await expect(page).toHaveURL(/\/members/);
    await expect(page.locator('html')).not.toHaveClass(/nav-open/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
