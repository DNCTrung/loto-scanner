// Pure logic for the bingo/loto card scanner. No DOM, no network — testable in Node.

export const HEADERS = ['B', 'I', 'N', 'G', 'O'];

// Column n holds 15 numbers: B 1-15, I 16-30, N 31-45, G 46-60, O 61-75
export const COL_RANGES = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

export const FREE = null; // the centre cell

export function colForNumber(n) {
  if (!Number.isInteger(n) || n < 1 || n > 75) return -1;
  return Math.floor((n - 1) / 15);
}

export function isValidNumber(n) {
  return Number.isInteger(n) && n >= 1 && n <= 75;
}

/** 5x5 array of numbers (row-major). rows[2][2] === FREE */
export function emptyCard() {
  return Array.from({ length: 5 }, () => Array(5).fill(null));
}

export function makeCard(rows) {
  const card = emptyCard();
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) card[r][c] = rows?.[r]?.[c] ?? null;
  card[2][2] = FREE;
  return card;
}

/** Coerce OCR-ish values ("0", "FREE", "-", 4.0, " 12 ") into a number or null */
export function coerceCell(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  const s = String(value).trim().toUpperCase();
  if (!s || s === 'FREE' || s === 'F' || s === '-' || s === '★' || s === 'X') return null;
  const digits = s.replace(/[^0-9]/g, '');
  if (!digits) return null;
  return parseInt(digits, 10);
}

export function normalizeRows(input) {
  const card = emptyCard();
  const src = Array.isArray(input) ? input : [];
  for (let r = 0; r < 5; r++) {
    const row = Array.isArray(src[r]) ? src[r] : [];
    for (let c = 0; c < 5; c++) card[r][c] = coerceCell(row[c]);
  }
  card[2][2] = FREE;
  return card;
}

/** Problems with a card, as human readable strings (Vietnamese UI). */
export function validateCard(card) {
  const errors = [];
  if (!card) return ['Vé trống'];
  const seen = new Map();
  for (let c = 0; c < 5; c++) {
    const [lo, hi] = COL_RANGES[c];
    let filled = 0;
    for (let r = 0; r < 5; r++) {
      if (r === 2 && c === 2) continue;
      const n = card[r][c];
      if (n === null || n === undefined) {
        errors.push(`Ô ${HEADERS[c]}${r + 1} còn trống`);
        continue;
      }
      filled++;
      if (!isValidNumber(n)) {
        errors.push(`${n} không phải số 1–75`);
      } else if (n < lo || n > hi) {
        errors.push(`Cột ${HEADERS[c]} chỉ nhận ${lo}–${hi}, thấy ${n}`);
      }
      if (seen.has(n)) errors.push(`Số ${n} bị trùng`);
      else seen.set(n, true);
    }
    if (filled === 0) errors.push(`Cột ${HEADERS[c]} chưa có số nào`);
  }
  return [...new Set(errors)];
}

export function isCardComplete(card) {
  return validateCard(card).length === 0;
}

/** All 12 winning lines: 5 rows, 5 columns, 2 diagonals. */
export function allLines() {
  const lines = [];
  for (let r = 0; r < 5; r++) {
    lines.push({ type: 'row', index: r, name: `hàng ${r + 1}`, cells: range(5).map((c) => [r, c]) });
  }
  for (let c = 0; c < 5; c++) {
    lines.push({ type: 'col', index: c, name: `cột ${HEADERS[c]}`, cells: range(5).map((r) => [r, c]) });
  }
  lines.push({
    type: 'diag',
    index: 0,
    name: 'chéo ↘',
    cells: range(5).map((i) => [i, i]),
  });
  lines.push({
    type: 'diag',
    index: 1,
    name: 'chéo ↙',
    cells: range(5).map((i) => [i, 4 - i]),
  });
  return lines;
}

function range(n) {
  return Array.from({ length: n }, (_, i) => i);
}

export const RULES = {
  line: { id: 'line', label: '1 hàng (ngang/dọc/chéo)' },
  two: { id: 'two', label: '2 hàng' },
  x: { id: 'x', label: 'Chữ X (2 đường chéo)' },
  corners: { id: 'corners', label: '4 góc' },
  blackout: { id: 'blackout', label: 'Full vé (blackout)' },
};

export function isMarked(card, r, c, called) {
  if (r === 2 && c === 2) return true;
  const n = card?.[r]?.[c];
  return isValidNumber(n) && called.has(n);
}

/**
 * @returns {{wins: Array, progress: {best:number, line:object|null}, needed:number}}
 */
export function evaluateCard(card, called, rule = 'line') {
  const lines = allLines().map((line) => {
    const cells = line.cells.map(([r, c]) => ({ r, c, n: card[r][c], marked: isMarked(card, r, c, called) }));
    const marked = cells.filter((x) => x.marked).length;
    return { ...line, cells, marked, total: 5, complete: marked === 5 };
  });

  const complete = lines.filter((l) => l.complete);
  const best = lines.reduce((a, b) => (b.marked > a.marked ? b : a), lines[0]);

  let wins = [];
  if (rule === 'line') wins = complete.slice(0, 1);
  else if (rule === 'two') wins = complete.length >= 2 ? complete.slice(0, 2) : [];
  else if (rule === 'x') {
    const diags = complete.filter((l) => l.type === 'diag');
    if (diags.length === 2) wins = diags;
  } else if (rule === 'corners') {
    const corners = [
      [0, 0],
      [0, 4],
      [4, 0],
      [4, 4],
    ];
    if (corners.every(([r, c]) => isMarked(card, r, c, called))) {
      wins = [{ type: 'corners', name: '4 góc', cells: corners.map(([r, c]) => ({ r, c, marked: true })) }];
    }
  } else if (rule === 'blackout') {
    const total = 25;
    const marked = range(5).reduce(
      (sum, r) => sum + range(5).filter((c) => isMarked(card, r, c, called)).length,
      0,
    );
    if (marked === total) wins = [{ type: 'blackout', name: 'full vé', cells: [] }];
  }

  return { wins, progress: { best: best.marked, line: best }, lines };
}

/** Numbers 1..75 that appear on this card (free space excluded). */
export function cardNumbers(card) {
  const out = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (isValidNumber(card[r][c])) out.push(card[r][c]);
  return out;
}

export function parseCallInput(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = text.match(/\d{1,2}/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  return isValidNumber(n) ? n : null;
}

export function rowsToText(card) {
  return card.map((row) => row.map((n) => (n === null ? 'FREE' : n)).join('\t')).join('\n');
}

export function lastCalled(calledList) {
  return calledList.length ? calledList[calledList.length - 1] : null;
}

/** Which of the 75 numbers were called, for the board UI. */
export function calledSet(calledList) {
  return new Set(calledList.filter(isValidNumber));
}

export function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
