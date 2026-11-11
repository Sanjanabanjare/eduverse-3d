'use strict';
/**
 * backend/live.js — live classroom signaling for EduVerse slice 3.
 *
 * WebSocket signaling server (path /ws) sharing the app's HTTP server.
 * Auth: the `eduverse_session` session id, passed either as the
 * `eduverse_session` cookie on the WS handshake or as `?token=<sessionId>`.
 * The server relays signaling + collaboration messages between peers in a
 * room. It never stores or proxies media (WebRTC is P2P between browsers).
 *
 * Rooms: main room is `live:<sessionId>`; teacher breakout rooms are
 * `live:<sessionId>:b:<slug>`.
 */

const { WebSocketServer } = require('ws');
const { randomUUID } = require('node:crypto');

const HEARTBEAT_MS = 25000;
const CHAT_LIMIT = 10;
const CHAT_WINDOW_MS = 10000;
const MAX_MSG_BYTES = 64 * 1024;
const MAX_CLIENTS_PER_ROOM = 50;

let ctx = null; // { sessions: Map, store: object, parseCookies: fn, SESSION_MS: number }
const rooms = new Map(); // roomId -> Set<client>
const wss = new WebSocketServer({ noServer: true });

function init(context) { ctx = context; }

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sessionIdFrom(req) {
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    const q = u.searchParams.get('token');
    if (q) return q;
  } catch {}
  if (!ctx) return null;
  return ctx.parseCookies(req.headers.cookie || '').eduverse_session || null;
}

function wsUser(sessionId) {
  if (!ctx || !sessionId) return null;
  const session = ctx.sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { ctx.sessions.delete(sessionId); return null; }
  const user = ctx.store.users.find(u => u.id === session.userId && u.status === 'active');
  if (user) session.expiresAt = Date.now() + ctx.SESSION_MS;
  return user || null;
}

/** Returns true when this module handled the upgrade request. */
function handleUpgrade(req, socket, head) {
  let pathname = '/';
  try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch {}
  if (pathname !== '/ws') return false;
  const user = wsUser(sessionIdFrom(req));
  if (!user) {
    try { socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); } catch {}
    socket.destroy();
    return true;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
  return true;
}

function roomSet(roomId) {
  let set = rooms.get(roomId);
  if (!set) { set = new Set(); rooms.set(roomId, set); }
  return set;
}

function peersOf(roomId, excludeId) {
  const out = [];
  for (const c of rooms.get(roomId) || []) {
    if (c.id !== excludeId && c.roomId) out.push({ clientId: c.id, name: c.name, role: c.role });
  }
  return out;
}

function sendTo(client, msg) {
  if (client.ws.readyState === 1) {
    try { client.ws.send(JSON.stringify(msg)); } catch {}
  }
}

function broadcast(roomId, msg, excludeId) {
  for (const c of rooms.get(roomId) || []) {
    if (c.id !== excludeId) sendTo(c, msg);
  }
}

function leaveRoom(client, notify = true) {
  const set = rooms.get(client.roomId);
  if (set) {
    set.delete(client);
    if (notify) broadcast(client.roomId, { type: 'peer-left', clientId: client.id });
    if (!set.size) rooms.delete(client.roomId);
  }
  client.roomId = null;
}

/** Room id must belong to a live (non-ended) session the client may see. */
function validRoom(roomId) {
  if (!ctx || typeof roomId !== 'string') return null;
  const m = /^live:([0-9a-f-]{10,60})(?::b:([A-Za-z0-9_-]{1,40}))?$/.exec(roomId);
  if (!m) return null;
  const session = (ctx.store.liveSessions || []).find(s => s.id === m[1]);
  if (!session || session.status === 'ended') return null;
  return session;
}

function checkChatRate(client) {
  const now = Date.now();
  client.chatTimestamps = (client.chatTimestamps || []).filter(t => now - t < CHAT_WINDOW_MS);
  if (client.chatTimestamps.length >= CHAT_LIMIT) return false;
  client.chatTimestamps.push(now);
  return true;
}

function isTeacher(client) {
  return client.user.role === 'teacher' || client.user.role === 'admin';
}

function str(v, max) {
  const s = String(v ?? '').trim();
  return s.length > max ? null : s;
}

