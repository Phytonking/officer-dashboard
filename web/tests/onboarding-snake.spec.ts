import { expect, test } from '@playwright/test';
import { buildPlan, cellSize, GLYPHS, LOGO, letterCells, picture, roundCorners, START_LENGTH, STEP_LIFT, STEP_WORD, WORD_COLS, WORD_PATH, WORD_ROWS, type Plan } from '../src/ui/onboarding/snakePlan';

/** V0.10/V0.11 hello screen: the arcade snake's planner (pure functions, no browser; run once). */
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'unit tests run once'));

const VIEWPORTS: [number, number][] = [[1440, 900], [1100, 800], [1099, 800], [900, 1180], [820, 1180], [390, 844], [360, 640]];
const plan = (vw: number, vh: number, kind: 'wordmark' | 'mark' = 'wordmark'): Plan =>
  buildPlan({ vw, vh, text: { left: vw * 0.15, right: vw * 0.85, top: vh * 0.45, bottom: vh * 0.55 }, target: kind === 'mark' ? { x: 18, y: 22, w: 28, h: 28, kind } : { x: 20, y: 26.75, w: 78, h: 18, kind } });

/**
 * The written word as text: `#` = a letter cell, `+` = a hidden lift between letters (never drawn),
 * with one row under the baseline. Round, 4-wide letters like the real wordmark; the d's stem rises
 * just one row above the rest; nothing but letters is ever drawn.
 */
const CSEED = [
  '....+++++..........++++#.',
  '####+####.####.####+####.',
  '#...+#...+#..#+#..#+#..#.',
  '#...+####+####+####+#..#.',
  '#...+...#+#...+#...+#..#.',
  '####+####+####+####+####.',
  '.....+++++...............',
].join('\n');

test('V0.11 glyphs: x-height letters 4×5, the d only one row taller', () => {
  for (const ch of 'cse') expect(GLYPHS[ch], ch).toHaveLength(5);
  expect(GLYPHS.d).toHaveLength(6);
  for (const g of Object.values(GLYPHS)) for (const row of g) expect(row).toHaveLength(4);
  expect(WORD_ROWS).toBe(6);
});

const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;

test('the word path is one self-avoiding grid route of 90° steps that covers every letter cell', () => {
  expect(new Set(WORD_PATH.map(key)).size).toBe(WORD_PATH.length);
  for (let i = 1; i < WORD_PATH.length; i++) {
    const a = WORD_PATH[i - 1]!;
    const b = WORD_PATH[i]!;
    expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), `step ${i}`).toBe(1);
  }
  const letters = letterCells();
  for (const c of letters) expect(WORD_PATH.some((p) => key(p) === c), c).toBe(true);
  expect(letters.size).toBe(70);
  // Each letter is one unbroken stroke: letter cells come in exactly five runs, c-s-e-e-d, left to right.
  const runs: string[][] = [];
  WORD_PATH.forEach((c, i) => {
    if (c.kind !== 'letter') return;
    if (i === 0 || WORD_PATH[i - 1]!.kind !== 'letter') runs.push([]);
    runs[runs.length - 1]!.push(key(c));
  });
  expect(runs).toHaveLength(5);
  runs.forEach((r, i) => r.forEach((k) => expect(Math.floor(+k.split(',')[0]! / 5), k).toBe(i)));
  // Every other cell is a hidden lift, and none of them is a letter cell.
  for (const c of WORD_PATH) expect(c.kind === 'letter').toBe(letters.has(key(c)));
  // The head ends on top of the d's stem.
  expect(key(WORD_PATH[WORD_PATH.length - 1]!)).toBe('23,0');
});

test('round corners only where a stroke turns', () => {
  const r = roundCorners();
  expect(r.get('0,1')).toBe('tl'); // the c's top left
  expect(r.get('0,5')).toBe('bl');
  expect(r.has('3,1')).toBe(false); // the c's ends stay square
  expect(r.has('20,1')).toBe(true); // the d's bowl
  expect(r.has('23,1')).toBe(false); // the d's stem meets its bowl: a junction, square
});

