/**
 * The intro's arcade snake (V0.10, redrawn in V0.11). Pure functions, no DOM: `buildPlan` lays a
 * grid over the viewport and plans, tick by tick, a classic snake. It moves one cell per tick with
 * 90° turns and grows by keeping its tail still on the tick it eats a seed. It crosses the
 * greeting, leaves the right edge, wraps to a lane above the word, drops into the "c" and eats the
 * seeds laid along the word. When it stops, its body is exactly `WORD_PATH`, which writes
 * "cseed" on the grid, and a sapling sprouts after the d: the real wordmark, drawn in cells.
 *
 * V0.11: the glyphs follow the real wordmark (`public/images/cseed-wordmark.png`): lowercase,
 * round, bold, 4 cells wide and 5 tall, with the d's ascender one row taller. Each letter is
 * written in one natural pen stroke. Between letters the snake travels under the board ("lift"
 * cells): those cells are never drawn and pass quickly, like a pen lifted between letters.
 */

export interface Cell {
  x: number;
  y: number;
}
/** What a route cell is: the greeting pass, the way round to the word, a letter of the word, or a hidden lift between letters. */
export type CellKind = 'greet' | 'approach' | 'letter' | 'lift';
export interface RouteCell extends Cell {
  kind: CellKind;
}

/** 4-wide glyphs: x-height letters are 5 rows, the d 6 (its stem rises one row above the others). */
export const GLYPHS: Record<string, string[]> = {
  c: ['####', '#...', '#...', '#...', '####'],
  s: ['####', '#...', '####', '...#', '####'],
  e: ['####', '#..#', '####', '#...', '####'],
  d: ['...#', '####', '#..#', '#..#', '#..#', '####'],
};
/**
 * Each glyph's pen stroke (glyph coordinates, in order): the c and the s from the top right, the
 * e round its eye to the crossbar and then down and along the bottom, the d's bowl first and then
 * up its stem, so the head finishes on top of the d. (An e has a junction where the crossbar
 * meets the left side, so one end of any single stroke has to sit next to it.)
 */
const STROKES: Record<string, [number, number][]> = {
  c: [[3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4]],
  s: [[3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [3, 2], [3, 3], [3, 4], [2, 4], [1, 4], [0, 4]],
  e: [[0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [2, 2], [1, 2], [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4]],
  d: [[2, 1], [1, 1], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 5], [2, 5], [3, 5], [3, 4], [3, 3], [3, 2], [3, 1], [3, 0]],
};
export const WORD = 'cseed';
/** Letters are 4 cells wide with 1 empty column between them, as tight as the real wordmark. */
export const LETTER_PITCH = 5;
export const WORD_COLS = 24;
export const WORD_ROWS = 6;

const key = (x: number, y: number) => `${x},${y}`;

/** The cells of each letter of "cseed", in word coordinates (row 0 = the top of the d). */
export function letterCells(): Set<string> {
  const out = new Set<string>();
  WORD.split('').forEach((ch, i) => {
    const g = GLYPHS[ch]!;
    const top = WORD_ROWS - g.length;
    g.forEach((row, r) => [...row].forEach((v, c) => v === '#' && out.add(key(i * LETTER_PITCH + c, top + r))));
  });
  return out;
}

/** Where the approach drops into the word: straight down onto the first cell of the c's stroke. */
const ENTRY_COL = STROKES.c![0]![0];

/**
 * The snake's final body, tail first: every letter's stroke in reading order, joined by the
 * shortest hidden lift through empty cells (row 0 to one row under the baseline, never through
 * a letter, a lift already used, or the approach's way in).
 */
export const WORD_PATH: readonly RouteCell[] = (() => {
  const letters = letterCells();
  const used = new Set<string>();
  for (let y = 0; y < 1; y++) used.add(key(ENTRY_COL, y)); // the approach's last cell above the c
  const out: RouteCell[] = [];
  const lift = (from: Cell, to: Cell) => {
    // BFS through empty, unused cells from `from` to `to` (both letter cells, not included).
    const prev = new Map<string, string | null>([[key(from.x, from.y), null]]);
    const queue: Cell[] = [from];
    const goal = key(to.x, to.y);
    while (queue.length) {
      const p = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [0, 1], [0, -1], [-1, 0]] as const) {
        const q = { x: p.x + dx, y: p.y + dy };
        const k = key(q.x, q.y);
        if (prev.has(k)) continue;
        if (k === goal) {
          const path: Cell[] = [];
          for (let r = key(p.x, p.y); r !== key(from.x, from.y); r = prev.get(r)!) {
            const [x, y] = r.split(',').map(Number);
            path.unshift({ x: x!, y: y! });
          }
          return path;
        }
        if (letters.has(k) || used.has(k) || q.x < -1 || q.x > WORD_COLS || q.y < 0 || q.y > WORD_ROWS) continue;
        prev.set(k, key(p.x, p.y));
        queue.push(q);
      }
    }
    throw new Error(`no lift from ${key(from.x, from.y)} to ${goal}`);
  };
  WORD.split('').forEach((ch, i) => {
    const top = WORD_ROWS - GLYPHS[ch]!.length;
    const cells = STROKES[ch]!.map(([x, y]) => ({ x: i * LETTER_PITCH + x, y: top + y }));
    const last = out[out.length - 1];
    if (last) for (const c of lift(last, cells[0]!)) {
      used.add(key(c.x, c.y));
      out.push({ ...c, kind: 'lift' });
    }
    for (const c of cells) out.push({ ...c, kind: 'letter' });
  });
  return out;
})();

