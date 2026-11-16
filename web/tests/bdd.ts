/**
 * A tiny Gherkin-style layer over Playwright for features/*.feature (see features/README.md).
 * Feature → test.describe, Scenario → test, Given/When/Then/And/But → test.step. A step returns
 * the page it acted on; that page is screenshotted to tmp/verify/<suite>/<NN-scenario>/<NN-step>.png.
 * The spec's step texts are checked against the .feature file (bddDrift), so they can't drift.
 */
import { readFileSync } from 'node:fs';
import { test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

type StepFn = () => Promise<Page | void>;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
let scenarioNo = 0;
let current = { dir: '', step: 0 };
let shotRoot = 'tmp/verify/bdd';
let fullPage = true;

export function Feature(name: string, opts: { shots: string }, body: () => void) {
  shotRoot = opts.shots;
  test.describe(`Feature: ${name}`, body);
}
export function Background(steps: () => Promise<void>) {
  test.beforeEach(async () => steps());
}
type Fixtures = { page: Page; browser: Browser; context: BrowserContext };
export function Scenario(name: string, body: (f: Fixtures, info: TestInfo) => Promise<void>) {
  const n = String(++scenarioNo).padStart(2, '0');
  const dir = `${shotRoot}/${n}-${slug(name)}`;
  test(`Scenario: ${name}`, async ({ page, browser, context }, info) => {
    current = { dir, step: 0 };
    await body({ page, browser, context }, info);
  });
}
/** Screenshots of later steps are viewport-only (drawers, dialogs) or full page (default). */
export function shotsFullPage(v: boolean) {
  fullPage = v;
}
const keyword = (kw: string) => async (text: string, fn: StepFn) =>
  test.step(`${kw} ${text}`, async () => {
    const page = await fn();
    const n = String(++current.step).padStart(2, '0');
    if (page && !page.isClosed()) await page.screenshot({ path: `${current.dir}/${n}-${kw.toLowerCase()}-${slug(text)}.png`, fullPage });
  });
export const Given = keyword('Given');
export const When = keyword('When');
export const Then = keyword('Then');
export const And = keyword('And');
export const But = keyword('But');

/**
 * Compares a .feature file with the spec source: every Scenario title and every step line in
 * the feature must be implemented in the spec in the same order, and vice versa. Returns the
 * differences (empty when they match).
 */
export function bddDrift(featurePath: string, specPath: string): string[] {
  const feature = readFileSync(featurePath, 'utf8').split('\n').map((l) => l.trim());
  const want: string[] = [];
  for (const l of feature) {
    const m = /^(Scenario|Background):\s*(.*)$/.exec(l);
    if (m) want.push(m[1] === 'Background' ? 'Background:' : `Scenario: ${m[2]}`);
    const s = /^(Given|When|Then|And|But)\s+(.*)$/.exec(l);
    if (s) want.push(`${s[1]} ${s[2]}`);
  }
  const src = readFileSync(specPath, 'utf8');
  const have: string[] = [];
  const re = /\b(Scenario|Background|Given|When|Then|And|But)\(\s*(?:(['"`])((?:\\.|(?!\2).)*)\2)?/g;
  for (const m of src.matchAll(re)) {
    if (m[1] === 'Background') have.push('Background:');
    else if (m[3] !== undefined) have.push(m[1] === 'Scenario' ? `Scenario: ${m[3].replace(/\\(.)/g, '$1')}` : `${m[1]} ${m[3].replace(/\\(.)/g, '$1')}`);
  }
  const out: string[] = [];
  const max = Math.max(want.length, have.length);
  for (let i = 0; i < max; i++) if (want[i] !== have[i]) out.push(`#${i + 1}: feature "${want[i] ?? '—'}" vs spec "${have[i] ?? '—'}"`);
  return out.slice(0, 10);
}
