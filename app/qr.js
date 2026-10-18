/**
 * A small QR encoder, enough for a join link.
 *
 * The invite screen shows a code the class scans off the teacher's phone, so
 * one has to be drawn. The app's Content-Security-Policy is `script-src
 * 'self'`, which rules out pulling a library off a CDN, and an image service
 * would send every teacher's join link to a third party. So it is written
 * here: byte mode, error correction level M, versions 1 to 10, which covers
 * a URL of up to 213 characters - far more than a join link needs.
 *
 * The output is an SVG string, so it scales to any screen and prints cleanly
 * without a canvas.
 */

/* ------------------------------------------------------- Galois field ---- */

/* QR arithmetic happens in GF(256) with the polynomial 0x11d. These two
   tables turn the multiplications into additions of logarithms. */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial for `degree` error-correction bytes. */
function generator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon remainder: the error-correction bytes for one block. */
function ecBytes(data, count) {
  const gen = generator(count);
  const out = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.shift();
    out.push(0);
    for (let i = 0; i < count; i += 1) out[i] ^= mul(gen[i + 1], factor);
  }
  return out;
}

/* ------------------------------------------------------------- tables ---- */

/* Per version (1-10) at error-correction level M:
   [ total codewords, ec codewords per block, block count ]. */
const VERSIONS = [
  [26, 10, 1], // 1
  [44, 16, 1], // 2
  [70, 26, 1], // 3
  [100, 18, 2], // 4
  [134, 24, 2], // 5
  [172, 16, 4], // 6
  [196, 18, 4], // 7
  [242, 22, 4], // 8
  [292, 22, 5], // 9
  [346, 26, 5], // 10
];

/* Where the alignment patterns sit, per version. */
const ALIGN = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/** Format information for level M and each mask, already BCH-encoded. */
const FORMAT_M = [
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
];

/* ------------------------------------------------------------ encoding --- */

/** UTF-8 bytes, so a non-Latin link still scans. */
const utf8 = (text) => [...new TextEncoder().encode(String(text))];

/** The smallest version that fits, or null when the text is too long. */
function pickVersion(byteCount) {
  for (let v = 1; v <= 10; v += 1) {
    const [total, ecPer, blocks] = VERSIONS[v - 1];
    const capacity = total - ecPer * blocks;
    const header = 4 + (v < 10 ? 8 : 16);
    if (byteCount + Math.ceil(header / 8) <= capacity) return v;
  }
  return null;
}

/** Mode indicator, length, payload, terminator and padding, as bytes. */
function buildData(bytes, version) {
  const [total, ecPer, blocks] = VERSIONS[version - 1];
  const capacity = total - ecPer * blocks;
  const lengthBits = version < 10 ? 8 : 16;

  const bits = [];
  const push = (value, count) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, lengthBits);
  for (const byte of bytes) push(byte, 8);

  // Terminator, then pad to a whole byte.
  for (let i = 0; i < 4 && bits.length < capacity * 8; i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  // The standard's alternating pad bytes.
  const PAD = [0xec, 0x11];
  while (data.length < capacity) data.push(PAD[data.length % 2 ? 1 : 0]);
  return data;
}

/** Split into blocks, add error correction, and interleave as the spec says. */
function withErrorCorrection(data, version) {
  const [, ecPer, blockCount] = VERSIONS[version - 1];
  const shortLength = Math.floor(data.length / blockCount);
  const longBlocks = data.length % blockCount;

  const blocks = [];
  let at = 0;
  for (let i = 0; i < blockCount; i += 1) {
    const length = shortLength + (i >= blockCount - longBlocks ? 1 : 0);
    const block = data.slice(at, at + length);
    at += length;
    blocks.push({ data: block, ec: ecBytes(block, ecPer) });
  }

  const out = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ecPer; i += 1) for (const block of blocks) out.push(block.ec[i]);
  return out;
}

/* ------------------------------------------------------------- drawing --- */

function blankMatrix(size) {
  return {
    cells: Array.from({ length: size }, () => new Array(size).fill(null)),
    size,
  };
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= m.size || cc >= m.size) continue;
      const edge = r === -1 || r === 7 || c === -1 || c === 7;
      const ring = (r === 0 || r === 6) && c >= 0 && c <= 6;
      const side = (c === 0 || c === 6) && r >= 0 && r <= 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m.cells[rr][cc] = edge ? 0 : ring || side || core ? 1 : 0;
    }
  }
}

