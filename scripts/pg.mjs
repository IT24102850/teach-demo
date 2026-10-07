/**
 * A very small PostgreSQL client - enough to run migrations, nothing more.
 *
 * Why this exists: the app itself never talks to Postgres directly (it goes
 * through PostgREST, see api/_lib/db.js), so there is no database driver in
 * the project and no npm dependency to install. But applying and checking a
 * migration needs a real connection, so this implements just the parts of the
 * wire protocol that a migration needs:
 *
 *   TLS upgrade -> SCRAM-SHA-256 login -> simple Query -> rows or an error
 *
 * It is deliberately not a connection pool and not a production driver.
 */

import net from 'node:net';
import tls from 'node:tls';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const PROTOCOL_VERSION = 196608; // 3.0
const SSL_REQUEST_CODE = 80877103;

/* ------------------------------------------------------------- encoding -- */

function message(type, payload = Buffer.alloc(0)) {
  const head = Buffer.alloc(type ? 5 : 4);
  let at = 0;
  if (type) head.writeUInt8(type.charCodeAt(0), at++);
  head.writeInt32BE(payload.length + 4, at);
  return Buffer.concat([head, payload]);
}

const cstring = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);

function startup(params) {
  const parts = [Buffer.alloc(4)];
  parts[0].writeInt32BE(PROTOCOL_VERSION, 0);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    parts.push(cstring(key), cstring(String(value)));
  }
  parts.push(Buffer.from([0]));
  return message(null, Buffer.concat(parts.slice(0)).subarray(0));
}

/* -------------------------------------------------------------- parsing -- */

function readFields(body) {
  const out = {};
  let at = 0;
  while (at < body.length && body[at] !== 0) {
    const code = String.fromCharCode(body[at]);
    at += 1;
    const end = body.indexOf(0, at);
    out[code] = body.toString('utf8', at, end);
    at = end + 1;
  }
  return out;
}

function readRowDescription(body) {
  const count = body.readInt16BE(0);
  const fields = [];
  let at = 2;
  for (let i = 0; i < count; i += 1) {
    const end = body.indexOf(0, at);
    fields.push(body.toString('utf8', at, end));
    at = end + 1 + 18; // tableOid, colNo, typeOid, typeSize, typeMod, format
  }
  return fields;
}

function readDataRow(body) {
  const count = body.readInt16BE(0);
  const values = [];
  let at = 2;
  for (let i = 0; i < count; i += 1) {
    const len = body.readInt32BE(at);
    at += 4;
    if (len === -1) {
      values.push(null);
    } else {
      values.push(body.toString('utf8', at, at + len));
      at += len;
    }
  }
  return values;
}

export class PgError extends Error {
  constructor(fields) {
    super(fields.M || 'database error');
    this.code = fields.C;
    this.detail = fields.D;
    this.hint = fields.H;
    this.position = fields.P;
    this.where = fields.W;
    this.severity = fields.S;
  }
  /** "42601 syntax error at or near … (at character 1234)" */
  describe() {
    const bits = [this.code, this.message];
    if (this.detail) bits.push(`detail: ${this.detail}`);
    if (this.hint) bits.push(`hint: ${this.hint}`);
    if (this.position) bits.push(`at character ${this.position}`);
    return bits.filter(Boolean).join(' · ');
  }
}

/* ------------------------------------------------------------------ SCRAM */

function scramClientFinal(password, serverFirst, clientNonce, clientFirstBare) {
  const parsed = Object.fromEntries(
    serverFirst.split(',').map((kv) => [kv.slice(0, 1), kv.slice(2)]),
  );
  const serverNonce = parsed.r;
  if (!serverNonce || !serverNonce.startsWith(clientNonce)) {
    throw new Error('the server sent a nonce that does not match ours');
  }
  const salt = Buffer.from(parsed.s, 'base64');
  const iterations = Number(parsed.i);

  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();

  const withoutProof = `c=biws,r=${serverNonce}`;
  const authMessage = `${clientFirstBare},${serverFirst},${withoutProof}`;
  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();

  const proof = Buffer.alloc(clientKey.length);
  for (let i = 0; i < clientKey.length; i += 1) proof[i] = clientKey[i] ^ clientSignature[i];

  const serverKey = createHmac('sha256', saltedPassword).update('Server Key').digest();
  const serverSignature = createHmac('sha256', serverKey).update(authMessage).digest();

  return {
    final: `${withoutProof},p=${proof.toString('base64')}`,
    expectedServerSignature: serverSignature.toString('base64'),
  };
}

/* ------------------------------------------------------------- the client */

