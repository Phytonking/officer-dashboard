import { expect, test, type Page } from '@playwright/test';
import { devLoginSkipTour, devSignIn } from './helpers';
import { letterCells, WORD_PATH } from '../src/ui/onboarding/snakePlan';

/**
 * V0.10/V0.11 hello screen: the multilingual greeting on the app's plain background (no colour
 * wash, no video), no start button (a click, a tap or any key starts), the group-photo slot, the
 * arcade snake whose body ends up writing "cseed" (letters only) with a sapling sprouting after
 * it, the hand-off onto the shell logo at every width, the reduced-motion and Skip paths. The planner itself is unit-tested in
 * onboarding-snake.spec.ts. Needs the Go server with DEV_AUTH=1.
 *
 * INTRO_FRAMES=<dir> also saves a frame sequence of the animation (used for the PR).
 */
const discordId = () => `9${String(Date.now()).padStart(13, '0')}${Math.floor(Math.random() * 1e4).toString().padStart(4, '0')}`;

/** The real app shell's logo (sidebar wordmark, the rail's sapling mark, or the phone top bar), measured on Home. */
const shellLogo = (page: Page) =>
  page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.topbar .wordmark-logo, .sidebar .wordmark-logo, .sidebar .wordmark-mark')).find((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.right > 0 && b.left < innerWidth && getComputedStyle(e).visibility !== 'hidden';
    })!;
    const b = el.getBoundingClientRect();
    return { box: [b.left, b.top, b.width, b.height], kind: el.classList.contains('wordmark-mark') ? 'mark' : 'wordmark' };
  });

async function openIntro(page: Page) {
  const id = discordId();
  await devLoginSkipTour(page, 'director');
  await expect(page.locator('.app')).toBeVisible();
  const shell = await shellLogo(page);
  const r = await page.request.post('/api/invites', { data: { name: 'Intro Tester', discordId: id, subteamId: 'team-events', method: 'link' } });
  expect(r.ok()).toBe(true);
  await page.goto('about:blank');
  await page.context().clearCookies();
  await devSignIn(page, { discord: id });
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.locator('.wi')).toBeVisible(); // the intro is the first step, no switch needed
  return shell;
}

/**
 * Starts the intro by `how` (a DOM click on the overlay or on Skip, or a key) and, in the same task,
 * freezes every animation at its start and reads what the layers really show: the computed
 * opacity of the photo, the dot grid and the background at that moment, plus a sample taken
 * part-way through each of their animations (`at` ms in).
 */
const startFrozen = (page: Page, how: 'overlay' | 'skip' | 'key', at = 0) =>
  page.evaluate(
    ({ how, at }) => {
      if (how === 'skip') document.querySelector<HTMLElement>('.wi-skip')!.click();
      else if (how === 'overlay') document.querySelector<HTMLElement>('.wi')!.click();
      else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      const anims = document.getAnimations();
      anims.forEach((a) => {
        a.pause();
        a.currentTime = at;
      });
      const op = (s: string) => +getComputedStyle(document.querySelector(s)!).opacity;
      const out = { photo: op('.wi-photo'), board: op('.wi-board'), bg: op('.wi-bg') };
      anims.forEach((a) => a.play());
      return out;
    },
    { how, at },
  );

const active = (page: Page) => page.locator('[data-wi-phrase][data-active="true"]');
const overlay = (page: Page) => page.locator('.wi');
const box = (page: Page, sel: string) => page.locator(sel).evaluate((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });

/**
 * Where the intro's logo ends up: its layout box (it is placed by left/top/height, and its own
 * animation ends at scale(1) with no translate), next to the page logo's box. Read from layout,
 * not from a frame, so a slow machine cannot miss the moment.
 */
const landing = (page: Page) =>
  page.locator('[data-wi-logo]').evaluate((lg: HTMLElement) => {
    const frames = lg.getAnimations().map((a) => (a.effect as KeyframeEffect).getKeyframes());
    const last = frames.at(-1)?.at(-1);
    const p = document.querySelector('[data-onb-logo]')!.getBoundingClientRect();
    // Untransformed box: left/top/height as placed, width from the current box over the current scale.
    const m = new DOMMatrix(getComputedStyle(lg).transform === 'none' ? undefined : getComputedStyle(lg).transform);
    const w = lg.getBoundingClientRect().width / (m.a || 1);
    return { intro: [parseFloat(lg.style.left), parseFloat(lg.style.top), w, parseFloat(lg.style.height)], page: [p.left, p.top, p.width, p.height], kind: lg.dataset.kind, end: last?.transform, opacity: last?.opacity };
  });

