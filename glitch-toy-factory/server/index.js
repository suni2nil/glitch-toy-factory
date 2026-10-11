import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { canStandAt, PLAYER_RADIUS, PLAYER_SPEED, SPAWNS, roomAt } from '../shared/factory-map.js';
import { BUZZER_POINT, CONVEYOR_TUNNELS, DISCUSSION_MS, JAM_STATIONS, KILL_COOLDOWN_MS, SABOTAGE_DURATION, TASKS, TUNNEL_COOLDOWN_MS, VOTING_MS } from '../shared/game-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true }, pingInterval: 10000, pingTimeout: 20000 });
const PORT = process.env.PORT || 3001;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MAX_PLAYERS = 5;
const RECONNECT_GRACE_MS = 45_000;
const rooms = new Map();
const clientRoom = new Map();
const QUICK_LINES = ['I was in Paint Shop', 'Sus!', 'Skip vote'];
const BAD_WORDS = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'damn'];

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(__dirname, '../dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
}

function makeCode() {
  let code;
  do { code = Array.from(randomBytes(5), b => CODE_CHARS[b % CODE_CHARS.length]).join(''); } while (rooms.has(code));
  return code;
}
function cleanName(value) {
  return String(value ?? 'Toy Maker').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16) || 'Toy Maker';
}
function cleanChat(value) {
  let text = String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 140);
  for (const word of BAD_WORDS) text = text.replace(new RegExp(`\\b${word}\\b`, 'gi'), match => match[0] + '*'.repeat(Math.max(1, match.length - 1)));
  return text;
}
function validAvatar(value = {}) {
  const colors = ['#ff6b6b', '#43c6ac', '#ffc857', '#8b7cff', '#ff8ac6', '#55a7ff', '#ff914d', '#a7d957'];
  const hats = ['none', 'cap', 'crown', 'cone', 'propeller'];
  const faces = ['smile', 'wink', 'wow', 'cool'];
  return { color: colors.includes(value.color) ? value.color : colors[0], hat: hats.includes(value.hat) ? value.hat : 'none', face: faces.includes(value.face) ? value.face : 'smile' };
}
function publicLobbyPlayer(p) { return { id: p.id, name: p.name, avatar: p.avatar, ready: p.ready, connected: p.connected, joinedAt: p.joinedAt }; }
function roomSnapshot(room) {
  return { code: room.code, phase: room.phase, hostId: room.hostId, maxPlayers: MAX_PLAYERS,
    players: [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt).map(publicLobbyPlayer) };
}
function reply(ack, payload) { if (typeof ack === 'function') ack(payload); }
function findPlayer(room, id) { return room?.players.get(id); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function broadcastRoom(room) { io.to(room.code).emit('room:state', roomSnapshot(room)); }
function shuffle(items) { const arr = [...items]; for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function roleToClient(socket, player) {
  socket.emit('role:assigned', { role: player.role, alive: player.alive, ghost: player.ghost });
  if (player.role === 'worker') socket.emit('tasks:private', player.tasks || []);
}
function gameSnapshot(room, viewer) {
  const meetingOpen = ['meeting_discussion', 'meeting_voting', 'meeting_reveal'].includes(room.phase);
  let radius = Infinity;
  if (!meetingOpen && viewer?.alive !== false) {
    const lights = room.sabotage?.type === 'lights';
    radius = viewer?.role === 'glitch' ? (lights ? 210 : 420) : (lights ? 120 : 300);
  }
  const allPlayers = [...room.players.values()].filter(p => Number.isFinite(p.x)).map(p => ({
    id: p.id, name: p.name, avatar: p.avatar, connected: p.connected, x: p.x, y: p.y,
    dirX: p.dirX || 0, dirY: p.dirY || 0, alive: p.alive !== false, ghost: Boolean(p.ghost),
    ...(p.emote?.until > Date.now() ? { emote: p.emote.type } : {}),
    ...(p.chatBubble?.until > Date.now() ? { chatBubble: p.chatBubble.text } : {}),
    ...(room.phase === 'ended' ? { role: p.role } : {})
  }));
  const visiblePlayers = Number.isFinite(radius) && viewer
    ? allPlayers.filter(p => p.id === viewer.id || Math.hypot(p.x - viewer.x, p.y - viewer.y) <= radius)
    : allPlayers;
  const bodies = (room.bodies || []).filter(body => !Number.isFinite(radius) || !viewer || Math.hypot(body.x - viewer.x, body.y - viewer.y) <= radius)
    .map(({ id, x, y, color, victimName }) => ({ id, x, y, color, victimName }));
  const meeting = room.meeting ? {
    stage: room.meeting.stage, endAt: room.meeting.endAt, reporterName: room.meeting.reporterName,
    bodyName: room.meeting.bodyName, emergency: room.meeting.emergency,
    votesReceived: room.meeting.votes.size,
    eligibleVoters: [...room.players.values()].filter(p => p.alive && p.connected).length,
    hasVoted: Boolean(viewer && room.meeting.votes.has(viewer.id)),
    messages: viewer?.alive ? room.meeting.messages : [],
    result: room.meeting.result || null
  } : null;
  return {
    code: room.code, tick: room.tick || 0, phase: room.phase, players: visiblePlayers, bodies,
    taskProgress: { done: room.tasksDone || 0, total: room.tasksTotal || 0 },
    sabotage: room.sabotage ? { type: room.sabotage.type, endsAt: room.sabotage.endsAt, fixProgress: room.sabotage.fixProgress || 0 } : null,
    powerUntil: room.powerUntil || 0, meeting,
    own: viewer ? { alive: viewer.alive !== false, ghost: Boolean(viewer.ghost), buzzerUsed: Boolean(viewer.buzzerUsed),
      killReadyAt: viewer.killReadyAt || 0, sabotageReadyAt: viewer.sabotageReadyAt || 0,
      tunnelReadyAt: viewer.tunnelReadyAt || 0, currentTaskId: viewer.currentTaskId || null,
      hasVoted: Boolean(room.meeting?.votes?.has(viewer.id)) } : null,
    endStats: room.phase === 'ended' ? room.endStats : null,
    gameEnded: room.gameEnded || null,
    notice: room.notice && room.notice.until > Date.now() ? room.notice.text : ''
  };
}
function emitGameStates(room) {
  for (const player of room.players.values()) {
    if (!player.connected || !player.socketId) continue;
    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) socket.emit('game:state', gameSnapshot(room, player));
  }
}
function stopSimulation(room) { if (room.simTimer) clearInterval(room.simTimer); room.simTimer = undefined; }
function activeGame(room) { return room && room.phase !== 'lobby' && room.phase !== 'ended'; }
function positionIsFree(room, player, x, y) {
  if (!canStandAt(x, y, PLAYER_RADIUS)) return false;
  const gap = PLAYER_RADIUS * 1.9;
  return [...room.players.values()].every(other => other.id === player.id || !other.connected || other.alive === false || !Number.isFinite(other.x) || (x - other.x) ** 2 + (y - other.y) ** 2 >= gap ** 2);
}
function finishGame(room, winner, reason) {
  if (!room || room.phase === 'ended') return;
  room.phase = 'ended';
  room.gameEnded = { winner, reason, at: Date.now() };
  room.meeting = room.meeting || null;
  room.endStats = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, role: p.role || 'worker', alive: p.alive !== false,
    tasksDone: p.stats?.tasksDone || 0, kills: p.stats?.kills || 0, votesReceived: p.stats?.votesReceived || 0, votesCast: p.stats?.votesCast || 0
  }));
  stopSimulation(room);
  emitGameStates(room);
}
function checkWin(room) {
  if (!room || room.phase === 'ended') return true;
  if (room.tasksTotal > 0 && room.tasksDone >= room.tasksTotal) { finishGame(room, 'workers', 'Every toy task is finished!'); return true; }
  const glitch = [...room.players.values()].find(p => p.role === 'glitch');
  if (!glitch || glitch.alive === false) { finishGame(room, 'workers', 'The Glitch has been caught!'); return true; }
  const aliveWorkers = [...room.players.values()].filter(p => p.role === 'worker' && p.alive !== false).length;
  if (aliveWorkers <= 1) { finishGame(room, 'glitch', 'The factory floor is down to one worker!'); return true; }
  return false;
}
function initializeGame(room) {
  const roster = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  const glitchIndex = randomBytes(4).readUInt32BE(0) % roster.length;
  room.bodies = []; room.meeting = null; room.sabotage = null; room.powerUntil = 0;
  room.sabotageCooldownUntil = 0; room.tasksDone = 0; room.tasksTotal = 0; room.tick = 0; room.gameEnded = null; room.endStats = null;
  room.announcerNext = Date.now() + 28000 + Math.random() * 17000;
  roster.forEach((p, index) => {
    const spawn = SPAWNS[index % SPAWNS.length];
    p.x = spawn.x; p.y = spawn.y; p.dirX = 0; p.dirY = 0; p.input = { dx: 0, dy: 0 };
    p.role = index === glitchIndex ? 'glitch' : 'worker'; p.alive = true; p.ghost = false;
    p.buzzerUsed = false; p.killReadyAt = 0; p.sabotageReadyAt = 0; p.tunnelReadyAt = 0;
    p.currentTaskId = null; p.fixStation = null; p.stats = { tasksDone: 0, kills: 0, votesReceived: 0, votesCast: 0 };
    p.tasks = p.role === 'worker' ? shuffle(TASKS).slice(0, 3).map(task => ({ ...task, completed: false, startedAt: 0 })) : [];
    room.tasksTotal += p.tasks.length;
  });
  room.phase = 'started';
  for (const p of roster) { const s = io.sockets.sockets.get(p.socketId); if (s) roleToClient(s, p); }
}
function startSimulation(room) {
  stopSimulation(room);
  let lastTick = Date.now();
  room.simTimer = setInterval(() => {
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(.09, (now - lastTick) / 1000)); lastTick = now;
    if (room.phase === 'ended' || room.phase === 'lobby') return stopSimulation(room);
    if (room.phase === 'started') {
      for (const p of room.players.values()) {
        if (!Number.isFinite(p.x)) continue;
        if (!p.connected || now - (p.lastInputAt || 0) > 350) p.input = { dx: 0, dy: 0 };
        let dx = p.input?.dx || 0, dy = p.input?.dy || 0;
        if (p.alive === false) { dx = p.input?.dx || 0; dy = p.input?.dy || 0; }
        const magnitude = Math.hypot(dx, dy);
        if (magnitude > 1) { dx /= magnitude; dy /= magnitude; }
        if (!dx && !dy) continue;
        const speed = PLAYER_SPEED * (p.ghost ? 1.2 : 1);
        const distance = speed * elapsed;
        const oldRoom = roomAt(p.x, p.y);
        let nx = p.x + dx * distance, ny = p.y + dy * distance;
        if (p.ghost) {
          nx = Math.max(20, Math.min(1180, nx)); ny = Math.max(20, Math.min(740, ny));
          p.x = nx; p.y = ny;
        } else {
          if (room.powerUntil > now && roomAt(nx, ny) !== oldRoom) nx = p.x;
          if (positionIsFree(room, p, nx, p.y)) p.x = nx;
          if (room.powerUntil > now && roomAt(p.x, ny) !== oldRoom) ny = p.y;
          if (positionIsFree(room, p, p.x, ny)) p.y = ny;
        }
        p.dirX = dx; p.dirY = dy;
      }
      if (now >= (room.announcerNext || Infinity)) {
        const lines = ['Someone is acting suspiciously squeaky…', 'Remember: toys do not fix themselves. Probably.', 'The night supervisor is counting every missing duck.', 'A conveyor belt has a very good poker face.', 'Keep your eyes peeled and your stuffing tidy.'];
        room.notice = { text: lines[Math.floor(Math.random() * lines.length)], until: now + 4200 };
        room.announcerNext = now + 28000 + Math.random() * 22000;
      }
      if (room.sabotage?.type === 'jam') {
        const jam = room.sabotage;
        for (const p of room.players.values()) {
          if (!p.fixStation || !p.connected || !p.alive || p.role !== 'worker') continue;
          const station = JAM_STATIONS.find(s => s.id === p.fixStation);
          if (!station || Math.hypot(p.x - station.x, p.y - station.y) > 74) p.fixStation = null;
        }
        const west = [...room.players.values()].some(p => p.fixStation === 'west' && p.alive && p.connected);
        const east = [...room.players.values()].some(p => p.fixStation === 'east' && p.alive && p.connected);
        if (west && east) { if (!jam.bothSince) jam.bothSince = now; jam.fixProgress = Math.min(1, (now - jam.bothSince) / 2200); }
        else { jam.bothSince = 0; jam.fixProgress = 0; }
        if (jam.fixProgress >= 1) { room.sabotage = null; room.notice = { text: 'CONVEYOR UNJAMMED! Teamwork makes the toys work.', until: now + 4500 }; }
        else if (now >= jam.endsAt) { finishGame(room, 'glitch', 'The conveyor jam timer ran out!'); return; }
      } else if (room.sabotage && now >= room.sabotage.endsAt) room.sabotage = null;
      if (checkWin(room)) return;
    }
    if (room.phase === 'meeting_discussion' && room.meeting && now >= room.meeting.endAt) {
      room.phase = 'meeting_voting'; room.meeting.stage = 'voting'; room.meeting.endAt = now + VOTING_MS;
    } else if (room.phase === 'meeting_voting' && room.meeting && now >= room.meeting.endAt) resolveMeeting(room);
    else if (room.phase === 'meeting_reveal' && room.meeting && now >= room.meeting.endAt) {
      room.meeting = null; room.phase = 'started';
      for (const p of room.players.values()) { p.input = { dx: 0, dy: 0 }; p.lastInputAt = now; }
    }
    room.tick = (room.tick || 0) + 1;
    emitGameStates(room);
  }, 50);
  room.simTimer.unref?.();
  emitGameStates(room);
}
function makeTaskChallenge(task) {
  if (task.kind === 'memory') return { sequence: Array.from({length:3},()=>Math.floor(Math.random()*4)) };
  if (task.kind === 'wires') return { colors: ['coral','sky','sun'] };
  if (task.kind === 'sort') return { bins: { duck:'duck', bear:'bear', brick:'brick' } };
  if (task.kind === 'paint') return { minHoldMs:3400, maxHoldMs:4200 };
  if (task.kind === 'stack') return { minPhase:.37, maxPhase:.65, hits:3 };
  if (task.kind === 'keycard') return { minSwipeMs:351, maxSwipeMs:1399, minProgress:95 };
  return {};
}
function validateTaskSolution(task, solution = {}) {
  if (task.kind === 'wires') return Array.isArray(solution.connections) && solution.connections.length === 3 && ['coral','sky','sun'].every(c=>solution.connections.includes(c));
  if (task.kind === 'sort') return Array.isArray(solution.sorted) && solution.sorted.length === 3 && ['duck','bear','brick'].every(c=>solution.sorted.includes(c));
  if (task.kind === 'paint') return Number(solution.holdMs)>=3400 && Number(solution.holdMs)<=4200;
  if (task.kind === 'stack') return Array.isArray(solution.hits) && solution.hits.length===3 && solution.hits.every(n=>Number(n)>=.37&&Number(n)<=.65);
  if (task.kind === 'keycard') return Number(solution.swipeMs)>=351 && Number(solution.swipeMs)<=1399 && Number(solution.progress)>=95;
  if (task.kind === 'memory') return Array.isArray(solution.sequence) && JSON.stringify(solution.sequence)===JSON.stringify(task.challenge?.sequence);
  return false;
}
function privateTaskSnapshot(player) {
  return (player.tasks || []).map(({ id, title, room, kind, x, y, completed }) => ({ id, title, room, kind, x, y, completed }));
}
function sendPrivateGameState(socket, room, player) {
  if (player.role) roleToClient(socket, player);
  socket.emit('game:state', gameSnapshot(room, player));
}
function startMeeting(room, reporter, body = null, emergency = false) {
  if (room.phase !== 'started') return false;
  const now = Date.now();
  for (const p of room.players.values()) { p.input = { dx: 0, dy: 0 }; p.fixStation = null; }
  room.sabotage = null; room.powerUntil = 0;
  room.phase = 'meeting_discussion';
  room.meeting = { stage: 'discussion', endAt: now + DISCUSSION_MS, reporterName: reporter.name,
    bodyName: body?.victimName || '', bodyId: body?.id || null, emergency, votes: new Map(), messages: [], result: null };
  room.notice = { text: emergency ? `${reporter.name} pressed the Emergency Buzzer!` : `${reporter.name} reported a toy down!`, until: now + 4500 };
  emitGameStates(room);
  return true;
}
function resolveMeeting(room) {
  if (!room.meeting || room.phase !== 'meeting_voting') return;
  const meeting = room.meeting;
  const tallies = new Map();
  for (const [voterId, targetId] of meeting.votes) {
    const voter = findPlayer(room, voterId); const target = targetId === 'skip' ? null : findPlayer(room, targetId);
    if (voter) voter.stats.votesCast++;
    if (target) { tallies.set(target.id, (tallies.get(target.id) || 0) + 1); target.stats.votesReceived++; }
    else tallies.set('skip', (tallies.get('skip') || 0) + 1);
  }
  const max = Math.max(0, ...tallies.values());
  const leaders = [...tallies.entries()].filter(([, n]) => n === max);
  const targetId = leaders.length === 1 && leaders[0]?.[0] !== 'skip' ? leaders[0][0] : 'skip';
  let ejected = null;
  if (targetId !== 'skip') { ejected = findPlayer(room, targetId); if (ejected) { ejected.alive = false; ejected.ghost = true; ejected.input = { dx: 0, dy: 0 }; } }
  const voteRows = [...meeting.votes.entries()].map(([voterId, target]) => ({
    voterName: findPlayer(room, voterId)?.name || 'Toy Worker', targetName: target === 'skip' ? 'Skip' : findPlayer(room, target)?.name || 'Skip', skipped: target === 'skip'
  }));
  meeting.result = { targetId, ejectedName: ejected?.name || '', ejectedRole: ejected?.role || '', tie: leaders.length !== 1,
    votes: voteRows, totalVotes: voteRows.length, targetVotes: targetId === 'skip' ? (tallies.get('skip') || 0) : (tallies.get(targetId) || 0) };
  if (ejected?.role === 'glitch') { finishGame(room, 'workers', `${ejected.name} was the Glitch!`); return; }
  if (checkWin(room)) return;
  room.phase = 'meeting_reveal'; meeting.stage = 'reveal'; meeting.endAt = Date.now() + 5000;
  room.notice = { text: ejected ? `${ejected.name} is a ${ejected.role === 'glitch' ? 'Glitch' : 'Worker'}!` : 'Vote skipped — back to the factory!', until: Date.now() + 5000 };
  emitGameStates(room);
}
function removePlayer(room, player) {
  clearTimeout(player.cleanupTimer);
  if (player.role === 'worker' && player.tasks?.length) {
    const unfinished = player.tasks.filter(t => !t.completed).length;
    room.tasksTotal = Math.max(room.tasksDone, room.tasksTotal - unfinished);
  }
  room.players.delete(player.id);
  if (!room.players.size) { stopSimulation(room); rooms.delete(room.code); return; }
  if (room.hostId === player.id) {
    const next = [...room.players.values()].filter(p => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next) room.hostId = next.id;
  }
  broadcastRoom(room);
  if (activeGame(room)) { checkWin(room); emitGameStates(room); }
}
function detachSocket(socket) {
  const code = clientRoom.get(socket.id); clientRoom.delete(socket.id); if (code) socket.leave(code); return rooms.get(code);
}
function leaveCurrentRoom(socket) {
  const room = detachSocket(socket); const p = findPlayer(room, socket.data.playerId);
  if (room && p) removePlayer(room, p);
  socket.data.roomCode = undefined; socket.data.playerId = undefined;
}
function attachPlayer(socket, room, player) {
  if (player.cleanupTimer) clearTimeout(player.cleanupTimer);
  player.cleanupTimer = undefined; player.socketId = socket.id; player.connected = true;
  if (player.alive && player.role === 'glitch') player.input = { dx: 0, dy: 0 };
  if (!room.players.has(room.hostId)) room.hostId = player.id;
  clientRoom.set(socket.id, room.code); socket.join(room.code);
  socket.data.playerId = player.id; socket.data.roomCode = room.code;
  broadcastRoom(room);
}
function startMeetingChat(socket, room, p, payload) {
  if (!room.meeting || room.phase !== 'meeting_discussion' || !p.alive || !p.connected || p.socketId !== socket.id) return;
  const quick = QUICK_LINES.includes(payload?.quick) ? payload.quick : '';
  const text = quick || cleanChat(payload?.text);
  if (!text) return;
  const message = { id: randomBytes(6).toString('hex'), name: p.name, text, at: Date.now(), quick: Boolean(quick) };
  room.meeting.messages.push(message);
  if (room.meeting.messages.length > 50) room.meeting.messages.shift();
  for (const receiver of room.players.values()) {
    if (receiver.connected && receiver.alive && receiver.socketId) io.sockets.sockets.get(receiver.socketId)?.emit('meeting:message', message);
  }
}

