import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { And, Background, bddDrift, But, Feature, Given, Scenario, Then, When } from './bdd';
import { devSignIn, settle, watchErrors } from './helpers';

/*
 * Behaviour spec for Launchpad cohorts, invites, portals and mentor assignment. Every step text
 * matches features/launchpad.feature (checked by the drift test at the bottom). Runs on the
 * desktop project against a dev server with DEV_AUTH=1; see features/README.md.
 *
 * Each run makes its own cohort, builders, mentor and Discord IDs, so the suite can run again
 * on the same database. The last scenario archives the run's cohort, which returns the
 * register's default cohort to the seeded one.
 */
const RUN = Date.now().toString(36);
const DISCORD = (n: number) => `4${String(Date.now()).padStart(13, '0')}${String(n).padStart(3, '0')}`;
const DOMAIN = 'bdd-launchpad.test';
const A = { name: `Ada Byron ${RUN}`, email: `ada.${RUN}@${DOMAIN}`, discord: DISCORD(1) };
const B = { name: `Grace Hopper ${RUN}`, email: `grace.${RUN}@${DOMAIN}`, discord: DISCORD(2) };
const MENTOR = { name: `BDD Mentor ${RUN}`, email: `mentor.${RUN}@${DOMAIN}`, discord: DISCORD(4) };
const COHORT = `BDD ${RUN}`;
const PROJECT = `Lantern ${RUN}`;
const CHECKIN = `Wired the first prototype end to end (${RUN}).`;
const SHARED_NOTE = `Great demo, ship the onboarding next (${RUN}).`;
const PRIVATE_NOTE = `Officers: team may need a second hardware kit (${RUN}).`;

/** State the scenarios hand to each other (serial). */
const S: {
  cohortId?: string;
  links: Record<string, string>;
  projectId?: string;
  personA?: string;
  personB?: string;
  accountB?: string;
  mentorId?: string;
  mentorLink?: string;
} = { links: {} };

// Portal users each get their own browser context (their own cookie jar) for the whole feature.
const ctx: Record<string, BrowserContext> = {};
const pages: Record<string, Page> = {};
async function portalPage(browser: Browser, who: string): Promise<Page> {
  if (pages[who] && !pages[who]!.isClosed()) return pages[who]!;
  ctx[who] = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Los_Angeles' });
  pages[who] = await ctx[who]!.newPage();
  return pages[who]!;
}
/** The dev-only twin of "Continue with Discord": same server binding code as /auth/callback. */
async function acceptInvite(page: Page, url: string, discord: string) {
  const token = new URL(url, 'http://x').searchParams.get('token')!;
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  const res = await page.request.post('/auth/dev', { form: { launchpad: token, discord, next: '/launchpad' }, maxRedirects: 0 });
  expect(res.status(), 'dev invite acceptance (is the server built with -tags dev and DEV_AUTH=1?)').toBe(302);
  const location = res.headers()['location']!;
  await page.goto(location);
  return location;
}
async function officer(page: Page, as: 'director' | 'officer' = 'director', path = '/buildspace-launchpad') {
  await devSignIn(page, { as }, path);
  await page.request.put('/api/me/prefs', { data: { dashboardTutorialSeen: true } });
  await page.goto(path);
  await settle(page);
  return page;
}
async function register(page: Page, archived = false) {
  const r = await page.request.get(`/api/buildspace-launchpad?cohort=${S.cohortId}${archived ? '&archived=1' : ''}`);
  expect(r.ok()).toBe(true);
  return r.json();
}
async function portal(page: Page) {
  await page.goto('/launchpad');
  await settle(page);
  return page;
}
async function phoneShot(page: Page, name: string) {
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `${SHOTS}/${name}-phone.png`, fullPage: true });
  await page.setViewportSize(size);
}
const SHOTS = 'tmp/verify/launchpad-bdd';

test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'one end-to-end flow; phone shots are taken inside the steps'));
test.afterAll(async () => {
  for (const c of Object.values(ctx)) await c.close();
});