test('the greeting cycles through languages on a plain background, with no start button', async ({ page }) => {
  await openIntro(page);
  const langs = new Set<string>();
  await expect(active(page)).toHaveCount(1);
  for (let i = 0; i < 3; i++) {
    langs.add((await active(page).getAttribute('data-lang')) ?? '');
    await expect.poll(async () => (await active(page).getAttribute('data-lang')) ?? '', { timeout: 6000 }).not.toBe([...langs].pop());
  }
  expect(langs.size).toBeGreaterThanOrEqual(3);
  const all = page.locator('[data-wi-phrase]');
  expect(await all.count()).toBeGreaterThanOrEqual(12);
  const names = await all.evaluateAll((els) => els.map((e) => e.querySelector('.wi-cs')?.textContent));
  expect(new Set(names)).toEqual(new Set(['cseed']));
  const arabic = page.locator('[data-wi-phrase][lang="ar"]');
  await expect(arabic).toHaveAttribute('dir', 'rtl');
  await expect(arabic.locator('.wi-cs')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('.wi p.visually-hidden')).toHaveText('Hello, welcome to cseed');
  // V0.11: solid ink type on the app's own background, the same tokens as the shell (light here).
  const look = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const probe = document.createElement('i');
    document.body.appendChild(probe);
    const tok = (v: string) => ((probe.style.color = css.getPropertyValue(v)), getComputedStyle(probe).color);
    const out = { bg: tok('--bg'), text: tok('--text'), wi: getComputedStyle(document.querySelector('.wi')!).backgroundColor, layer: getComputedStyle(document.querySelector('.wi-bg')!).backgroundImage, type: getComputedStyle(document.querySelector('[data-wi-phrase][data-active="true"] .wi-text')!).color };
    probe.remove();
    return out;
  });
  expect(look.wi).toBe(look.bg);
  expect(look.layer).toBe('none');
  expect(look.type).toBe(look.text);
  // The only button is Skip; the overlay itself is the labelled control.
  await expect(overlay(page).getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  await expect(page.getByRole('button', { name: /continue|start|begin/i })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: /press any key, click or tap anywhere/i })).toBeVisible();
  // No colour wash and no video, before or after the click.
  await expect(page.locator('.wi video, .wi-wash, .wi-washes, .wi-fallback')).toHaveCount(0);
  await overlay(page).click({ position: { x: 200, y: 300 } });
  await expect(overlay(page)).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('.wi video, .wi-wash, .wi-washes, .wi-fallback')).toHaveCount(0);
  expect(await overlay(page).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(look.bg);
});

test('the photo and the grid reveal from nothing; the exit fade does not jump them to full', async ({ page }) => {
  await openIntro(page);
  // Review F-1: at the start both are hidden, part-way through their reveals they are part-way.
  const t0 = await startFrozen(page, 'overlay', 0);
  expect(t0.photo).toBe(0);
  expect(t0.board).toBe(0);
  expect(t0.bg).toBe(1);
  await page.goto('about:blank');
  await openIntro(page);
  const mid = await startFrozen(page, 'overlay', 40);
  expect(mid.photo).toBeGreaterThan(0);
  expect(mid.photo).toBeLessThan(0.9);
  expect(mid.board).toBeGreaterThan(0);
  expect(mid.board).toBeLessThan(0.9);
});

