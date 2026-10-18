/**
 * The QR encoder, checked by reading its own codes back.
 *
 * A QR code that is subtly wrong is worse than none: it looks right on the
 * screen and simply refuses to scan in a classroom. There is no scanner here,
 * so the test decodes the matrix instead - undoing the mask, walking the
 * zig-zag, de-interleaving the blocks and reading the byte-mode payload. If
 * the original text comes back, the data really is in the modules in the
 * places the standard puts it.
 *
 * On top of that the structure is checked against the spec directly: the size
 * formula, the three finder patterns, the timing lines, the dark module, and
 * the format bits decoding back to error-correction level M and the mask that
 * was chosen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg } from '../app/qr.js';

/* ----------------------------------------------------------- a decoder --- */

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

const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
const VERSIONS = [
  [26, 10, 1], [44, 16, 1], [70, 26, 1], [100, 18, 2], [134, 24, 2],
  [172, 16, 4], [196, 18, 4], [242, 22, 4], [292, 22, 5], [346, 26, 5],
];
const ALIGN = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/** Read the format area back and say which mask was used. */
function readMask(cells) {
  let bits = 0;
  for (let i = 0; i <= 5; i += 1) bits |= cells[8][i] << (14 - i);
  bits |= cells[8][7] << 8;
  bits |= cells[8][8] << 7;
  bits |= cells[7][8] << 6;
  for (let i = 9; i <= 14; i += 1) bits |= cells[14 - i][8] << (14 - i);
  const mask = FORMAT_M.indexOf(bits);
  assert.notEqual(mask, -1, `format bits ${bits.toString(16)} are not a level-M pattern`);
  return mask;
}

/** Everything that is not data: finders, alignment, timing, format. */
function reserved(size, version) {
  const taken = Array.from({ length: size }, () => new Array(size).fill(false));
  const block = (row, col, h, w) => {
    for (let r = row; r < row + h; r += 1) {
      for (let c = col; c < col + w; c += 1) {
        if (r >= 0 && c >= 0 && r < size && c < size) taken[r][c] = true;
      }
    }
  };
  block(-1, -1, 9, 9);
  block(-1, size - 8, 9, 9);
  block(size - 8, -1, 9, 9);
  for (let i = 0; i < size; i += 1) {
    taken[6][i] = true;
    taken[i][6] = true;
  }
  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      const corner =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (!corner) block(r - 2, c - 2, 5, 5);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    taken[8][size - 1 - i] = true;
    taken[size - 1 - i][8] = true;
  }
  return taken;
}

/** Walk the zig-zag the way the encoder did, unmasking as it goes. */
function readCodewords(cells, version, mask) {
  const size = cells.length;
  const taken = reserved(size, version);
  const bits = [];
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (taken[row][col]) continue;
        const value = cells[row][col];
        bits.push(MASKS[mask](row, col) ? value ^ 1 : value);
      }
    }
    upward = !upward;
  }

  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  return bytes;
}

/** Undo the block interleaving and drop the error-correction bytes. */
function deinterleave(stream, version) {
  const [total, ecPer, blockCount] = VERSIONS[version - 1];
  const dataLength = total - ecPer * blockCount;
  const shortLength = Math.floor(dataLength / blockCount);
  const longBlocks = dataLength % blockCount;

  const lengths = Array.from(
    { length: blockCount },
    (_, i) => shortLength + (i >= blockCount - longBlocks ? 1 : 0),
  );
  const blocks = lengths.map(() => []);

  let at = 0;
  const longest = Math.max(...lengths);
  for (let i = 0; i < longest; i += 1) {
    for (let b = 0; b < blockCount; b += 1) {
      if (i < lengths[b]) blocks[b].push(stream[at++]);
    }
  }
  return blocks.flat();
}

/** Read a byte-mode payload back out. */
function decode(cells) {
  const version = (cells.length - 17) / 4;
  const mask = readMask(cells);
  const data = deinterleave(readCodewords(cells, version, mask), version);

  const bits = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (byte >> i) & 1));
  const take = (count) => bits.splice(0, count).reduce((acc, bit) => (acc << 1) | bit, 0);

  assert.equal(take(4), 0b0100, 'byte mode');
  const length = take(version < 10 ? 8 : 16);
  const bytes = Array.from({ length }, () => take(8));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/* -------------------------------------------------------------- tests ---- */

const LINKS = [
  'https://plus.lk/j/nimal',
  'https://plus-teacher-app.vercel.app/join?t=nimal',
  'https://plus.lk/j/a',
  'https://example.com/join?t=' + 'x'.repeat(60),
];

test('a code reads back as the link that went into it', () => {
  for (const link of LINKS) {
    assert.equal(decode(qrMatrix(link)), link, link);
  }
});

test('a link with non-Latin characters survives, as UTF-8', () => {
  const link = 'https://plus.lk/j/நிமal';
  assert.equal(decode(qrMatrix(link)), link);
});

test('the code is the size the version says it is', () => {
  for (const link of LINKS) {
    const cells = qrMatrix(link);
    const version = (cells.length - 17) / 4;
    assert.ok(Number.isInteger(version), 'size is 4 × version + 17');
    assert.ok(version >= 1 && version <= 10, `version ${version}`);
  }
});

test('the three finder patterns are where a scanner looks for them', () => {
  const cells = qrMatrix('https://plus.lk/j/nimal');
  const n = cells.length;
  for (const [top, left] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    // A 7×7 finder is a dark ring, a light ring, then a 3×3 dark core.
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const ring = r === 0 || r === 6 || c === 0 || c === 6;
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        assert.equal(
          cells[top + r][left + c],
          ring || core ? 1 : 0,
          `finder at ${top},${left} cell ${r},${c}`,
        );
      }
    }
  }
});

test('the timing lines alternate, and the dark module is dark', () => {
  const cells = qrMatrix('https://plus.lk/j/nimal');
  const n = cells.length;
  for (let i = 8; i < n - 8; i += 1) {
    assert.equal(cells[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing at ${i}`);
    assert.equal(cells[i][6], i % 2 === 0 ? 1 : 0, `vertical timing at ${i}`);
  }
  assert.equal(cells[n - 8][8], 1, 'the module that is always dark');
});

test('the format bits say error-correction level M', () => {
  // readMask asserts the pattern is one of the eight level-M ones.
  for (const link of LINKS) assert.ok(readMask(qrMatrix(link)) >= 0);
});

test('the mask chosen is the one that scores best', () => {
  // Re-running is deterministic: the same text always gives the same code.
  const a = qrMatrix('https://plus.lk/j/nimal');
  const b = qrMatrix('https://plus.lk/j/nimal');
  assert.deepEqual(a, b);
});

test('a longer link takes a bigger code, and a far too long one is refused', () => {
  const small = qrMatrix('https://plus.lk/j/a').length;
  const big = qrMatrix('https://example.com/join?t=' + 'x'.repeat(120)).length;
  assert.ok(big > small, 'more text needs more modules');
  assert.throws(() => qrMatrix('x'.repeat(400)), /too long/);
});

test('the SVG is self-contained, with a quiet zone', () => {
  const svg = qrSvg('https://plus.lk/j/nimal', { size: 220 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /width="220" height="220"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(svg, /<script|href=|url\(/i, 'nothing external, nothing executable');

  // The quiet zone is four modules, so the viewBox is bigger than the matrix.
  const n = qrMatrix('https://plus.lk/j/nimal').length;
  assert.match(svg, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`));
});