function placeAlignment(m, version) {
  const centres = ALIGN[version];
  for (const r of centres) {
    for (const c of centres) {
      if (m.cells[r][c] !== null) continue; // overlaps a finder
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const edge = Math.max(Math.abs(dr), Math.abs(dc));
          m.cells[r + dr][c + dc] = edge === 1 ? 0 : 1;
        }
      }
    }
  }
}

function placeTiming(m) {
  for (let i = 8; i < m.size - 8; i += 1) {
    const bit = i % 2 === 0 ? 1 : 0;
    if (m.cells[6][i] === null) m.cells[6][i] = bit;
    if (m.cells[i][6] === null) m.cells[i][6] = bit;
  }
}

/** The format area has to be reserved before the data is laid out. */
function reserveFormat(m) {
  for (let i = 0; i < 9; i += 1) {
    if (m.cells[8][i] === null) m.cells[8][i] = 0;
    if (m.cells[i][8] === null) m.cells[i][8] = 0;
  }
  for (let i = 0; i < 8; i += 1) {
    if (m.cells[8][m.size - 1 - i] === null) m.cells[8][m.size - 1 - i] = 0;
    if (m.cells[m.size - 1 - i][8] === null) m.cells[m.size - 1 - i][8] = 0;
  }
  m.cells[m.size - 8][8] = 1; // the always-dark module
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Walk the zig-zag from the bottom right, skipping the reserved column 6. */
function placeData(m, bytes, mask) {
  const taken = m.cells.map((row) => row.map((cell) => cell !== null));
  let bit = 0;
  const next = () => {
    const byte = bytes[bit >> 3];
    const value = byte === undefined ? 0 : (byte >> (7 - (bit & 7))) & 1;
    bit += 1;
    return value;
  };

  let upward = true;
  for (let right = m.size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1; // the vertical timing pattern
    for (let step = 0; step < m.size; step += 1) {
      const row = upward ? m.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (taken[row][col]) continue;
        const value = next();
        m.cells[row][col] = MASKS[mask](row, col) ? value ^ 1 : value;
      }
    }
    upward = !upward;
  }
}

function placeFormat(m, mask) {
  const bits = FORMAT_M[mask];
  const at = (i) => (bits >> i) & 1;
  for (let i = 0; i <= 5; i += 1) m.cells[8][i] = at(14 - i);
  m.cells[8][7] = at(8);
  m.cells[8][8] = at(7);
  m.cells[7][8] = at(6);
  for (let i = 9; i <= 14; i += 1) m.cells[14 - i][8] = at(14 - i);

  for (let i = 0; i <= 7; i += 1) m.cells[m.size - 1 - i][8] = at(i);
  for (let i = 8; i <= 14; i += 1) m.cells[8][m.size - 15 + i] = at(i);
  m.cells[m.size - 8][8] = 1;
}

/** The spec's penalty score, used to choose the mask that reads best. */
function penalty(m) {
  const n = m.size;
  let score = 0;

  for (const line of [true, false]) {
    for (let a = 0; a < n; a += 1) {
      let run = 1;
      for (let b = 1; b < n; b += 1) {
        const prev = line ? m.cells[a][b - 1] : m.cells[b - 1][a];
        const cell = line ? m.cells[a][b] : m.cells[b][a];
        if (cell === prev) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  for (let r = 0; r < n - 1; r += 1) {
    for (let c = 0; c < n - 1; c += 1) {
      const v = m.cells[r][c];
      if (v === m.cells[r][c + 1] && v === m.cells[r + 1][c] && v === m.cells[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  let dark = 0;
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) dark += m.cells[r][c];
  const pct = (dark * 100) / (n * n);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

/** Build the module grid for some text, choosing the version and the mask. */
export function qrMatrix(text) {
  const bytes = utf8(text);
  const version = pickVersion(bytes.length);
  if (!version) throw new Error('That link is too long for a QR code');

  const codewords = withErrorCorrection(buildData(bytes, version), version);
  const size = version * 4 + 17;

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = blankMatrix(size);
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    placeAlignment(m, version);
    placeTiming(m);
    reserveFormat(m);
    placeData(m, codewords, mask);
    placeFormat(m, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { m, score };
  }
  return best.m.cells;
}

/**
 * The code as an SVG string.
 *
 * Drawn as one path of squares rather than a rect per module, so a version-3
 * code is a few hundred bytes instead of a few thousand.
 */
export function qrSvg(text, { size = 220, quiet = 4, dark = '#000', light = '#fff' } = {}) {
  const cells = qrMatrix(text);
  const n = cells.length;
  const span = n + quiet * 2;

  let path = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (cells[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"
    viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img">
    <rect width="${span}" height="${span}" fill="${light}"/>
    <path d="${path}" fill="${dark}"/>
  </svg>`;
}