test('a click shows the group photo and starts the snake, whose body ends up spelling "cseed", then it lands on the logo', async ({ page }) => {
  const shell = await openIntro(page);
  await overlay(page).click({ position: { x: 200, y: 300 } });
  await expect(overlay(page)).toHaveAttribute('data-state', 'playing');
  // The photo slot: the placeholder until the real photo is dropped in.
  const photo = page.locator('[data-wi-photo]');
  await expect(photo).toHaveAttribute('data-wi-photo', 'placeholder');
  await expect(photo.locator('img')).toHaveAttribute('src', '/media/hello-group-placeholder.svg');
  await expect.poll(() => photo.evaluate((e) => +getComputedStyle(e).opacity)).toBeGreaterThan(0.95);
  await expect(page.locator('[data-wi-snake="head"]')).toHaveCount(1);
  // Seeds only on letter cells (the snake's first 6 word cells need none): nothing is laid between letters.
  await expect.poll(() => page.locator('[data-wi-apple]').count()).toBe(WORD_PATH.slice(6).filter((c) => c.kind === 'letter').length);

  await expect(overlay(page)).toHaveAttribute('data-state', 'spelled', { timeout: 30_000 });
  // The body is the planned word path, but only its letter cells are drawn: no stray cells between letters.
  const segs = await page.locator('[data-wi-snake]').evaluateAll((els) =>
    (els as HTMLElement[]).map((e) => ({ cell: e.dataset.cell!, kind: e.dataset.kind!, head: e.dataset.wiSnake === 'head', shown: e.style.opacity === '1' })),
  );
  expect(segs).toHaveLength(WORD_PATH.length);
  expect(new Set(segs.map((c) => c.cell))).toEqual(new Set(WORD_PATH.map((c) => `${c.x},${c.y}`)));
  const letters = letterCells();
  const shown = segs.filter((c) => c.shown);
  expect(new Set(shown.map((c) => c.cell))).toEqual(letters);
  for (const c of segs) expect(c.kind, c.cell).toBe(letters.has(c.cell) ? 'letter' : 'lift');
  const last = WORD_PATH[WORD_PATH.length - 1]!;
  expect(segs.find((c) => c.head)!.cell).toBe(`${last.x},${last.y}`);
  // The lifts are never painted, at any point (their squares stay at opacity 0).
  expect(await page.locator('[data-wi-snake][data-kind="lift"]').evaluateAll((els) => els.every((e) => getComputedStyle(e).opacity === '0'))).toBe(true);
  // A sapling sprouts after the d.
  await expect.poll(() => page.locator('[data-wi-sprout]').evaluate((e) => +getComputedStyle(e).opacity)).toBeGreaterThan(0.95);

  const rects = await landing(page);
  expect(rects.end).toBe('scale(1)');
  expect(String(rects.opacity)).toBe('1');
  rects.intro.forEach((v, i) => expect(Math.abs(v - rects.page[i]!)).toBeLessThan(0.01));
  rects.intro.forEach((v, i) => expect(Math.abs(v - shell.box[i]!), `shell logo ${shell.box} vs intro ${rects.intro}`).toBeLessThan(0.6));
  await expect(overlay(page)).toHaveCount(0, { timeout: 20_000 }); // onDone → the page removes it
  await expect(page.locator('[data-onb-logo]')).toBeVisible();
  await expect(page.locator('#step-title')).toBeFocused();
});

test('any key starts it; Tab moves focus and Shift does nothing', async ({ page }) => {
  await openIntro(page);
  await page.keyboard.press('Shift');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Skip' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(overlay(page)).toBeFocused();
  await expect(overlay(page)).toHaveAttribute('data-state', 'greeting');
  await page.keyboard.press('k');
  await expect(overlay(page)).toHaveAttribute('data-state', 'playing');
  await expect(page.locator('[data-wi-snake="head"]')).toHaveCount(1);
});

test('it is a real modal: Tab stays inside, the setup behind is inert, focus returns after', async ({ page }) => {
  await openIntro(page);
  expect(await page.evaluate(() => !!document.querySelector('.onb')?.closest('[inert]'))).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.wi')), `focus escaped after press ${i + 1}`).toBe(true);
  }
  await expect(overlay(page)).toHaveAttribute('data-state', 'greeting');
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(overlay(page)).toHaveCount(0, { timeout: 3000 });
  expect(await page.evaluate(() => !!document.querySelector('[inert]'))).toBe(false);
  await expect(page.locator('#step-title')).toBeFocused();
});

test('pressing again fast-forwards to the end; Escape skips', async ({ page }) => {
  await openIntro(page);
  await overlay(page).click({ position: { x: 120, y: 300 } });
  await expect(overlay(page)).toHaveAttribute('data-state', 'playing');
  await page.waitForTimeout(500);
  await page.keyboard.press('Space');
  await expect(overlay(page)).toHaveCount(0, { timeout: 3000 });

  // Escape, on a fresh invitee.
  await openIntro(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-wi-snake]')).toHaveCount(0);
  await expect(overlay(page)).toHaveCount(0, { timeout: 3000 });
});