/**
 * Corners to round once the word is written, so the cells read as the wordmark's round, bold
 * letters: the outer corner of every cell where a stroke turns (two letter neighbours at a right
 * angle). Ends of strokes and junctions stay square. Keyed by word cell: 'tl' | 'tr' | 'br' | 'bl'.
 */
export function roundCorners(): Map<string, 'tl' | 'tr' | 'br' | 'bl'> {
  const L = letterCells();
  const out = new Map<string, 'tl' | 'tr' | 'br' | 'bl'>();
  for (const k of L) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    const up = L.has(key(x, y - 1));
    const down = L.has(key(x, y + 1));
    const left = L.has(key(x - 1, y));
    const right = L.has(key(x + 1, y));
    if (+up + +down + +left + +right !== 2 || (up && down) || (left && right)) continue;
    out.set(k, down && right ? 'tl' : down && left ? 'tr' : up && left ? 'br' : 'bl');
  }
  return out;
}

/**
 * The real wordmark (`cseed-wordmark.png`, 156×36) measured in word cells: its "cseed" ink spans
 * x 0–115 with the baseline at the bottom (y 36) and the x-height 25px, and its sapling
 * spans x 117–155, y 7–35. One cell is 115/24 image px, so the 24-column word lines up with the
 * image's letters and `LOGO` is the whole image box in word coordinates.
 */
const U = 115 / WORD_COLS;
export const LOGO = { x: 0, y: WORD_ROWS - 36 / U, w: 156 / U, h: 36 / U } as const;
/** The sapling that sprouts after the d, in word cells: the square sapling SVG (see brand/sapling.ts), sized and centred on the image's sapling. */
export const SPROUT = (() => {
  const w = (155 - 117) / U / (50.6 / 56); // the SVG's painted width is 50.6/56 of its box
  const cx = (117 + 155) / 2 / U;
  const cy = WORD_ROWS - (36 - (7 + 35) / 2) / U;
  return { x: cx - w / 2, y: cy - w / 2, size: w };
})();

/** Length of the snake when it first appears; it grows by one per seed from there. */
export const START_LENGTH = 6;

export interface PlanInput {
  vw: number;
  vh: number;
  /** Where the greeting sits, so its strips vanish as the head passes. */
  text: { left: number; right: number; top: number; bottom: number };
  /** The page logo's box; the written word shrinks into it. `mark` = the rail's sapling mark. */
  target: { x: number; y: number; w: number; h: number; kind?: 'wordmark' | 'mark' };
}

