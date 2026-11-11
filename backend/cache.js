'use strict';
/* Cache abstraction: in-memory Map by default; Redis when REDIS_URL is set.
 * Redis uses raw RESP over node:net (no new deps). Minimal GET/SET/DEL with expiry.
 * API: get(key) -> value|null, set(key, value, ttlSec), del(key). Values are JSON. */

const net = require('node:net');

const mem = new Map(); // key -> {value, expiresAt}
let redis = null;      // {socket, ...} or null
let redisFailed = false;

function provider() {
  if (process.env.REDIS_URL && !redisFailed) return 'redis';
  return 'memory';
}

/* ---- Minimal RESP client ---- */
function parseRedisUrl() {
  const u = new URL(process.env.REDIS_URL);
  return { host: u.hostname || '127.0.0.1', port: Number(u.port) || 6379, password: u.password ? decodeURIComponent(u.password) : null, db: u.pathname ? Number(u.pathname.slice(1)) || 0 : 0 };
}

function encodeCmd(...args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) { const s = String(a); out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`; }
  return out;
}

class RespReader {
  constructor() { this.buf = Buffer.alloc(0); }
  feed(chunk) { this.buf = Buffer.concat([this.buf, chunk]); }
  read() {
    // Parses one RESP value; returns {value, done} or {done:false}
    const parse = (b, i) => {
      if (i >= b.length) return null;
      const type = String.fromCharCode(b[i]);
      const lineEnd = b.indexOf('\r\n', i);
      if (lineEnd < 0) return null;
      const line = b.toString('utf8', i + 1, lineEnd);
      const rest = lineEnd + 2;
      if (type === '+' || type === ':' ) return { value: type === ':' ? Number(line) : line, next: rest };
      if (type === '-') return { value: new Error(line), next: rest };
      if (type === '$') {
        const len = Number(line);
        if (len === -1) return { value: null, next: rest };
        if (b.length < rest + len + 2) return null;
        return { value: b.toString('utf8', rest, rest + len), next: rest + len + 2 };
      }
      if (type === '*') {
        const n = Number(line);
        if (n === -1) return { value: null, next: rest };
        const arr = []; let p = rest;
        for (let k = 0; k < n; k++) { const r = parse(b, p); if (!r) return null; arr.push(r.value); p = r.next; }
        return { value: arr, next: p };
      }
      return null;
    };
    const r = parse(this.buf, 0);
    if (!r) return { done: false };
    this.buf = this.buf.subarray(r.next);
    return { done: true, value: r.value };
  }
}

async function redisConn() {
  if (redis && !redis.dead) return redis;
  const { host, port, password, db } = parseRedisUrl();
  const socket = net.createConnection({ host, port });
  await new Promise((res, rej) => {
    socket.once('connect', res);
    socket.once('error', rej);
    setTimeout(() => rej(new Error('Redis connect timeout')), 3000);
  });
  const reader = new RespReader();
  const pending = [];
  socket.on('data', (chunk) => {
    reader.feed(chunk);
    for (;;) {
      const r = reader.read();
      if (!r.done) break;
      const cb = pending.shift();
      if (cb) cb(r.value);
    }
  });
  socket.on('error', () => { if (redis) redis.dead = true; });
  socket.on('close', () => { if (redis) redis.dead = true; });
  const cmd = (...args) => new Promise((res, rej) => {
    pending.push((v) => (v instanceof Error ? rej(v) : res(v)));
    socket.write(encodeCmd(...args), (e) => { if (e) rej(e); });
    setTimeout(() => rej(new Error('Redis command timeout')), 3000);
  });
  redis = { socket, cmd, dead: false };
  if (password) await cmd('AUTH', password);
  if (db) await cmd('SELECT', db);
  return redis;
}

async function redisOp(fn) {
  try {
    const c = await redisConn();
    return await fn(c);
  } catch (e) {
    // Fail soft: mark redis unusable for this process, fall back to memory.
    redisFailed = true;
    if (redis) { try { redis.socket.destroy(); } catch {} redis = null; }
    return undefined; // caller falls back to memory
  }
}

/* ---- Public API ---- */
async function get(key) {
  const k = String(key);
  if (provider() === 'redis') {
    const v = await redisOp(c => c.cmd('GET', `eduverse:${k}`));
    if (v === undefined) return memGet(k); // redis failed -> memory fallback
    if (v === null || v === undefined) return null;
    try { return JSON.parse(v); } catch { return null; }
  }
  return memGet(k);
}

function memGet(k) {
  const e = mem.get(k);
  if (!e) return null;
  if (e.expiresAt && e.expiresAt <= Date.now()) { mem.delete(k); return null; }
  return e.value;
}

async function set(key, value, ttlSec) {
  const k = String(key);
  const ttl = Math.max(1, Math.min(86400, Math.floor(Number(ttlSec) || 60)));
  if (provider() === 'redis') {
    const v = await redisOp(c => c.cmd('SET', `eduverse:${k}`, JSON.stringify(value), 'EX', ttl));
    if (v !== undefined) return;
  }
  mem.set(k, { value, expiresAt: Date.now() + ttl * 1000 });
}

async function del(key) {
  const k = String(key);
  if (provider() === 'redis') await redisOp(c => c.cmd('DEL', `eduverse:${k}`));
  mem.delete(k);
}

function _resetForTests() { mem.clear(); redisFailed = false; if (redis) { try { redis.socket.destroy(); } catch {} redis = null; } }

module.exports = { provider, get, set, del, _resetForTests };