function handleMessage(client, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return sendTo(client, { type: 'error', error: 'Invalid JSON message.' }); }
  if (!msg || typeof msg.type !== 'string') return sendTo(client, { type: 'error', error: 'Message needs a type.' });

  switch (msg.type) {
    case 'hello': {
      const session = validRoom(msg.roomId);
      if (!session) return sendTo(client, { type: 'error', error: 'Unknown or ended classroom.' });
      const set = roomSet(msg.roomId);
      if (set.size >= MAX_CLIENTS_PER_ROOM) return sendTo(client, { type: 'error', error: 'This classroom is full.' });
      if (client.roomId) leaveRoom(client);
      client.roomId = msg.roomId;
      client.name = str(msg.name, 80) || client.user.name || 'Participant';
      client.role = client.user.role;
      set.add(client);
      sendTo(client, { type: 'peers', clientId: client.id, roomId: client.roomId, peers: peersOf(client.roomId, client.id) });
      broadcast(client.roomId, { type: 'peer-joined', clientId: client.id, name: client.name, role: client.role }, client.id);
      return;
    }
    case 'signal': {
      if (!client.roomId) return sendTo(client, { type: 'error', error: 'Join a room first (hello).' });
      if (!['offer', 'answer', 'ice'].includes(msg.kind)) return sendTo(client, { type: 'error', error: 'Bad signal kind.' });
      const target = [...(rooms.get(client.roomId) || [])].find(c => c.id === msg.to);
      if (!target) return sendTo(client, { type: 'error', error: 'Peer not found.' });
      return sendTo(target, { type: 'signal', from: client.id, kind: msg.kind, payload: msg.payload ?? null });
    }
    case 'chat': {
      if (!client.roomId) return sendTo(client, { type: 'error', error: 'Join a room first (hello).' });
      const text = str(msg.text, 500);
      if (!text) return sendTo(client, { type: 'error', error: 'Chat text is required (up to 500 characters).' });
      if (!checkChatRate(client)) return sendTo(client, { type: 'error', error: 'Chat rate limit: slow down.' });
      return broadcast(client.roomId, { type: 'chat', from: client.id, name: client.name, text: escHtml(text), at: new Date().toISOString() });
    }
    case 'hand': {
      if (!client.roomId) return;
      return broadcast(client.roomId, { type: 'hand', from: client.id, name: client.name, raised: msg.raised === true });
    }
    case 'poll-start': {
      if (!client.roomId || !isTeacher(client)) return sendTo(client, { type: 'error', error: 'Only the teacher can start polls.' });
      const pollId = str(msg.pollId, 100), question = str(msg.question, 300);
      const options = Array.isArray(msg.options) ? msg.options.map(o => String(o).trim()).filter(Boolean).slice(0, 8) : [];
      if (!pollId || !question || options.length < 2) return sendTo(client, { type: 'error', error: 'Poll needs an id, a question, and 2 to 8 options.' });
      return broadcast(client.roomId, { type: 'poll-start', from: client.id, pollId, question: escHtml(question), options: options.map(escHtml) });
    }
    case 'poll-vote': {
      if (!client.roomId) return;
      const pollId = str(msg.pollId, 100);
      if (!pollId) return;
      return broadcast(client.roomId, { type: 'poll-vote', from: client.id, name: client.name, pollId, option: String(msg.option ?? '').slice(0, 100) });
    }
    case 'poll-end': {
      if (!client.roomId || !isTeacher(client)) return sendTo(client, { type: 'error', error: 'Only the teacher can end polls.' });
      const pollId = str(msg.pollId, 100);
      if (!pollId) return;
      return broadcast(client.roomId, { type: 'poll-end', from: client.id, pollId });
    }
    case 'qa-ask': {
      if (!client.roomId) return;
      const text = str(msg.text, 500);
      if (!text) return sendTo(client, { type: 'error', error: 'Question text is required (up to 500 characters).' });
      const qaId = /^[A-Za-z0-9_-]{1,100}$/.test(String(msg.qaId || '')) ? String(msg.qaId) : randomUUID();
      return broadcast(client.roomId, { type: 'qa-ask', qaId, from: client.id, name: client.name, text: escHtml(text), at: new Date().toISOString() });
    }
    case 'qa-answer': {
      if (!client.roomId || !isTeacher(client)) return sendTo(client, { type: 'error', error: 'Only the teacher can answer Q&A.' });
      const qaId = str(msg.qaId, 100), text = str(msg.text, 2000);
      if (!qaId || !text) return sendTo(client, { type: 'error', error: 'Answer needs a question id and text.' });
      return broadcast(client.roomId, { type: 'qa-answer', from: client.id, name: client.name, qaId, text: escHtml(text), at: new Date().toISOString() });
    }
    case 'whiteboard': {
      if (!client.roomId) return;
      const s = msg.stroke || {};
      const color = /^#[0-9a-fA-F]{6}$/.test(String(s.color)) ? String(s.color) : '#000000';
      const size = Math.min(50, Math.max(1, Number(s.size) || 2));
      const points = Array.isArray(s.points) ? s.points.slice(0, 500).filter(p =>
        Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(Number(n)) && Number(n) >= 0 && Number(n) <= 1)
      ).map(p => [Number(p[0]), Number(p[1])]) : [];
      if (!points.length) return;
      return broadcast(client.roomId, { type: 'whiteboard', from: client.id, stroke: { color, size, points } }, client.id);
    }
    case 'whiteboard-clear': {
      if (!client.roomId || !isTeacher(client)) return sendTo(client, { type: 'error', error: 'Only the teacher can clear the board.' });
      return broadcast(client.roomId, { type: 'whiteboard-clear', from: client.id });
    }
    case 'slide': {
      if (!client.roomId || !isTeacher(client)) return sendTo(client, { type: 'error', error: 'Only the teacher can change slides.' });
      const index = Math.floor(Number(msg.index));
      const total = Math.floor(Number(msg.total));
      if (!Number.isInteger(index) || index < 0 || !Number.isInteger(total) || total < 1 || index >= total) {
        return sendTo(client, { type: 'error', error: 'Bad slide index.' });
      }
      const s = msg.slide || {};
      const slide = { title: escHtml(str(s.title, 200)), bullets: Array.isArray(s.bullets) ? s.bullets.slice(0, 8).map(b => escHtml(str(b, 300))) : [] };
      return broadcast(client.roomId, { type: 'slide', from: client.id, index, total, slide });
    }
    case 'breakout': {
      if (!client.roomId || !isTeacher(client)) return sendTo(client, { type: 'error', error: 'Only the teacher can manage breakout rooms.' });
      const room = str(msg.room, 120);
      if (!room || !validRoom(room)) return sendTo(client, { type: 'error', error: 'Unknown or ended breakout room.' });
      if (msg.to) {
        const target = [...(rooms.get(client.roomId) || [])].find(c => c.id === msg.to);
        if (!target) return sendTo(client, { type: 'error', error: 'Peer not found.' });
        moveClient(target, room);
      } else {
        // recall / move everyone currently in the teacher's room
        for (const c of [...(rooms.get(client.roomId) || [])]) moveClient(c, room);
      }
      return;
    }
    case 'mute-all': {
      if (!client.roomId || !isTeacher(client)) return sendTo(client, { type: 'error', error: 'Only the teacher can mute everyone.' });
      return broadcast(client.roomId, { type: 'mute-all', from: client.id }, client.id);
    }
    case 'bye': {
      leaveRoom(client);
      try { client.ws.close(1000, 'bye'); } catch {}
      return;
    }
    default:
      return sendTo(client, { type: 'error', error: 'Unknown message type.' });
  }
}