export interface Plan {
  /** Cell size (px) and the grid: `cols × rows` cells, the first one's corner at (ox, oy). */
  C: number;
  cols: number;
  rows: number;
  ox: number;
  oy: number;
  /** Grid cell of the word's top-left corner. */
  gx0: number;
  gy0: number;
  /** Every cell the head visits, in order. */
  route: RouteCell[];
  /** Route index the head reaches when it wraps (the pause while the seeds pop in) / when it enters the word. */
  wrapAt: number;
  wordFrom: number;
  /** Route indices that hold a seed (each one: the tail stays put on that tick). */
  apples: number[];
  /** Per tick: the head's route index and the body length. Tick 0 is the snake's first frame. */
  ticks: { head: number; len: number; ate: boolean }[];
  /** ms at which each tick starts. */
  at: number[];
  /** ms per tick on the way to the word (greeting pass and approach). */
  stepApproach: number;
  /** ms: the snake is complete and writes the word. */
  spelledAt: number;
  /** ms: the word starts shrinking into the logo, and when it is there. */
  morphAt: number;
  morphEnd: number;
  /** Total ms until the hand-off can start. */
  duration: number;
  /** The word's box (px), the whole wordmark's box (px, word + sapling) and the sprouted sapling's box (px). */
  word: { x: number; y: number; w: number; h: number };
  logo: { x: number; y: number; w: number; h: number };
  sprout: { x: number; y: number; size: number };
  /** The transform (on the snake layer, origin 0 0) that maps the drawn wordmark onto the page logo. */
  morph: { tx: number; ty: number; s: number };
  /** Vertical strips of the greeting with the ms at which the head reaches each. */
  slices: { x0: number; x1: number; eatAt: number }[];
  /** The body (route indices, head first) at tick `t`. */
  body(t: number): number[];
  /** Pixel corner of a grid cell. */
  px(c: Cell): { x: number; y: number };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Timing. On the way to the word the snake moves at a deliberate arcade pace: about 3.4s for the
 * whole greeting pass and approach, never faster than 44ms or slower than 70ms a cell. It writes
 * the word a little faster (so the growth reads as writing), and a hidden lift between letters
 * passes in a blink.
 */
export const APPROACH_MS = 3400;
export const STEP_MIN = 44;
export const STEP_MAX = 70;
export const STEP_WORD = 34;
export const STEP_LIFT = 9;
/** ms the snake waits off-screen while the seeds pop in; then the hold on the written word (the sapling sprouts); then the shrink. */
export const WRAP_HOLD = 360;
export const SPELL_HOLD = 1000;
export const MORPH_MS = 640;

/** Cell size: the wordmark (word + sapling) takes about 70% of a wide screen and the full width (less a 12px gutter each side) on a phone. */
export function cellSize(vw: number): number {
  return clamp(Math.floor((vw < 600 ? vw - 24 : Math.min(vw * 0.7, 1120)) / LOGO.w), 10, 34);
}

export function buildPlan(input: PlanInput): Plan {
  const { vw, vh, text, target } = input;
  const C = cellSize(vw);
  const cols = Math.ceil(vw / C) + 1;
  const rows = Math.ceil(vh / C) + 1;
  const ox = (vw - cols * C) / 2;
  const oy = (vh - rows * C) / 2;
  // Centre the whole wordmark (word + sapling), keeping a lane of 3 rows above the word for the approach.
  const gx0 = Math.floor((cols - LOGO.w) / 2);
  const gy0 = Math.max(4, Math.floor((rows - WORD_ROWS) / 2));
  const L0 = START_LENGTH;

  /* ── Route ── */
  const route: RouteCell[] = [];
  // 1. In from the left on the word's middle row, out past the right edge until the whole body is gone.
  const mid = gy0 + 3;
  for (let x = -1; x <= cols + L0; x++) route.push({ x, y: mid, kind: 'greet' });
  // 2. Wrap (arcade style) to a lane three rows above the word, run right to the c's first column, drop down.
  const wrapAt = route.length;
  const lane = gy0 - 3;
  const first = WORD_PATH[0]!;
  for (let x = -L0; x <= gx0 + first.x; x++) route.push({ x, y: lane, kind: 'approach' });
  for (let y = lane + 1; y < gy0 + first.y; y++) route.push({ x: gx0 + first.x, y, kind: 'approach' });
  // 3. The word, tail cell first.
  const wordFrom = route.length;
  for (const c of WORD_PATH) route.push({ x: gx0 + c.x, y: gy0 + c.y, kind: c.kind });

  // Seeds on every word cell after the first L0: arriving with length L0 and eating on every
  // tick from there leaves the tail on the word's first cell, so the final body is the word.
  const apples: number[] = [];
  for (let i = wordFrom + L0; i < route.length; i++) apples.push(i);
  const appleSet = new Set(apples);

  /* ── Ticks ── */
  const stepApproach = Math.round(clamp(APPROACH_MS / wordFrom, STEP_MIN, STEP_MAX));
  const ticks: Plan['ticks'] = [{ head: 0, len: L0, ate: false }];
  const at: number[] = [0];
  let t = 0;
  for (let head = 1; head < route.length; head++) {
    const prev = ticks[ticks.length - 1]!;
    const ate = appleSet.has(head);
    const kind = route[head]!.kind;
    t += head < wordFrom ? stepApproach : kind === 'lift' ? STEP_LIFT : STEP_WORD;
    if (head === wrapAt) t += WRAP_HOLD;
    ticks.push({ head, len: prev.len + (ate ? 1 : 0), ate });
    at.push(t);
  }
  const spelledAt = t;
  const morphAt = spelledAt + SPELL_HOLD;
  const morphEnd = morphAt + MORPH_MS;

  const px = (c: Cell) => ({ x: ox + c.x * C, y: oy + c.y * C });
  const w0 = px({ x: gx0, y: gy0 });
  const word = { x: w0.x, y: w0.y, w: WORD_COLS * C, h: WORD_ROWS * C };
  const logo = { x: w0.x + LOGO.x * C, y: w0.y + LOGO.y * C, w: LOGO.w * C, h: LOGO.h * C };
  const sprout = { x: w0.x + SPROUT.x * C, y: w0.y + SPROUT.y * C, size: SPROUT.size * C };
  // The wordmark lands on the page's wordmark box; on the rail, the sapling lands on the sapling mark.
  const from = target.kind === 'mark' ? { x: sprout.x, y: sprout.y, w: sprout.size, h: sprout.size } : logo;
  const s = Math.min(target.w / from.w, target.h / from.h);
  const morph = { s, tx: target.x + target.w / 2 - (from.x + from.w / 2) * s, ty: target.y + target.h / 2 - (from.y + from.h / 2) * s };

  // The greeting vanishes in vertical strips as the head's leading edge reaches each one.
  const SLICE = 24;
  const slices: Plan['slices'] = [];
  const sx0 = Math.floor(text.left - 8);
  const sx1 = Math.ceil(text.right + 8);
  for (let x = sx0; x < sx1; x += SLICE) {
    const col = Math.floor((x + SLICE / 2 - ox) / C); // the column whose cell covers the strip's middle
    const head = clamp(col + 1, 0, wrapAt - 1); // route index of that column (route starts at x = -1)
    slices.push({ x0: x, x1: Math.min(x + SLICE, sx1), eatAt: at[head]! });
  }

  const body = (tick: number) => {
    const { head, len } = ticks[clamp(tick, 0, ticks.length - 1)]!;
    const out: number[] = [];
    for (let i = head; i > head - len && i >= 0; i--) out.push(i);
    return out;
  };

  return {
    C,
    cols,
    rows,
    ox,
    oy,
    gx0,
    gy0,
    route,
    wrapAt,
    wordFrom,
    apples,
    ticks,
    at,
    stepApproach,
    spelledAt,
    morphAt,
    morphEnd,
    duration: morphEnd,
    word,
    logo,
    sprout,
    morph,
    slices,
    body,
    px,
  };
}

/** Text picture of a set of word cells (`#` letter, `+` hidden lift, `.` empty), for tests and docs. */
export function picture(cells: readonly RouteCell[], gx0: number, gy0: number): string {
  const grid = Array.from({ length: WORD_ROWS + 1 }, () => Array<string>(WORD_COLS + 1).fill('.'));
  for (const c of cells) {
    const x = c.x - gx0;
    const y = c.y - gy0;
    if (x >= 0 && x <= WORD_COLS && y >= 0 && y <= WORD_ROWS) grid[y]![x] = c.kind === 'lift' ? '+' : '#';
  }
  return grid.map((r) => r.join('')).join('\n');
}