export async function connect({ host, port = 5432, user, password, database = 'postgres', timeout = 30_000 }) {
  const socket = await new Promise((resolve, reject) => {
    const plain = net.connect({ host, port });
    plain.setTimeout(timeout);
    plain.once('timeout', () => {
      plain.destroy();
      reject(new Error(`timed out connecting to ${host}:${port}`));
    });
    plain.once('error', reject);
    plain.once('connect', () => {
      plain.removeAllListeners('error');
      plain.write(message(null, (() => { const b = Buffer.alloc(4); b.writeInt32BE(SSL_REQUEST_CODE, 0); return b; })()));
      plain.once('data', (reply) => {
        if (reply.toString('utf8', 0, 1) !== 'S') {
          plain.destroy();
          reject(new Error('the server refused TLS'));
          return;
        }
        const secure = tls.connect({ socket: plain, servername: host, rejectUnauthorized: false });
        secure.once('secureConnect', () => resolve(secure));
        secure.once('error', reject);
      });
    });
  });

  socket.setTimeout(0);

  /* One message pump. Handlers are swapped as the connection changes phase. */
  let buffer = Buffer.alloc(0);
  let onMessage = () => {};
  let fatal = null;

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 5) {
      const length = buffer.readInt32BE(1);
      if (buffer.length < length + 1) break;
      const type = String.fromCharCode(buffer[0]);
      const body = buffer.subarray(5, length + 1);
      buffer = buffer.subarray(length + 1);
      onMessage(type, body);
    }
  });
  socket.on('error', (err) => {
    fatal = err;
  });
  socket.on('close', () => {
    fatal = fatal || new Error('the connection closed');
  });

  /** Wait until `done` says we are finished with this phase. */
  const phase = (handle) =>
    new Promise((resolve, reject) => {
      onMessage = (type, body) => {
        if (type === 'E') {
          reject(new PgError(readFields(body)));
          return;
        }
        try {
          handle(type, body, resolve, reject);
        } catch (err) {
          reject(err);
        }
      };
      if (fatal) reject(fatal);
    });

  /* ------------------------------------------------------------- login -- */

  const clientNonce = randomBytes(18).toString('base64');
  const clientFirstBare = `n=*,r=${clientNonce}`;
  let scram = null;

  socket.write(startup({ user, database, application_name: 'plus-migrate' }));

  await phase((type, body, resolve, reject) => {
    if (type === 'R') {
      const auth = body.readInt32BE(0);

      if (auth === 10) {
        const mechanisms = body.toString('utf8', 4).split('\0').filter(Boolean);
        if (!mechanisms.includes('SCRAM-SHA-256')) {
          reject(new Error(`unsupported login methods: ${mechanisms.join(', ')}`));
          return;
        }
        const payload = Buffer.concat([
          cstring('SCRAM-SHA-256'),
          (() => { const b = Buffer.alloc(4); b.writeInt32BE(Buffer.byteLength(`n,,${clientFirstBare}`), 0); return b; })(),
          Buffer.from(`n,,${clientFirstBare}`, 'utf8'),
        ]);
        socket.write(message('p', payload));
        return;
      }

      if (auth === 11) {
        scram = scramClientFinal(password, body.toString('utf8', 4), clientNonce, clientFirstBare);
        socket.write(message('p', Buffer.from(scram.final, 'utf8')));
        return;
      }

      if (auth === 12) {
        const sent = body.toString('utf8', 4);
        const signature = sent.startsWith('v=') ? sent.slice(2) : '';
        if (signature !== scram.expectedServerSignature) {
          reject(new Error('the server failed to prove it knows the password'));
        }
        return;
      }

      if (auth === 0) return; // AuthenticationOk
      if (auth === 3) {
        reject(new Error('the server asked for a cleartext password; refusing'));
        return;
      }
      reject(new Error(`unsupported authentication request ${auth}`));
      return;
    }
    if (type === 'Z') resolve();
  });

  /* ------------------------------------------------------------- query -- */

  async function query(sql) {
    const results = [];
    const notices = [];
    let current = { command: null, fields: [], rows: [] };

    socket.write(message('Q', cstring(sql)));

    await phase((type, body, resolve) => {
      switch (type) {
        case 'T':
          current.fields = readRowDescription(body);
          break;
        case 'D':
          current.rows.push(readDataRow(body));
          break;
        case 'C':
          current.command = body.toString('utf8', 0, body.length - 1);
          results.push(current);
          current = { command: null, fields: [], rows: [] };
          break;
        case 'N':
          notices.push(readFields(body));
          break;
        case 'I': // empty query
          break;
        case 'Z':
          resolve();
          break;
        default:
          break;
      }
    });

    return { results, notices };
  }

  /** `select` convenience: array of plain objects from the last statement. */
  async function rows(sql) {
    const { results } = await query(sql);
    const last = results[results.length - 1];
    if (!last) return [];
    return last.rows.map((row) => Object.fromEntries(last.fields.map((f, i) => [f, row[i]])));
  }

  function end() {
    try {
      socket.write(message('X'));
    } catch {
      /* already gone */
    }
    socket.destroy();
  }

  return { query, rows, end };
}