for (const [vw, vh] of VIEWPORTS) {
  test(`${vw}×${vh}: the snake ends with its body spelling "cseed"`, () => {
    const p = plan(vw, vh);
    const last = p.ticks.length - 1;
    const body = p.body(last).map((i) => p.route[i]!);
    // Head first: the body is the word path reversed, tail on the top of the c, head on the top of the d.
    expect(body.map((c) => [c.x - p.gx0, c.y - p.gy0])).toEqual([...WORD_PATH].reverse().map((c) => [c.x, c.y]));
    expect(picture(body, p.gx0, p.gy0)).toBe(CSEED);
    // ...and the word is on screen with a margin.
    // ...and the whole wordmark (word + sprouted sapling) is on screen with a margin.
    expect(p.logo.x).toBeGreaterThanOrEqual(8);
    expect(p.logo.x + p.logo.w).toBeLessThanOrEqual(vw - 8);
    expect(p.logo.y).toBeGreaterThan(0);
    expect(p.logo.y + p.logo.h).toBeLessThan(vh);
    expect(p.sprout.x + p.sprout.size).toBeLessThanOrEqual(vw - 8);
  });

  test(`${vw}×${vh}: classic arcade movement and growth`, () => {
    const p = plan(vw, vh);
    // One cell per tick with 90° turns, except the single wrap from the right edge to the left.
    for (let i = 1; i < p.route.length; i++) {
      const a = p.route[i - 1]!;
      const b = p.route[i]!;
      if (i === p.wrapAt) {
        expect(a.x).toBeGreaterThan(p.cols); // off the right edge...
        expect(b.x).toBeLessThan(0); // ...back in from the left
        continue;
      }
      expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), `route step ${i}`).toBe(1);
    }
    let grew = 0;
    for (let t = 1; t < p.ticks.length; t++) {
      const before = p.body(t - 1);
      const after = p.body(t);
      expect(p.ticks[t]!.head).toBe(p.ticks[t - 1]!.head + 1);
      if (p.ticks[t]!.ate) {
        grew++;
        // Eating: the tail stays put for that step and the body is one longer.
        expect(after[after.length - 1], `tail at tick ${t}`).toBe(before[before.length - 1]);
        expect(after.length).toBe(before.length + 1);
      } else {
        // Moving: the tail follows (one cell along) and the length is unchanged.
        expect(after[after.length - 1]).toBe(before[before.length - 1]! + (t >= START_LENGTH ? 1 : 0));
        expect(after.length).toBe(Math.min(before.length + (t < START_LENGTH ? 1 : 0), START_LENGTH + grew));
      }
    }
    expect(grew).toBe(p.apples.length);
    expect(grew).toBe(WORD_PATH.length - START_LENGTH);
    // Every seed sits on a word cell and is eaten exactly when the head arrives.
    for (const a of p.apples) expect(['letter', 'lift']).toContain(p.route[a]!.kind);
    // Never doubles back on itself.
    for (let t = 0; t < p.ticks.length; t++) {
      const cells = p.body(t).map((i) => p.route[i]!).filter((c) => c.x >= 0 && c.x < p.cols).map((c) => `${c.x},${c.y}`);
      expect(new Set(cells).size, `tick ${t}`).toBe(cells.length);
    }
  });

  test(`${vw}×${vh}: thick cells, a deliberate approach, and the wordmark shrinks exactly onto the logo`, () => {
    const p = plan(vw, vh);
    expect(p.C).toBe(cellSize(vw));
    expect(p.C).toBeGreaterThanOrEqual(10);
    expect(p.word.w).toBe(WORD_COLS * p.C);
    // V0.11: visibly slower on the way to the seeds than while writing; lifts pass in a blink.
    expect(p.stepApproach).toBeGreaterThanOrEqual(44);
    expect(p.stepApproach).toBeGreaterThan(STEP_WORD);
    for (let i = 1; i < p.at.length; i++) {
      const dt = p.at[i]! - p.at[i - 1]!;
      const k = p.route[p.ticks[i]!.head]!.kind;
      if (i === p.wrapAt) continue;
      expect(dt, `tick ${i} (${k})`).toBe(i < p.wordFrom ? p.stepApproach : k === 'lift' ? STEP_LIFT : STEP_WORD);
    }
    // About 1s on the written word (the sapling sprouts), then the shrink; click to logo stays under 9s.
    expect(p.morphAt - p.spelledAt).toBe(1000);
    expect(p.duration).toBeLessThan(9000);
    expect(p.at.every((t, i) => i === 0 || t > p.at[i - 1]!)).toBe(true);
    // The drawn wordmark (the image's box in cells) maps exactly onto the logo box: same aspect, same box.
    const { s, tx, ty } = p.morph;
    expect(Math.abs(p.logo.w / p.logo.h - 156 / 36)).toBeLessThan(0.001);
    expect(Math.abs(p.logo.x * s + tx - 20)).toBeLessThan(0.01);
    expect(Math.abs(p.logo.y * s + ty - 26.75)).toBeLessThan(0.01);
    expect(Math.abs(p.logo.w * s - 78)).toBeLessThan(0.01);
    expect(Math.abs(p.logo.h * s - 18)).toBeLessThan(0.01);
    expect(LOGO.w).toBeCloseTo(156 / (115 / WORD_COLS), 6);
    // On the rail the sprouted sapling lands on the 28px sapling mark instead.
    const m = plan(vw, vh, 'mark');
    expect(Math.abs(m.sprout.x * m.morph.s + m.morph.tx - 18)).toBeLessThan(0.01);
    expect(Math.abs(m.sprout.size * m.morph.s - 28)).toBeLessThan(0.01);
    // The greeting strips go in order, left to right, before the wrap.
    for (let i = 1; i < p.slices.length; i++) expect(p.slices[i]!.eatAt).toBeGreaterThanOrEqual(p.slices[i - 1]!.eatAt);
    expect(p.slices[p.slices.length - 1]!.eatAt).toBeLessThan(p.at[p.wrapAt]!);
  });
}