Feature('Launchpad cohorts, invites, portals and mentor assignment', { shots: SHOTS }, () => {
  Background(async () => {
    await Given('the dashboard is seeded and developer sign-in is on', async () => {
      const r = await fetch(`${test.info().project.use.baseURL}/auth/dev/info`).catch(() => null);
      expect(r?.ok, 'start the Go server with -tags dev and DEV_AUTH=1 (features/README.md)').toBe(true);
    });
  });

  Scenario('A director creates a cohort and works inside it', async ({ page }) => {
    const errors = watchErrors(page);
    await Given('I am signed in as a director on Buildspace + Launchpad', async () => officer(page));
    await When('I create a new cohort for this run', async () => {
      await page.locator('[data-new-cohort]').click();
      const form = page.locator('#lp-cohort-dialog [data-cohort-form]');
      await form.locator('input[name=name]').fill(COHORT);
      await form.locator('button.btn--primary').click();
      await expect(page).toHaveURL(/cohort=/);
      S.cohortId = new URL(page.url()).searchParams.get('cohort')!;
      await settle(page);
      return page;
    });
    await Then('the cohort switcher selects the new cohort', async () => {
      const select = page.locator('[data-cohort-select]');
      await expect(select).toHaveValue(S.cohortId!);
      await expect(select.locator('option:checked')).toHaveText(COHORT);
      return page;
    });
    await And('the URL remembers the cohort', async () => {
      await page.reload();
      await settle(page);
      await expect(page.locator('[data-cohort-select]')).toHaveValue(S.cohortId!);
      return page;
    });
    await And('the register is empty for the new cohort', async () => {
      const b = await register(page);
      expect(b.cohortId).toBe(S.cohortId);
      expect(b.people).toHaveLength(0);
      expect(b.projects).toHaveLength(0);
      return page;
    });
    expect(errors).toEqual([]);
  });

  Scenario('An officer can read cohorts but not manage them', async ({ page }) => {
    await Given('I am signed in as an officer on Buildspace + Launchpad', async () => officer(page, 'officer', `/buildspace-launchpad?cohort=${S.cohortId}`));
    await Then('I can see the cohort switcher', async () => {
      await expect(page.locator('[data-cohort-select]')).toHaveValue(S.cohortId!);
      return page;
    });
    await But('I cannot create, edit or archive cohorts', async () => {
      await expect(page.locator('[data-new-cohort]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: `${COHORT} settings` })).toHaveCount(0);
      const r = await page.request.post('/api/buildspace-launchpad/cohorts', { data: { name: `nope ${RUN}`, startsOn: '2026-01-01' } });
      expect(r.status()).toBe(403);
      return page;
    });
  });

  Scenario("A director invites builders by pasting a list", async ({ page }) => {
    const errors = watchErrors(page);
    await Given("I am a director on the new cohort's Invites tab", async () => {
      await officer(page, 'director', `/buildspace-launchpad?cohort=${S.cohortId}&tab=invites`);
      await expect(page.locator('[data-invites-panel]')).toBeVisible();
      return page;
    });
    await When('I paste two new emails, a duplicate and an invalid line', async () => {
      await page.locator('[data-invite-builders]').first().click();
      await page.locator('[data-invite-input]').fill(`${A.name}, ${A.email}\n${B.name}, ${B.email}\n${A.email}\nnot-an-email`);
      return page;
    });
    await Then('the preview shows 2 valid, 1 duplicate and 1 invalid row', async () => {
      const preview = page.locator('[data-invite-preview]');
      await expect(preview.locator('li[data-state="valid"]')).toHaveCount(2);
      await expect(preview.locator('li[data-state="duplicate"]')).toHaveCount(1);
      await expect(preview.locator('li[data-state="invalid"]')).toHaveCount(1);
      await expect(page.locator('[data-invite-send]')).toHaveText(/Invite 2 builders/);
      return page;
    });
    await When('I send the invites as links', async () => {
      await page.getByLabel('Just give me the links to share').check();
      await page.locator('[data-invite-send]').click();
      await expect(page.locator('[data-invite-result]')).toBeVisible();
      return page;
    });
    await Then('I get one join link per new builder', async () => {
      const rows = page.locator('[data-invite-links] li');
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        const email = (await row.locator('.lp-invite-email').innerText()).trim();
        const url = (await row.locator('code.lp-link').innerText()).trim();
        expect(url).toMatch(/\/launchpad\/join\?token=/);
        S.links[email] = new URL(url).pathname + new URL(url).search;
      }
      expect(Object.keys(S.links).sort()).toEqual([A.email, B.email].sort());
      return page;
    });
    await And('both invites are listed as invited', async () => {
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-invites-table] tr[data-status="invited"]')).toHaveCount(2);
      return page;
    });
    expect(errors).toEqual([]);
  });

  Scenario('The first builder accepts the invite and starts a project', async ({ browser }) => {
    const a = await portalPage(browser, 'A');
    await Given('the first builder opens their join link', async () => {
      await a.goto(S.links[A.email]!);
      await settle(a);
      await expect(a.locator('[data-join-state="valid"]')).toBeVisible();
      return a;
    });
    await Then('the join page shows the cohort, the builder role and a masked email', async () => {
      const box = a.locator('[data-join-state="valid"]');
      await expect(box).toContainText(COHORT);
      await expect(box).toContainText('Builder');
      await expect(box).toContainText(`a•••@${DOMAIN}`);
      await expect(box).not.toContainText(A.email);
      const token = new URL(S.links[A.email]!, 'http://x').searchParams.get('token')!;
      await expect(a.locator('[data-join-continue]')).toHaveAttribute('href', `/auth/login?launchpad=${encodeURIComponent(token)}`);
      return a;
    });
    await When('they continue with Discord account A', async () => {
      expect(await acceptInvite(a, S.links[A.email]!, A.discord)).toBe('/launchpad');
      await settle(a);
      return a;
    });
    await Then('they see the setup wizard', async () => {
      await expect(a.locator('[data-onboarding]')).toHaveAttribute('data-step', 'You');
      await expect(a.getByLabel('Your name')).toHaveValue(A.name);
      return a;
    });
    await When('they enter their name, pronouns, role on the team and bio', async () => {
      await a.getByLabel('Pronouns · optional').fill('she/her');
      await a.getByLabel('Your role on the team · optional').fill('Founder');
      await a.getByLabel('A line about you · optional').fill('Math major who loves engines.');
      return a;
    });
    await And('they start a new Software project', async () => {
      await a.locator('[data-onboarding-next]').click();
      await expect(a.locator('[data-onboarding]')).toHaveAttribute('data-step', 'Project');
      await a.getByRole('radio', { name: /Start a new project/ }).check();
      await a.getByLabel('Project name').fill(PROJECT);
      await a.getByLabel('Track').selectOption('Software');
      await a.getByLabel('What are you building? · optional').fill('A study-room finder for campus.');
      return a;
    });
    await And('they confirm their setup', async () => {
      await a.locator('[data-onboarding-next]').click();
      await expect(a.locator('[data-onboarding]')).toHaveAttribute('data-step', 'Confirm');
      await expect(a.locator('[data-onboarding]')).toContainText(PROJECT);
      const shot = a;
      await a.screenshot({ path: `${SHOTS}/04-confirm-before-submit.png` });
      await a.locator('[data-onboarding-next]').click();
      return shot;
    });
    await Then('their dashboard shows their name, role on the team and project', async () => {
      await expect(a.locator('[data-builder-dashboard]')).toBeVisible();
      await expect(a.getByRole('heading', { level: 1 })).toHaveText('Hi Ada');
      await expect(a.locator('.portal-hero')).toContainText('Founder · she/her');
      await expect(a.locator('[data-card="project"]')).toContainText(PROJECT);
      await expect(a.locator('[data-card="mentors"]')).toContainText('No mentor yet');
      return a;
    });
    await And('their dashboard fits a phone screen', async () => {
      await phoneShot(a, 'builder-dashboard');
    });
  });

  Scenario("The second builder joins the existing project", async ({ browser, page }) => {
    const b = await portalPage(browser, 'B');
    await Given('the second builder accepts their invite with Discord account B', async () => {
      await b.goto(S.links[B.email]!);
      await settle(b);
      await acceptInvite(b, S.links[B.email]!, B.discord);
      await settle(b);
      await expect(b.locator('[data-onboarding]')).toBeVisible();
      return b;
    });
    await When("they complete setup by joining the first builder's project", async () => {
      await b.getByLabel('Your role on the team · optional').fill('Hardware lead');
      await b.locator('[data-onboarding-next]').click();
      await expect(b.getByRole('radio', { name: /Join a project/ })).toBeChecked();
      const choice = b.locator('[data-joinable]').filter({ hasText: PROJECT });
      await expect(choice).toContainText(`With ${A.name}`);
      await choice.locator('input').check();
      await b.screenshot({ path: `${SHOTS}/05-join-choice.png` });
      await b.locator('[data-onboarding-next]').click();
      await b.locator('[data-onboarding-next]').click();
      await expect(b.locator('[data-builder-dashboard]')).toBeVisible();
      return b;
    });
    await Then('the team card lists both builders', async () => {
      const team = b.locator('[data-card="team"]');
      await expect(team).toContainText(A.name);
      await expect(team).toContainText(B.name);
      await expect(team).toContainText('Hardware lead');
      // Remember the IDs officers will act on.
      await officer(page);
      const reg = await register(page);
      S.projectId = reg.projects.find((p: { name: string }) => p.name === PROJECT).id;
      S.personA = reg.people.find((p: { name: string }) => p.name === A.name).id;
      const pb = reg.people.find((p: { name: string }) => p.name === B.name);
      S.personB = pb.id;
      S.accountB = pb.accountId;
      return b;
    });
  });

  Scenario('An invite link works only once', async ({ browser }) => {
    const c = await portalPage(browser, 'C');
    await When("someone opens the first builder's link again with Discord account C", async () => {
      expect(await acceptInvite(c, S.links[A.email]!, DISCORD(3))).toBe('/launchpad/join?error=used');
      await settle(c);
      return c;
    });
    await Then('they are told the invite was already used', async () => {
      await expect(c.locator('[data-join-error="used"]')).toContainText('already accepted');
      const me = await c.request.get('/api/portal/me');
      expect(me.status()).toBe(401);
      return c;
    });
  });

  Scenario('Officers see accepted invites and linked builders', async ({ page }) => {
    const errors = watchErrors(page);
    await Given("I am a director on the new cohort's Invites tab", async () => officer(page, 'director', `/buildspace-launchpad?cohort=${S.cohortId}&tab=invites`));
    await Then('both invites show as active', async () => {
      await expect(page.locator('[data-invites-table] tr[data-status="active"]')).toHaveCount(2);
      await expect(page.locator('[data-invites-table] tr[data-status="invited"]')).toHaveCount(0);
      return page;
    });
    await And('the People register lists both builders with active portal accounts', async () => {
      await page.goto(`/buildspace-launchpad?cohort=${S.cohortId}`);
      await settle(page);
      for (const n of [A.name, B.name]) await expect(page.locator('.bs-table').getByRole('row', { name: new RegExp(`^${n}`) })).toContainText('Portal active');
      const reg = await register(page);
      for (const id of [S.personA, S.personB]) {
        const p = reg.people.find((x: { id: string }) => x.id === id);
        expect(p.accountStatus).toBe('active');
        expect(p.discordId).toMatch(/^\d{17,20}$/);
      }
      return page;
    });
    expect(errors).toEqual([]);
  });

  Scenario('A builder posts a weekly check-in', async ({ browser, page }) => {
    const a = await portalPage(browser, 'A');
    await Given('the first builder is on their dashboard', async () => portal(a));
    await When('they post a weekly check-in', async () => {
      const form = a.locator('[data-entry-form="weekly"]');
      await form.getByLabel('Your update').fill(CHECKIN);
      await form.getByRole('button', { name: 'Post check-in' }).click();
      await expect(a.getByText('Check-in posted.')).toBeVisible();
      return a;
    });
    await Then('this week shows as done', async () => {
      await expect(a.locator('[data-card="week"] [data-week="done"]')).toBeVisible();
      await expect(a.locator('[data-card="timeline"]')).toContainText(CHECKIN);
      return a;
    });
    await And("officers see the check-in on the builder's timeline", async () => {
      await officer(page, 'director', `/buildspace-launchpad?cohort=${S.cohortId}&person=${S.personA}`);
      await page.getByRole('tab', { name: 'Timeline' }).click();
      await expect(page.locator('#buildspace-person')).toContainText(CHECKIN);
      return page;
    });
  });

  Scenario('A director invites a mentor to the mentor portal', async ({ browser, page }) => {
    const errors = watchErrors(page);
    await Given('a new mentor contact exists with no portal account', async () => {
      await officer(page, 'director', `/buildspace-launchpad?cohort=${S.cohortId}&tab=mentors`);
      const c = await page.request.post('/api/contacts', { data: { name: MENTOR.name, type: 'mentor', org: 'BDD Labs', topics: ['Software'], email: MENTOR.email } });
      expect(c.ok()).toBe(true);
      S.mentorId = (await c.json()).contact.id;
      // Earlier runs' mentors step aside so this run's auto-assign is deterministic.
      const reg = await register(page);
      for (const m of reg.mentors) {
        if (m.name.startsWith('BDD Mentor ') && m.id !== S.mentorId && m.available) {
          expect((await page.request.put(`/api/buildspace-launchpad/mentors/${m.id}/settings`, { data: { available: false, maxProjects: null } })).ok()).toBe(true);
        }
      }
      await page.reload();
      await settle(page);
      await expect(page.locator(`tr[data-mentor="${S.mentorId}"]`)).toContainText('No account');
      return page;
    });
    await When('I invite the mentor from the Mentors tab with link delivery', async () => {
      await page.locator(`tr[data-mentor="${S.mentorId}"] [data-mentor-invite]`).click();
      const dialog = page.locator('#lp-mentor-invite');
      await expect(dialog.locator('input[name=email]')).toHaveValue(MENTOR.email);
      await dialog.getByLabel('Just give me the link').check();
      await dialog.getByRole('button', { name: 'Send invite' }).click();
      return page;
    });
    await Then('I get a single-use mentor join link', async () => {
      const result = page.locator('[data-mentor-invite-result]');
      await expect(result).toContainText('it works once, for 14 days');
      const url = (await result.locator('code').innerText()).trim();
      S.mentorLink = new URL(url).pathname + new URL(url).search;
      return page;
    });
    const m = await portalPage(browser, 'M');
    await When('the mentor accepts it with Discord account D', async () => {
      await m.goto(S.mentorLink!);
      await settle(m);
      await expect(m.locator('[data-join-state="valid"]')).toContainText('Mentor');
      await acceptInvite(m, S.mentorLink!, MENTOR.discord);
      await settle(m);
      return m;
    });
    await Then('the mentor dashboard shows no projects yet', async () => {
      await expect(m.locator('[data-mentor-dashboard]')).toBeVisible();
      await expect(m.locator('[data-mentor-project]')).toHaveCount(0);
      return m;
    });
    expect(errors).toEqual([]);
  });

  Scenario("Auto-assign gives the unmentored project to the least-loaded mentor", async ({ browser, page }) => {
    const errors = watchErrors(page);
    await Given("I am a director on the new cohort's Mentors tab", async () => officer(page, 'director', `/buildspace-launchpad?cohort=${S.cohortId}&tab=mentors`));
    await When('I open Auto-assign mentors', async () => {
      await page.locator('[data-auto-assign-open]').click();
      const dialog = page.locator('#lp-auto-assign');
      await expect(dialog.locator('[data-auto-assign]')).toBeVisible();
      await expect(dialog.locator('[aria-busy="true"]')).toHaveCount(0);
      return page;
    });
    await Then("the preview proposes the cohort's project for the new mentor", async () => {
      const rows = page.locator('#lp-auto-assign [data-auto-assign-table] tr[data-assignment]');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(PROJECT);
      await expect(rows.first()).toContainText(MENTOR.name);
      await expect(rows.first()).toContainText('0 → 1');
      return page;
    });
    await When('I apply the assignments', async () => {
      await page.locator('#lp-auto-assign [data-auto-assign-apply]').click();
      await expect(page.locator('#lp-auto-assign [data-auto-assign]')).toBeHidden();
      return page;
    });
    await Then('the project lists the new mentor', async () => {
      const reg = await register(page);
      expect(reg.projects.find((p: { id: string }) => p.id === S.projectId).mentorIds).toEqual([S.mentorId]);
      await page.goto(`/buildspace-launchpad?cohort=${S.cohortId}&project=${S.projectId}`);
      await settle(page);
      await expect(page.locator('dialog[open]')).toContainText(MENTOR.name);
      return page;
    });
    const m = await portalPage(browser, 'M');
    await And('the mentor dashboard shows the project', async () => {
      await portal(m);
      await expect(m.locator('[data-mentor-project]')).toHaveCount(1);
      await expect(m.locator('[data-mentor-project]')).toContainText(PROJECT);
      return m;
    });
    expect(errors).toEqual([]);
  });

  Scenario('Mentor notes respect who can see them', async ({ browser }) => {
    const m = await portalPage(browser, 'M');
    const a = await portalPage(browser, 'A');
    const note = m.locator('#mentor-project [data-mentor-note]');
    await Given('the mentor opens the assigned project', async () => {
      await portal(m);
      await m.locator('[data-mentor-project]').first().getByRole('button', { name: 'Open project' }).click();
      await expect(m.locator('#mentor-project [data-mentor-detail]')).toBeVisible();
      await expect(m.locator('#mentor-project')).toContainText(A.name);
      await expect(m.locator('#mentor-project')).toContainText(CHECKIN);
      return m;
    });
    await When('they add a note shared with the builders', async () => {
      await note.getByLabel('Note').fill(SHARED_NOTE);
      await note.getByLabel('Share with the builders too').check();
      await note.getByRole('button', { name: 'Add note' }).click();
      await expect(m.getByText('Note shared with the team.')).toBeVisible();
      return m;
    });
    await And('they add a note for mentors and officers only', async () => {
      await note.getByLabel('Note').fill(PRIVATE_NOTE);
      await note.getByLabel('Mentors and officers only').check();
      await note.getByRole('button', { name: 'Add note' }).click();
      await expect(m.getByText('Note saved for mentors and officers.')).toBeVisible();
      await expect(m.locator('#mentor-project')).toContainText(PRIVATE_NOTE);
      return m;
    });
    await Then("the builder's timeline shows the shared note", async () => {
      await portal(a);
      await expect(a.locator('[data-card="timeline"]')).toContainText(SHARED_NOTE);
      await expect(a.locator('[data-card="mentors"]')).toContainText(MENTOR.name);
      return a;
    });
    await But("the builder's timeline does not show the mentors-only note", async () => {
      await expect(a.locator('[data-card="timeline"]')).not.toContainText(PRIVATE_NOTE);
      const api = await (await a.request.get('/api/portal/builder')).text();
      expect(api).not.toContain(PRIVATE_NOTE);
      return a;
    });
    await And('the mentor dashboard fits a phone screen', async () => {
      await m.keyboard.press('Escape');
      await phoneShot(m, 'mentor-dashboard');
    });
  });

  Scenario('Archiving a builder pauses their portal access until restored', async ({ browser, page }) => {
    const b = await portalPage(browser, 'B');
    page.on('dialog', (d) => void d.accept());
    await Given('I am a director viewing the second builder', async () => {
      await officer(page, 'director', `/buildspace-launchpad?cohort=${S.cohortId}&person=${S.personB}`);
      await expect(page.locator('#buildspace-person')).toContainText(B.name);
      return page;
    });
    await When('I archive the second builder', async () => {
      await page.locator('[data-person-action="lifecycle-archive"]').first().click();
      await expect.poll(async () => (await register(page, true)).people.find((p: { id: string }) => p.id === S.personB).archivedAt).not.toBeNull();
      return page;
    });
    await Then('their portal says access is paused', async () => {
      await b.goto('/launchpad');
      // Archiving ended the session; signing in again is refused with the archived reason.
      await expect(b).toHaveURL(/\/launchpad\/login/);
      const res = await b.request.post('/auth/dev', { form: { as: 'builder', user: S.accountB!, next: '/launchpad' }, maxRedirects: 0 });
      expect(res.status()).toBe(400);
      await b.goto('/launchpad/login?error=archived');
      await expect(b.locator('[data-login-error="archived"]')).toContainText('paused');
      return b;
    });
    await And('the portal API refuses them as archived', async () => {
      expect((await b.request.get('/api/portal/me')).status()).toBe(401);
      const reg = await register(page, true);
      expect(reg.people.find((p: { id: string }) => p.id === S.personB).accountStatus).toBe('active');
      return b;
    });
    await When('I restore the second builder', async () => {
      await page.goto(`/buildspace-launchpad?cohort=${S.cohortId}&archived=1&person=${S.personB}`);
      await settle(page);
      await page.locator('[data-person-action="lifecycle-restore"]').first().click();
      await expect.poll(async () => {
        const p = (await register(page)).people.find((x: { id: string }) => x.id === S.personB);
        return p ? p.archivedAt : 'missing';
      }).toBeNull();
      return page;
    });
    await Then('they can use their dashboard again', async () => {
      await devSignIn(b, { as: 'builder', user: S.accountB! }, '/launchpad');
      await settle(b);
      await expect(b.locator('[data-builder-dashboard]')).toBeVisible();
      await expect(b.locator('[data-card="team"]')).toContainText(A.name);
      return b;
    });
  });

  Scenario('Delete is only for records without history', async ({ page }) => {
    page.on('dialog', (d) => void d.accept());
    const emptyId = `bdd-empty-${RUN}`;
    await Given('I am a director viewing the first builder', async () => {
      await officer(page, 'director', `/buildspace-launchpad?cohort=${S.cohortId}&person=${S.personA}`);
      return page;
    });
    await When('I try to delete the first builder', async () => {
      await page.locator('[data-person-action="lifecycle-delete"]').first().click();
      return page;
    });
    await Then('I am told to archive instead because they have history', async () => {
      await expect(page.getByText('Has activity history: archive instead.')).toBeVisible();
      expect((await page.request.delete(`/api/buildspace-launchpad/people/${S.personA}`)).status()).toBe(409);
      expect((await register(page)).people.some((p: { id: string }) => p.id === S.personA)).toBe(true);
      return page;
    });
    await When('I add an empty project to the cohort and delete it', async () => {
      const put = await page.request.put(`/api/buildspace-launchpad/projects/${emptyId}`, {
        data: { name: `Empty ${RUN}`, description: '', track: 'Hardware', stage: 'Ideating', links: [], mentorIds: [], cohortId: S.cohortId },
      });
      expect(put.ok()).toBe(true);
      await page.goto(`/buildspace-launchpad?cohort=${S.cohortId}&project=${emptyId}`);
      await settle(page);
      await expect(page.locator('[data-lifecycle="delete"]')).toBeEnabled();
      await page.locator('[data-lifecycle="delete"]').click();
      return page;
    });
    await Then('the project is gone from the register', async () => {
      await expect.poll(async () => (await register(page, true)).projects.some((p: { id: string }) => p.id === emptyId)).toBe(false);
      await page.goto(`/buildspace-launchpad?cohort=${S.cohortId}&tab=projects`);
      await settle(page);
      await expect(page.locator('main')).not.toContainText(`Empty ${RUN}`);
      return page;
    });
  });

  Scenario('Portal sessions are walled off from the officer dashboard', async ({ browser }) => {
    const a = await portalPage(browser, 'A');
    await Given('the first builder is signed in to the portal', async () => {
      await portal(a);
      await expect(a.locator('[data-builder-dashboard]')).toBeVisible();
      return a;
    });
    await Then('officer APIs answer 401 to their portal session', async () => {
      for (const path of ['/api/buildspace-launchpad', '/api/me', '/api/members']) expect((await a.request.get(path)).status(), path).toBe(401);
    });
    await And('the mentor portal API answers 403 to a builder', async () => {
      expect((await a.request.get('/api/portal/mentor')).status()).toBe(403);
    });
    const anon = await portalPage(browser, 'anon');
    await When('a signed-out visitor opens the portal', async () => {
      await anon.goto('/launchpad');
      return anon;
    });
    await Then('they are sent to the portal sign-in page', async () => {
      await expect(anon).toHaveURL(/\/launchpad\/login$/);
      await expect(anon.locator('[data-portal-signin]')).toHaveAttribute('href', '/auth/login?portal=1');
      return anon;
    });
  });

  Scenario('Archiving a cohort makes it read-only', async ({ browser, page }) => {
    page.on('dialog', (d) => void d.accept());
    const a = await portalPage(browser, 'A');
    await Given('I am a director viewing the new cohort', async () => officer(page, 'director', `/buildspace-launchpad?cohort=${S.cohortId}`));
    await When('I archive the cohort', async () => {
      await page.getByRole('button', { name: `${COHORT} settings` }).click();
      await page.getByRole('menuitem', { name: 'Archive cohort' }).click();
      await expect(page.getByText(`${COHORT} archived.`)).toBeVisible();
      return page;
    });
    await Then('the register shows a read-only banner', async () => {
      await expect(page.getByText('is archived, so it is read-only')).toBeVisible();
      await expect(page.locator('[data-invite-builders]')).toHaveCount(0);
      return page;
    });
    await And("the first builder's dashboard is read-only", async () => {
      await portal(a);
      await expect(a.getByText('has ended and is archived. Everything here is read-only.')).toBeVisible();
      await expect(a.locator('[data-entry-form]')).toHaveCount(0);
      const post = await a.request.post('/api/portal/builder/activity', { data: { kind: 'weekly', date: '2026-11-16', body: 'late', status: 'on-track' } });
      expect(post.status()).toBe(409);
      return a;
    });
  });
});

test('features/launchpad.feature matches the implemented steps', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  expect(bddDrift(`${here}features/launchpad.feature`, `${here}launchpad.bdd.spec.ts`)).toEqual([]);
});