test('Skip goes straight to the logo without the snake or the photo', async ({ page }) => {
  await openIntro(page);
  // Review F-1: the exit fade must not flash the never-revealed photo or grid, at any point.
  for (const at of [0, 120, 300]) {
    if (at) {
      await page.goto('about:blank');
      await openIntro(page);
    }
    const o = await startFrozen(page, 'skip', at);
    expect(o.photo, `photo at ${at}ms`).toBe(0);
    expect(o.board, `grid at ${at}ms`).toBe(0);
    await expect(overlay(page)).toHaveCount(0, { timeout: 3000 });
  }
  await openIntro(page);
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('[data-wi-snake]')).toHaveCount(0);
  await expect(overlay(page)).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('[data-onb-logo]')).toBeVisible();
});

test('prefers-reduced-motion: no snake; the photo shows, then a plain fade to the logo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openIntro(page);
  await expect(active(page)).toHaveCount(1);
  // The photo fades in from nothing (review F-1: the exit fade used to show it at once).
  const t0 = await startFrozen(page, 'key', 0);
  expect(t0.photo).toBe(0);
  expect(t0.board).toBe(0);
  await expect.poll(() => page.locator('[data-wi-photo]').evaluate((e) => +getComputedStyle(e).opacity)).toBeGreaterThan(0.95);
  await expect(page.locator('[data-wi-snake]')).toHaveCount(0);
  await expect(page.locator('[data-wi-apple]')).toHaveCount(0);
  await expect(page.locator('[data-wi-sprout]')).toHaveCount(0);
  await expect(overlay(page)).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('[data-onb-logo]')).toBeVisible();
});

test('missing photo: the placeholder, and no other media is fetched', async ({ page }) => {
  const media: string[] = [];
  page.on('request', (r) => r.url().includes('/media/') && media.push(new URL(r.url()).pathname));
  await openIntro(page);
  await expect(overlay(page)).toHaveAttribute('data-photo', 'placeholder');
  // Nothing asks for missing files (no 404s) and there is no video any more: only the placeholder is fetched.
  expect(media.filter((m) => !m.endsWith('/hello-group-placeholder.svg'))).toEqual([]);
});

test('dark theme: the intro uses the dark tokens', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openIntro(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  const c = await page.evaluate(() => ({ wi: getComputedStyle(document.querySelector('.wi')!).backgroundColor, type: getComputedStyle(document.querySelector('[data-wi-phrase] .wi-text')!).color }));
  expect(c.wi).toBe('rgb(24, 26, 24)');
  expect(c.type).toBe('rgb(238, 239, 235)');
});

// QA Q-1: the logo hand-off lines up with the real shell at the tablet edges and on phones.
for (const [w, h] of [[820, 1180], [900, 1180], [1099, 900], [1100, 900], [390, 844]] as const) {
  test(`${w}px: the intro logo lands exactly on the shell logo`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'widths are set explicitly; run once');
    await page.setViewportSize({ width: w, height: h });
    const shell = await openIntro(page);
    const pageLogo = await box(page, '[data-onb-logo]');
    pageLogo.forEach((v, i) => expect(Math.abs(v - shell.box[i]!), `page ${pageLogo} vs shell ${shell.box}`).toBeLessThan(0.6));
    await expect(page.locator('[data-onb-logo]')).toHaveAttribute('data-kind', shell.kind);
    await page.keyboard.press('Enter');
    await expect(overlay(page)).toHaveAttribute('data-state', 'playing');
    const r = await landing(page);
    expect(r.end).toBe('scale(1)');
    expect(r.kind).toBe(shell.kind);
    r.intro.forEach((v, i) => expect(Math.abs(v - shell.box[i]!), `intro ${r.intro} vs shell ${shell.box}`).toBeLessThan(0.6));
  });
}

test('frame sequence for the PR', async ({ page }, info) => {
  const dir = process.env.INTRO_FRAMES;
  test.skip(!dir, 'set INTRO_FRAMES=<dir> to record frames');
  await openIntro(page);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${dir}/${info.project.name}-00-greeting.png` });
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  for (let i = 1; i <= 30; i++) {
    await page.waitForTimeout(Math.max(0, i * 400 - (Date.now() - t0)));
    await page.screenshot({ path: `${dir}/${info.project.name}-${String(i).padStart(2, '0')}.png` });
    if ((await overlay(page).count()) === 0) break;
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/${info.project.name}-99-handoff.png` });
});