io.on('connection', socket => {
  socket.on('room:create', (payload = {}, ack) => {
    leaveCurrentRoom(socket);
    const code = makeCode();
    const id = typeof payload.playerId === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(payload.playerId) ? payload.playerId : randomBytes(18).toString('base64url');
    const player = { id, name: cleanName(payload.name), avatar: validAvatar(payload.avatar), ready: false, connected: true, joinedAt: Date.now(), socketId: socket.id };
    const room = { code, phase: 'lobby', hostId: id, players: new Map([[id, player]]) };
    rooms.set(code, room); clientRoom.set(socket.id, code); socket.join(code); socket.data.playerId = id; socket.data.roomCode = code;
    reply(ack, { ok: true, room: roomSnapshot(room), playerId: id }); broadcastRoom(room);
  });

  socket.on('room:join', (payload = {}, ack) => {
    const code = String(payload.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const room = rooms.get(code);
    if (!room) return reply(ack, { ok: false, error: 'That room code was not found. Check it and try again.' });
    const oldId = typeof payload.playerId === 'string' ? payload.playerId : '';
    let player = findPlayer(room, oldId);
    if (room.phase !== 'lobby' && !player) return reply(ack, { ok: false, error: 'This shift has already started.' });
    if (!player && room.players.size >= MAX_PLAYERS) return reply(ack, { ok: false, error: 'This factory is full (5/5).' });
    if (clientRoom.get(socket.id) !== code) leaveCurrentRoom(socket);
    if (player) { player.name = cleanName(payload.name || player.name); player.avatar = validAvatar(payload.avatar || player.avatar); }
    else {
      const id = /^[a-zA-Z0-9_-]{12,80}$/.test(oldId) ? oldId : randomBytes(18).toString('base64url');
      player = { id, name: cleanName(payload.name), avatar: validAvatar(payload.avatar), ready: false, connected: true, joinedAt: Date.now() };
      room.players.set(id, player);
    }
    attachPlayer(socket, room, player);
    reply(ack, { ok: true, room: roomSnapshot(room), playerId: player.id });
    if (room.phase !== 'lobby' && player.role) sendPrivateGameState(socket, room, player);
  });

  socket.on('player:ready', (ready, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || !p || room.phase !== 'lobby') return reply(ack, { ok: false, error: 'You are not in an active lobby.' });
    p.ready = Boolean(ready); broadcastRoom(room); reply(ack, { ok: true });
  });
  socket.on('player:avatar', (avatar, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || !p || room.phase !== 'lobby') return reply(ack, { ok: false, error: 'Avatar changes are only available in the lobby.' });
    p.avatar = validAvatar(avatar); broadcastRoom(room); reply(ack, { ok: true, avatar: p.avatar });
  });
  socket.on('player:name', (name, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || !p || room.phase !== 'lobby') return reply(ack, { ok: false, error: 'Name changes are only available in the lobby.' });
    p.name = cleanName(name); broadcastRoom(room); reply(ack, { ok: true });
  });
  socket.on('room:start', (_payload, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || !p) return reply(ack, { ok: false, error: 'You are not in an active lobby.' });
    if (room.hostId !== p.id) return reply(ack, { ok: false, error: 'Only the host can start the shift.' });
    if (room.players.size < 3) return reply(ack, { ok: false, error: 'You need at least 3 workers to start.' });
    if ([...room.players.values()].some(x => !x.connected)) return reply(ack, { ok: false, error: 'Waiting for a disconnected worker to reconnect or leave.' });
    initializeGame(room); broadcastRoom(room); startSimulation(room); reply(ack, { ok: true });
  });
  socket.on('room:reset', (_payload, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || !p || room.hostId !== p.id) return reply(ack, { ok: false, error: 'Only the host can reset this lobby.' });
    stopSimulation(room); room.phase = 'lobby'; room.bodies = []; room.meeting = null; room.sabotage = null; room.gameEnded = null; room.endStats = null; room.tasksDone = 0; room.tasksTotal = 0;
    for (const player of room.players.values()) {
      player.ready = false; delete player.role; delete player.alive; delete player.ghost; delete player.tasks; delete player.x; delete player.y; delete player.input; delete player.stats; delete player.currentTaskId;
    }
    broadcastRoom(room); reply(ack, { ok: true });
  });
  socket.on('room:leave', (_payload, ack) => {
    const room = detachSocket(socket), p = findPlayer(room, socket.data.playerId);
    if (room && p) {
      if (p.role === 'glitch' && room.phase !== 'lobby' && room.phase !== 'ended') finishGame(room, 'workers', 'The Glitch left the shift!');
      removePlayer(room, p);
    }
    socket.data.roomCode = undefined; socket.data.playerId = undefined; reply(ack, { ok: true });
  });

  socket.on('player:input', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || room.phase !== 'started' || !p || !p.connected || p.socketId !== socket.id) return;
    let dx = Number(payload.dx), dy = Number(payload.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    dx = Math.max(-1, Math.min(1, dx)); dy = Math.max(-1, Math.min(1, dy));
    const packetTime = Date.now();
    if (packetTime - (p.lastInputPacketAt || 0) < 20) return;
    p.lastInputPacketAt = packetTime;
    const magnitude = Math.hypot(dx, dy); if (magnitude > 1) { dx /= magnitude; dy /= magnitude; }
    p.input = { dx, dy }; p.lastInputAt = packetTime;
  });

  socket.on('task:begin', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || room.phase !== 'started' || !p || p.role !== 'worker' || !p.connected || p.socketId !== socket.id || (p.alive === false && !p.ghost)) return reply(ack, { ok: false, error: 'Only workers can use factory tasks.' });
    if (p.currentTaskId) return reply(ack, { ok: false, error: 'Finish or cancel your current task first.' });
    const task = p.tasks?.find(t => t.id === payload.taskId && !t.completed);
    if (!task) return reply(ack, { ok: false, error: 'That task is not on your checklist.' });
    if (Math.hypot(p.x - task.x, p.y - task.y) > 68) return reply(ack, { ok: false, error: 'Move closer to the glowing task marker.' });
    task.startedAt = Date.now(); task.challenge = makeTaskChallenge(task); p.currentTaskId = task.id; p.input = { dx: 0, dy: 0 };
    reply(ack, { ok: true, task: { id: task.id, title: task.title, room: task.room, kind: task.kind, challenge: task.challenge }, minimumMs: 5000 });
  });
  socket.on('task:cancel', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || !p || p.socketId !== socket.id || p.currentTaskId !== payload.taskId) return reply(ack, { ok: false, error: 'No matching task is open.' });
    const task = p.tasks?.find(t => t.id === payload.taskId && !t.completed); if (task) task.startedAt = 0;
    p.currentTaskId = null; reply(ack, { ok: true });
  });
  socket.on('task:complete', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || room.phase !== 'started' || !p || p.role !== 'worker' || p.socketId !== socket.id || p.currentTaskId !== payload.taskId) return reply(ack, { ok: false, error: 'Finish an active worker task first.' });
    const task = p.tasks?.find(t => t.id === payload.taskId && !t.completed);
    if (!task || Date.now() - task.startedAt < 5000) return reply(ack, { ok: false, error: 'Keep at it for a little longer!' });
    if (!validateTaskSolution(task, payload.solution)) return reply(ack, { ok: false, error: 'The factory terminal says that puzzle is not solved yet.' });
    task.completed = true; task.startedAt = 0; task.challenge = null; p.currentTaskId = null; p.stats.tasksDone++; room.tasksDone++;
    const s = io.sockets.sockets.get(p.socketId); if (s) s.emit('tasks:private', privateTaskSnapshot(p));
    reply(ack, { ok: true });
    if (!checkWin(room)) emitGameStates(room);
  });

  socket.on('kill:attempt', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId), target = findPlayer(room, payload.targetId);
    if (!room || room.phase !== 'started' || !p || p.role !== 'glitch' || !p.alive || !p.connected || p.socketId !== socket.id) return reply(ack, { ok: false, error: 'Only the living Glitch can short-circuit.' });
    if (Date.now() < (p.killReadyAt || 0)) return reply(ack, { ok: false, error: 'Short-circuit is still cooling down.' });
    if (!target || target.id === p.id || target.role !== 'worker' || !target.alive || Math.hypot(p.x - target.x, p.y - target.y) > 70) return reply(ack, { ok: false, error: 'No worker close enough to short-circuit.' });
    target.alive = false; target.ghost = true; target.input = { dx: 0, dy: 0 }; target.currentTaskId = null;
    p.killReadyAt = Date.now() + KILL_COOLDOWN_MS; p.stats.kills++;
    const body = { id: randomBytes(6).toString('hex'), victimId: target.id, victimName: target.name, color: target.avatar.color, x: target.x, y: target.y };
    room.bodies.push(body); room.notice = { text: `${target.name} became a friendly ghost toy!`, until: Date.now() + 4200 };
    reply(ack, { ok: true }); if (!checkWin(room)) emitGameStates(room);
  });

  socket.on('report:request', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || room.phase !== 'started' || !p || !p.alive || !p.connected || p.socketId !== socket.id) return reply(ack, { ok: false, error: 'Ghost toys cannot call the living crew.' });
    if (payload.emergency) {
      if (p.buzzerUsed) return reply(ack, { ok: false, error: 'You already used your Emergency Buzzer this shift.' });
      if (Math.hypot(p.x - BUZZER_POINT.x, p.y - BUZZER_POINT.y) > 65) return reply(ack, { ok: false, error: 'Get close to the Break Room buzzer first.' });
      p.buzzerUsed = true;
      startMeeting(room, p, null, true); reply(ack, { ok: true }); return;
    }
    const body = room.bodies.find(b => b.id === payload.bodyId);
    if (!body || Math.hypot(p.x - body.x, p.y - body.y) > 70) return reply(ack, { ok: false, error: 'Move closer to the ghost toy to report it.' });
    room.bodies = room.bodies.filter(b => b.id !== body.id);
    startMeeting(room, p, body, false); reply(ack, { ok: true });
  });

  socket.on('meeting:chat', payload => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (room && p) startMeetingChat(socket, room, p, payload);
  });
  socket.on('meeting:vote', (targetId, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || room.phase !== 'meeting_voting' || !room.meeting || !p || !p.alive || !p.connected || p.socketId !== socket.id) return reply(ack, { ok: false, error: 'You cannot vote right now.' });
    if (room.meeting.votes.has(p.id)) return reply(ack, { ok: false, error: 'Your vote is already locked in.' });
    const target = targetId === 'skip' ? 'skip' : String(targetId);
    if (target !== 'skip' && (!findPlayer(room, target) || !findPlayer(room, target).alive)) return reply(ack, { ok: false, error: 'Choose a living worker or Skip.' });
    room.meeting.votes.set(p.id, target); reply(ack, { ok: true });
    const eligible = [...room.players.values()].filter(x => x.alive && x.connected);
    if (eligible.every(x => room.meeting.votes.has(x.id))) resolveMeeting(room);
    else emitGameStates(room);
  });

  socket.on('sabotage:trigger', (type, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId), now = Date.now();
    if (!room || room.phase !== 'started' || !p || p.role !== 'glitch' || !p.alive || !p.connected || p.socketId !== socket.id) return reply(ack, { ok: false, error: 'Only the Glitch can trigger sabotage.' });
    if (!['lights', 'jam', 'power'].includes(type)) return reply(ack, { ok: false, error: 'Unknown factory sabotage.' });
    if (room.sabotage) return reply(ack, { ok: false, error: 'Finish the active sabotage first.' });
    if (now < (p.sabotageReadyAt || 0)) return reply(ack, { ok: false, error: 'Sabotage controls are recharging.' });
    room.sabotage = { type, startedAt: now, endsAt: now + SABOTAGE_DURATION[type], fixProgress: 0, bothSince: 0 };
    p.sabotageReadyAt = now + 25000;
    if (type === 'power') room.powerUntil = room.sabotage.endsAt;
    room.notice = { text: type === 'lights' ? 'LIGHTS OUT! Keep your squeaky ears open.' : type === 'jam' ? 'CONVEYOR JAM! Two relays, at the same time!' : 'POWER SURGE! Factory doors are locking!', until: now + 5000 };
    reply(ack, { ok: true }); emitGameStates(room);
  });
  socket.on('sabotage:fix', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || room.phase !== 'started' || room.sabotage?.type !== 'jam' || !p || p.role !== 'worker' || !p.alive || !p.connected || p.socketId !== socket.id) return;
    const station = JAM_STATIONS.find(s => s.id === payload.station);
    if (!station || Math.hypot(p.x - station.x, p.y - station.y) > 75) { p.fixStation = null; return; }
    p.fixStation = payload.hold ? station.id : null;
  });
  socket.on('tunnel:use', (_payload, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId), now = Date.now();
    if (!room || room.phase !== 'started' || !p || p.role !== 'glitch' || !p.alive || !p.connected || p.socketId !== socket.id) return reply(ack, { ok: false, error: 'Only the living Glitch can use conveyor tunnels.' });
    if (now < (p.tunnelReadyAt || 0)) return reply(ack, { ok: false, error: 'Conveyor tunnel is still spinning up.' });
    const entrance = CONVEYOR_TUNNELS.find(t => Math.hypot(p.x - t.x, p.y - t.y) < 58);
    if (!entrance) return reply(ack, { ok: false, error: 'Stand by a glowing conveyor tunnel to zip through.' });
    const exit = CONVEYOR_TUNNELS.find(t => t.id === entrance.pair);
    if (!exit) return reply(ack, { ok: false, error: 'Tunnel exit is jammed.' });
    p.x = exit.x; p.y = exit.y; p.input = { dx: 0, dy: 0 }; p.tunnelReadyAt = now + TUNNEL_COOLDOWN_MS;
    reply(ack, { ok: true }); emitGameStates(room);
  });

  socket.on('emote:play', (type, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || room.phase !== 'started' || !p || !p.connected || p.socketId !== socket.id || !['wave','dance','laugh','point'].includes(type)) return reply(ack, { ok:false, error:'That emote is not available right now.' });
    if (Date.now() - (p.lastEmoteAt || 0) < 700) return reply(ack, { ok:false, error:'Give your toy a beat to finish that emote.' });
    p.lastEmoteAt = Date.now(); p.emote = { type, until: Date.now() + 2100 };
    reply(ack, {ok:true}); emitGameStates(room);
  });
  socket.on('game:chat', (payload = {}, ack) => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    if (!room || room.phase !== 'started' || !p || !p.alive || !p.connected || p.socketId !== socket.id) return reply(ack, {ok:false, error:'Ghost toys cannot chat with the living.'});
    const quick = ['I was in Paint Shop','I saw someone near the conveyor','Where were you?','Sus!'].includes(payload.quick) ? payload.quick : '';
    const text = quick || cleanChat(payload.text);
    if (!text) return reply(ack, {ok:false,error:'Type a quick alibi first.'});
    if (Date.now() - (p.lastChatAt || 0) < 900) return reply(ack,{ok:false,error:'Wait a moment before sending another message.'});
    p.lastChatAt=Date.now(); p.chatBubble={text,until:Date.now()+4200};
    reply(ack,{ok:true}); emitGameStates(room);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode), p = findPlayer(room, socket.data.playerId);
    clientRoom.delete(socket.id);
    if (!room || !p || p.socketId !== socket.id) return;
    p.connected = false; p.input = { dx: 0, dy: 0 }; p.fixStation = null;
    if (p.currentTaskId) { const activeTask = p.tasks?.find(t => t.id === p.currentTaskId); if (activeTask) { activeTask.startedAt = 0; delete activeTask.challenge; } p.currentTaskId = null; }
    if (p.role === 'glitch' && room.phase !== 'lobby' && room.phase !== 'ended') finishGame(room, 'workers', 'The Glitch left the shift!');
    if (room.hostId === p.id) {
      const next = [...room.players.values()].filter(x => x.connected && x.id !== p.id).sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (next) room.hostId = next.id;
    }
    p.cleanupTimer = setTimeout(() => { const latest = rooms.get(room.code); if (latest && !p.connected) removePlayer(latest, p); }, RECONNECT_GRACE_MS);
    p.cleanupTimer.unref?.(); broadcastRoom(room); if (activeGame(room)) emitGameStates(room);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => console.log(`Toy Factory server listening on 0.0.0.0:${PORT}`));