function moveClient(client, roomId) {
  const from = client.roomId;
  if (from === roomId) return;
  leaveRoom(client);
  client.roomId = roomId;
  roomSet(roomId).add(client);
  sendTo(client, { type: 'moved', roomId, peers: peersOf(roomId, client.id) });
  broadcast(roomId, { type: 'peer-joined', clientId: client.id, name: client.name, role: client.role }, client.id);
}

/** Close a classroom room (and its breakout rooms) — used when the teacher ends the session. */
function closeRoom(roomId) {
  for (const id of [...rooms.keys()]) {
    if (id !== roomId && !id.startsWith(roomId + ':')) continue;
    for (const c of [...(rooms.get(id) || [])]) {
      sendTo(c, { type: 'room-closed', roomId: id });
      try { c.ws.close(1000, 'room closed'); } catch {}
      c.roomId = null;
    }
    rooms.delete(id);
  }
}

function roomPeerCount(roomId) {
  return (rooms.get(roomId) || new Set()).size;
}

wss.on('connection', (ws, user) => {
  const client = {
    id: randomUUID(), ws, user,
    roomId: null, name: user.name || 'Participant', role: user.role,
    chatTimestamps: [], isAlive: true,
  };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    if (Buffer.byteLength(data) > MAX_MSG_BYTES) {
      try { ws.close(1009, 'message too large'); } catch {}
      return;
    }
    try { handleMessage(client, data.toString('utf8')); }
    catch { sendTo(client, { type: 'error', error: 'Could not handle that message.' }); }
  });
  ws.on('close', () => leaveRoom(client));
  ws.on('error', () => {});
  sendTo(client, { type: 'welcome', clientId: client.id });
});

let heartbeatTimer = null;
function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} return; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  }, HEARTBEAT_MS);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

function shutdown() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  for (const id of [...rooms.keys()]) closeRoom(id);
  wss.clients.forEach((ws) => { try { ws.close(1001, 'server shutdown'); } catch {} });
  wss.close();
}

startHeartbeat();

module.exports = { init, handleUpgrade, closeRoom, roomPeerCount, shutdown, _rooms: rooms };
