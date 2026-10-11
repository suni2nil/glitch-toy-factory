import { io } from 'socket.io-client';
import { roomAt } from '../../shared/factory-map.js';
import { drawFactoryMap } from './factory-map-renderer.js';
import { BUZZER_POINT, CONVEYOR_TUNNELS, JAM_STATIONS } from '../../shared/game-config.js';
import { getMuted, playSfx, startAudio, toggleMute } from './audio.js';
import './style.css';

const COLORS = ['#ff6b6b', '#43c6ac', '#ffc857', '#8b7cff', '#ff8ac6', '#55a7ff', '#ff914d', '#a7d957'];
const HATS = ['none', 'cap', 'crown', 'cone', 'propeller'];
const FACES = ['smile', 'wink', 'wow', 'cool'];
const HAT_LABELS = { none: 'No hat', cap: 'Cap', crown: 'Crown', cone: 'Party cone', propeller: 'Propeller' };
const FACE_LABELS = { smile: 'Smile', wink: 'Wink', wow: 'Wow', cool: 'Cool' };
const EMOJIS = { smile: '☺', wink: '😉', wow: '◉', cool: '⌐■' };
const socket = io({ autoConnect: true });
const params = new URLSearchParams(location.search);
const savedId = sessionStorage.getItem('toy-player-id');
const playerId = savedId || makeId();
sessionStorage.setItem('toy-player-id', playerId);
let savedAvatar = safeJson(localStorage.getItem('toy-avatar'), { color: COLORS[0], hat: 'none', face: 'smile' });
let state = {
  screen: 'landing', room: null, error: '', busy: false, name: localStorage.getItem('toy-name') || '',
  avatar: savedAvatar, connected: socket.connected, copied: false, notice: '', gameState: null,
  myRole: null, myAlive: true, privateTasks: [], activeTask: null, mini: null, chatMessages: [], roleReveal: null,
  emoteWheel: false, chatOpen: false, tutorialOpen: localStorage.getItem('toy-tutorial-done') !== '1',
  invitePrefill: (params.get('room') || '').toUpperCase().slice(0, 5)
};
const pressedKeys = new Set();
const moveInput = { dx: 0, dy: 0 };
const joystickInput = { dx: 0, dy: 0 };
const visualPlayers = new Map();
let mapFrame = 0;
let joystickPointer = null;

function makeId() { return 'toy_' + (crypto.randomUUID?.().replaceAll('-', '') || Math.random().toString(36).slice(2) + Date.now().toString(36)); }
function safeJson(text, fallback) { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function self() { return state.room?.players.find(p => p.id === state.room?.selfId) || state.room?.players.find(p => p.id === playerId); }
function colorName(hex) { return ({ '#ff6b6b':'Coral', '#43c6ac':'Mint', '#ffc857':'Sunshine', '#8b7cff':'Violet', '#ff8ac6':'Bubblegum', '#55a7ff':'Sky', '#ff914d':'Tangerine', '#a7d957':'Lime' })[hex] || 'Toy'; }
function avatarMarkup(avatar = {}, size = 'normal', isGhost = false) {
  const color = avatar.color || COLORS[0];
  const hat = avatar.hat || 'none';
  const hatEmoji = { none: '', cap: '🧢', crown: '👑', cone: '🔺', propeller: '🚁' }[hat];
  return `<span class="toy-avatar ${size} ${isGhost ? 'ghost' : ''}" style="--toy:${color}"><span class="toy-hat">${hatEmoji}</span><span class="toy-face">${EMOJIS[avatar.face] || '☺'}</span><span class="toy-body"></span><span class="toy-feet"><i></i><i></i></span></span>`;
}
function muteButton() { return `<button id="mute-audio" class="mute-audio" title="${getMuted()?'Unmute sounds':'Mute sounds'}">${getMuted()?'🔇':'🔊'} <span>${getMuted()?'SOUND OFF':'SOUND ON'}</span></button>`; }
function tutorialView() { return `<div class="tutorial-backdrop"><section class="tutorial-card"><div class="tutorial-toy">🧸</div><small>QUICK TOY-MAKER ORIENTATION</small><h2>Welcome to the night shift!</h2><div class="tutorial-steps"><p><b>1</b><span>Move with <strong>WASD / arrows</strong>, or drag the touch joystick.</span></p><p><b>2</b><span>Workers finish glowing mini-game tasks. The Glitch can short-circuit and sabotage.</span></p><p><b>3</b><span>Report bodies, discuss, and vote. Ghost workers can still finish tasks!</span></p></div><button id="tutorial-close" class="button button-primary">Got it—let’s play! ✦</button></section></div>`; }
function setError(message = '') { state.error = message; render(); }
function toast(message) { state.notice = message; render(); setTimeout(() => { if (state.notice === message) { state.notice = ''; render(); } }, 2300); }
function persistProfile() { localStorage.setItem('toy-name', state.name); localStorage.setItem('toy-avatar', JSON.stringify(state.avatar)); }
function emitAck(event, payload) {
  return new Promise(resolve => socket.emit(event, payload, response => resolve(response || { ok: false, error: 'The factory server did not respond.' })));
}

socket.on('connect', () => {
  const needsRejoin = Boolean(state.room && !state.connected);
  state.connected = true;
  render();
  if (needsRejoin) rejoinActiveRoom();
});
socket.on('disconnect', () => { state.connected = false; pressedKeys.clear(); joystickInput.dx = 0; joystickInput.dy = 0; recomputeMoveInput(); render(); });
socket.on('room:state', incoming => {
  if (!state.room || incoming.code !== state.room.code) return;
  const wasMap = state.screen === 'map';
  state.room = { ...incoming, selfId: playerId };
  if (incoming.phase === 'started') {
    if (!wasMap) { visualPlayers.clear(); visualPlayers.lastFrame = 0; }
    state.screen = 'map';
    if (!state.gameState) state.gameState = { code: incoming.code, players: incoming.players.filter(p => Number.isFinite(p.x)) };
  } else if (incoming.phase === 'lobby') {
    if (wasMap) { visualPlayers.clear(); visualPlayers.lastFrame = 0; }
    state.screen = 'lobby'; state.gameState = null; state.myRole = null; state.myAlive = true;
    state.privateTasks = []; state.activeTask = null; state.mini = null; state.chatMessages = []; state.roleReveal = null;
  } else if (incoming.phase === 'ended') { state.screen = 'end'; }
  render();
});
socket.on('game:state', incoming => {
  if (!state.room || incoming.code !== state.room.code) return;
  const previousScreen = state.screen, previousPhase = state.gameState?.phase;
  const previousSabotage = state.gameState?.sabotage?.type, previousAlive = state.gameState?.own?.alive;
  state.gameState = incoming;
  if (incoming.phase === 'meeting_discussion' && previousPhase !== 'meeting_discussion') { state.chatMessages = incoming.meeting?.messages || []; playSfx('report'); }
  if (incoming.phase === 'meeting_reveal' && previousPhase === 'meeting_voting') playSfx('vote');
  if (incoming.phase === 'ended' && previousPhase !== 'ended') playSfx('win');
  if (incoming.sabotage?.type && incoming.sabotage.type !== previousSabotage) playSfx('sabotage');
  if (previousAlive === true && incoming.own?.alive === false) {
    playSfx('kill'); setTimeout(()=>{const board=document.querySelector('.map-board');if(board){board.classList.remove('screen-shake');void board.offsetWidth;board.classList.add('screen-shake');setTimeout(()=>board.classList.remove('screen-shake'),480);}},0);
  }
  if (incoming.own) state.myAlive = incoming.own.alive;
  if (incoming.meeting?.messages && !state.chatMessages.length) state.chatMessages = incoming.meeting.messages;
  if (['meeting_discussion','meeting_voting','meeting_reveal'].includes(incoming.phase)) state.screen = 'meeting';
  else if (incoming.phase === 'ended') state.screen = 'end';
  else state.screen = 'map';
  if (state.screen !== previousScreen || incoming.phase !== previousPhase || incoming.sabotage?.type !== previousSabotage || incoming.own?.alive !== previousAlive) render();
  if (state.screen === 'meeting') updateMeetingClock();
});
socket.on('role:assigned', data => {
  state.myRole = data.role;
  state.myAlive = data.alive;
  state.roleReveal = { role: data.role, alive: data.alive, token: Date.now() };
  const token = state.roleReveal.token;
  if (state.screen === 'map' || state.screen === 'meeting' || state.screen === 'end') render();
  setTimeout(()=>{if(state.roleReveal?.token===token){state.roleReveal=null;render();}},3200);
});
socket.on('tasks:private', tasks => {
  state.privateTasks = Array.isArray(tasks) ? tasks : [];
  if (state.screen === 'map') render();
});
socket.on('meeting:message', message => {
  state.chatMessages.push(message);
  state.chatMessages = state.chatMessages.slice(-50);
  if (state.screen === 'meeting') { render(); scrollChatToBottom(); }
});

async function createRoom() {
  startAudio(); state.busy = true; state.error = ''; persistProfile(); render();
  const res = await emitAck('room:create', { name: state.name, avatar: state.avatar, playerId });
  state.busy = false;
  if (!res.ok) { setError(res.error); return; }
  enterRoom(res.room, res.playerId);
}
async function joinRoom(code) {
  startAudio(); state.busy = true; state.error = ''; persistProfile(); render();
  const res = await emitAck('room:join', { code, name: state.name, avatar: state.avatar, playerId });
  state.busy = false;
  if (!res.ok) { setError(res.error); return; }
  enterRoom(res.room, res.playerId);
}
function enterRoom(room, id = playerId) {
  playSfx('join');
  sessionStorage.setItem('toy-player-id', id);
  state.room = { ...room, selfId: id };
  state.screen = room.phase === 'started' ? 'map' : room.phase === 'ended' ? 'end' : 'lobby';
  state.gameState = room.phase === 'started' ? { code: room.code, players: room.players.filter(p => Number.isFinite(p.x)) } : null;
  state.error = '';
  state.invitePrefill = room.code;
  history.replaceState({}, '', `${location.pathname}?room=${room.code}`);
  render();
}
async function rejoinActiveRoom() {
  const code = state.room?.code;
  if (!code) return;
  const res = await emitAck('room:join', { code, name: state.name, avatar: state.avatar, playerId });
  if (res.ok) { enterRoom(res.room, res.playerId); return; }
  state.room = null;
  state.screen = 'landing';
  state.error = res.error;
  history.replaceState({}, '', location.pathname);
  render();
}
async function readyToggle() {
  const me = self(); if (!me) return;
  const result = await emitAck('player:ready', !me.ready);
  if (!result.ok) toast(result.error);
}
async function updateAvatar(key, value) {
  state.avatar = { ...state.avatar, [key]: value };
  persistProfile(); render();
  const result = await emitAck('player:avatar', state.avatar);
  if (!result.ok) toast(result.error);
}
async function updateName(value) {
  state.name = value.slice(0, 16);
  persistProfile();
  if (state.room) {
    const res = await emitAck('player:name', state.name);
    if (!res.ok) toast(res.error);
  }
}
async function startShift() {
  startAudio(); state.error = '';
  const result = await emitAck('room:start', {});
  if (!result.ok) setError(result.error);
}
async function resetLobby() {
  const result = await emitAck('room:reset', {});
  if (!result.ok) toast(result.error);
}
async function copyInvite() {
  const link = `${location.origin}${location.pathname}?room=${state.room.code}`;
  try { await navigator.clipboard.writeText(link); }
  catch {
    const input = document.createElement('textarea'); input.value = link; document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
  }
  state.copied = true; render();
  setTimeout(() => { state.copied = false; render(); }, 1800);
}
async function leaveRoom() {
  await emitAck('room:leave', {});
  state.room = null; state.screen = 'landing'; state.error = '';
  state.myRole = null; state.myAlive = true; state.privateTasks = []; state.activeTask = null; state.gameState = null; state.chatMessages = [];
  history.replaceState({}, '', location.pathname);
  render();
}
function myPosition() { return state.gameState?.players?.find(p => p.id === (state.room?.selfId || playerId)) || self() || {}; }
function nearbyIncompleteTask() {
  const p = myPosition();
  return state.privateTasks.filter(t => !t.completed).map(t => ({ task: t, d: Math.hypot(p.x - t.x, p.y - t.y) })).sort((a,b)=>a.d-b.d).find(x=>x.d<72)?.task;
}
function nearbyBody() {
  const p = myPosition();
  return (state.gameState?.bodies || []).map(b => ({ body:b, d:Math.hypot(p.x-b.x,p.y-b.y) })).sort((a,b)=>a.d-b.d).find(x=>x.d<75)?.body;
}
async function startTask(task) {
  if (state.activeTask || !task || state.myRole !== 'worker') return;
  const res = await emitAck('task:begin', { taskId: task.id });
  if (!res.ok) return toast(res.error);
  state.activeTask = { ...res.task, minimumMs: res.minimumMs || 5000, localStartedAt: Date.now() };
  state.mini = makeMiniState(res.task.kind, res.task.challenge || {});
  render();
}
function makeMiniState(kind, challenge = {}) {
  const colors = ['coral', 'sky', 'sun'];
  if (kind === 'wires') return { left: colors, right: [...colors].sort(()=>Math.random()-.5), selected: '', connected: [] };
  if (kind === 'sort') return { toys: [{id:'duck',icon:'🦆'},{id:'bear',icon:'🧸'},{id:'brick',icon:'🧱'}], selected: '', sorted: [] };
  if (kind === 'paint') return { painting: false, progress: 0, paintHoldMs: 0, message: 'Hold to fill the duck. Let go in the mint-green zone!' };
  if (kind === 'stack') return { hits: 0, hitPhases: [], startedAt: performance.now(), message: 'Tap when the moving block crosses the golden zone.' };
  if (kind === 'keycard') return { dragging: false, startedAt: 0, progress: 0, swipeMs: 0, message: 'Swipe smoothly from left to right.' };
  const sequence = challenge.sequence || Array.from({length:3},()=>Math.floor(Math.random()*4));
  const mini = { sequence, entered: [], showSequence: true, localFlashAt: Date.now(), message: 'Watch the lights, then repeat the pattern.' };
  setTimeout(()=>{ if (state.activeTask?.kind === 'memory' && state.mini === mini) { mini.showSequence=false; render(); } }, 1300);
  return mini;
}
function taskSolution() {
  const m=state.mini;
  if(!m)return {};
  if(state.activeTask?.kind==='wires')return {connections:[...m.connected]};
  if(state.activeTask?.kind==='sort')return {sorted:[...m.sorted]};
  if(state.activeTask?.kind==='paint')return {holdMs:m.paintHoldMs||0};
  if(state.activeTask?.kind==='stack')return {hits:[...m.hitPhases]};
  if(state.activeTask?.kind==='keycard')return {swipeMs:m.swipeMs||0,progress:m.progress||0};
  if(state.activeTask?.kind==='memory')return {sequence:[...m.entered]};
  return {};
}
function finishTaskPuzzle() {
  if (!state.activeTask || !state.mini || state.mini.finished) return;
  state.mini.finished = true; state.mini.message = 'Toy-tally complete! Packing it up…'; render();
  const wait = Math.max(0, state.activeTask.localStartedAt + state.activeTask.minimumMs - Date.now());
  setTimeout(async () => {
    if (!state.activeTask) return;
    const res = await emitAck('task:complete', { taskId: state.activeTask.id, solution: taskSolution() });
    if (!res.ok) { if (state.mini) { state.mini.finished = false; state.mini.message = res.error; render(); } return; }
    playSfx('task'); state.activeTask = null; state.mini = null; render();
  }, wait);
}
async function cancelTask() {
  if (!state.activeTask) return;
  await emitAck('task:cancel', { taskId: state.activeTask.id });
  state.activeTask = null; state.mini = null; render();
}
async function attemptKill() {
  if (state.myRole !== 'glitch' || !state.myAlive) return;
  const p = myPosition();
  const target = (state.gameState?.players || []).filter(x => x.id !== playerId && x.alive && !x.ghost)
    .map(x => ({ player:x, d:Math.hypot(x.x-p.x,x.y-p.y) })).sort((a,b)=>a.d-b.d).find(x=>x.d<72)?.player;
  if (!target) return toast('No worker close enough to short-circuit.');
  const res = await emitAck('kill:attempt', { targetId: target.id });
  if (!res.ok) toast(res.error);
}
async function requestReport() {
  if (!state.myAlive) return toast('Ghost toys cannot call the living crew.');
  const body = nearbyBody();
  if (!body) return toast('No reportable toy nearby.');
  const res = await emitAck('report:request', { bodyId: body.id }); if (!res.ok) toast(res.error);
}
async function pressBuzzer() {
  const res = await emitAck('report:request', { emergency: true }); if (!res.ok) toast(res.error);
}
async function useTunnel() {
  const res = await emitAck('tunnel:use', {}); if (!res.ok) toast(res.error);
}
async function triggerSabotage(type) {
  const res = await emitAck('sabotage:trigger', type); if (!res.ok) toast(res.error);
}
function holdJam(station, hold) { socket.emit('sabotage:fix', { station, hold }); }
function sendVote(target) { socket.emit('meeting:vote', target, res => { if (!res?.ok) toast(res?.error || 'Vote was not counted.'); }); }
function submitMeetingChat(text = '') {
  if (!text.trim()) return;
  socket.emit('meeting:chat', { text });
  const input = document.getElementById('meeting-chat-input'); if (input) input.value = '';
}
function submitGameChat(text = '', quick = '') {
  if (!state.myAlive) return toast('Ghost toys cannot chat with the living.');
  socket.emit('game:chat', { text, quick }, res => { if (!res?.ok) toast(res?.error || 'Message not sent.'); });
  state.chatOpen = false; render();
}
function playEmote(type) {
  state.emoteWheel = false; render();
  socket.emit('emote:play', type, res => { if (!res?.ok) toast(res?.error || 'Emote unavailable.'); });
  playSfx('emote');
}
function muteSounds() { toggleMute(); playSfx('click'); render(); }
function scrollChatToBottom() { const box = document.getElementById('meeting-chat-log'); if (box) box.scrollTop = box.scrollHeight; }
function updateMeetingClock() {
  const timer = document.getElementById('meeting-clock');
  if (timer && state.gameState?.meeting?.endAt) timer.textContent = `${Math.max(0, Math.ceil((state.gameState.meeting.endAt - Date.now()) / 1000))}s`;
}

function factoryArt() {
  return `<div class="factory-art" aria-hidden="true">
    <span class="art-spark spark-a">✦</span><span class="art-spark spark-b">✧</span><span class="art-duck">🦆</span>
    <svg viewBox="0 0 520 365" role="presentation">
      <ellipse cx="262" cy="329" rx="208" ry="20" fill="#d7c4a1" opacity=".35"/>
      <path d="M95 148 255 59l169 89v163H95z" fill="#8b7cff" stroke="#443778" stroke-width="9" stroke-linejoin="round"/>
      <path d="M95 148 255 59l169 89-168 92z" fill="#b8a7ff" stroke="#443778" stroke-width="9" stroke-linejoin="round"/>
      <path d="m255 240 169-92v163l-168 89z" fill="#7560df" stroke="#443778" stroke-width="9" stroke-linejoin="round"/>
      <path d="M95 148v163l160 89V240z" fill="#ffbf53" stroke="#443778" stroke-width="9" stroke-linejoin="round"/>
      <path d="m95 148 160 92 169-92" fill="none" stroke="#443778" stroke-width="9" stroke-linejoin="round"/>
      <path d="M145 176v112l68 39V215z" fill="#fff3d4" stroke="#443778" stroke-width="7" stroke-linejoin="round"/>
      <path d="M278 211v119l46-25V186z" fill="#ff8ac6" stroke="#443778" stroke-width="7" stroke-linejoin="round"/>
      <path d="M221 101v41m0-20h-22m22 0h24" stroke="#fff7dc" stroke-width="9" stroke-linecap="round"/>
      <path d="M321 117v31m0-15h-17m17 0h18" stroke="#fff7dc" stroke-width="8" stroke-linecap="round"/>
      <rect x="63" y="251" width="75" height="64" rx="12" fill="#43c6ac" stroke="#443778" stroke-width="7" transform="rotate(-8 63 251)"/>
      <circle cx="82" cy="248" r="8" fill="#a7f1d9"/><circle cx="116" cy="244" r="8" fill="#a7f1d9"/>
      <rect x="370" y="263" width="84" height="62" rx="12" fill="#ff6b6b" stroke="#443778" stroke-width="7" transform="rotate(8 370 263)"/>
      <circle cx="391" cy="261" r="8" fill="#ffb1a5"/><circle cx="429" cy="267" r="8" fill="#ffb1a5"/>
      <path d="M164 335h58m131-13h43" stroke="#443778" stroke-width="9" stroke-linecap="round"/>
    </svg>
    <span class="art-worker worker-one">${avatarMarkup({ color: '#43c6ac', hat: 'cap', face: 'wink' }, 'tiny')}</span>
    <span class="art-worker worker-two">${avatarMarkup({ color: '#ff6b6b', hat: 'crown', face: 'wow' }, 'tiny')}</span>
    <span class="art-label">NIGHT SHIFT<br><b>TOYS INSIDE!</b></span>
  </div>`;
}

function landingView() {
  return `<main class="landing-shell">
    <header class="topbar"><a class="brand" href="#" aria-label="Toy Factory home"><span class="brand-mark">✦</span> PLAYTIME <span>WORKS</span></a><div class="landing-top-actions">${muteButton()}<div class="server-status"><i class="status-dot ${state.connected ? '' : 'offline'}"></i>${state.connected ? 'Factory link online' : 'Reconnecting…'}</div></div></header>
    <section class="hero-grid">
      <div class="hero-copy">
        <div class="eyebrow"><span class="eyebrow-star">✦</span> A SOCIAL DEDUCTION PARTY GAME</div>
        <h1>GLITCH IN<br/>THE <span>TOY FACTORY</span></h1>
        <p class="hero-sub">The night shift is almost done. One worker is acting a little… <b>too glitchy.</b></p>
        ${factoryArt()}
        <div class="feature-stamps"><span>🧸 3–5 PLAYERS</span><span>🔎 TRUST NO TINSEL</span><span>🎨 ALL TOYS WELCOME</span></div>
      </div>
      <div class="setup-card">
        <div class="card-tape"></div><div class="card-kicker">FIRST THINGS FIRST</div>
        <h2>Clock in, toy maker!</h2>
        <label class="field-label" for="player-name">YOUR WORKER NAME</label>
        <input id="player-name" class="text-input" type="text" maxlength="16" placeholder="e.g. Bouncy Bean" value="${esc(state.name)}" autocomplete="nickname" />
        <div class="your-toy-row">${avatarMarkup(state.avatar, 'small')}<div><b>Your little toy</b><span>${colorName(state.avatar.color)} worker · customize in the lobby</span></div></div>
        <button class="button button-primary button-wide" id="create-room" ${state.busy || !state.connected ? 'disabled' : ''}><span>＋</span> Create a Room <b>›</b></button>
        <div class="or-line"><span></span>OR JOIN YOUR CREW<span></span></div>
        <form id="join-form" class="join-form"><input id="room-code" class="text-input room-code-input" type="text" maxlength="5" placeholder="ROOM CODE" value="${esc(state.invitePrefill)}" aria-label="Room code"/><button class="button button-dark" type="submit" ${state.busy || !state.connected ? 'disabled' : ''}>Join <b>›</b></button></form>
        ${state.error ? `<p class="error-note" role="alert">⚠ ${esc(state.error)}</p>` : ''}
        <p class="privacy-note">🔒 Your room is private. Share the invite link with friends.</p>
      </div>
    </section>
    <footer class="landing-footer"><span>MADE WITH EXTRA GLITTER & QUESTIONABLE NIGHT-SHIFT DECISIONS</span><span>THE NIGHT SHIFT IS READY <b>✦</b></footer>
  </main>`;
}

function avatarPicker() {
  return `<section class="customizer"><div class="customizer-head"><div><small>YOUR WORKER</small><h3>Make it yours</h3></div>${avatarMarkup(state.avatar, 'medium')}</div>
    <div class="custom-row"><label>BODY COLOR</label><div class="swatches">${COLORS.map(color => `<button class="swatch ${state.avatar.color === color ? 'selected' : ''}" data-color="${color}" title="${colorName(color)}" style="--swatch:${color}" aria-label="${colorName(color)} body color"></button>`).join('')}</div></div>
    <div class="custom-row"><label>HAT</label><div class="select-wrap"><select id="hat-select">${HATS.map(hat => `<option value="${hat}" ${state.avatar.hat === hat ? 'selected' : ''}>${HAT_LABELS[hat]}</option>`).join('')}</select><span>⌄</span></div></div>
    <div class="custom-row"><label>FACE</label><div class="face-options">${FACES.map(face => `<button class="face-chip ${state.avatar.face === face ? 'selected' : ''}" data-face="${face}" title="${FACE_LABELS[face]}">${EMOJIS[face]}</button>`).join('')}</div></div>
    <p class="free-note">✦ All cosmetics are free. Looking goofy is its own reward.</p></section>`;
}
function playerCard(p) {
  const isMe = p.id === playerId;
  const isHost = p.id === state.room.hostId;
  return `<div class="player-tile ${isMe ? 'is-me' : ''} ${!p.connected ? 'is-offline' : ''}">
    <div class="player-avatar-wrap">${avatarMarkup(p.avatar, 'normal', !p.connected)}${isHost ? '<span class="host-crown" title="Host">★</span>' : ''}</div>
    <div class="player-info"><div class="player-name">${esc(p.name)} ${isMe ? '<span class="you-tag">YOU</span>' : ''}</div><div class="player-sub">${isHost ? 'Shift captain' : colorName(p.avatar.color) + ' worker'}${!p.connected ? ' · reconnecting' : ''}</div></div>
    <div class="ready-badge ${p.ready ? 'ready' : ''} ${!p.connected ? 'offline' : ''}">${!p.connected ? 'LINK LOST' : p.ready ? 'READY!' : 'GETTING READY'}</div>
  </div>`;
}
function lobbyView() {
  const room = state.room;
  const me = self();
  const isHost = me?.id === room.hostId;
  const allConnected = room.players.every(p => p.connected);
  const startOk = room.players.length >= 3 && allConnected && isHost;
  const invite = `${location.origin}${location.pathname}?room=${room.code}`;
  const blanks = Math.max(0, 5 - room.players.length);
  return `<main class="room-shell">
    <header class="room-topbar"><a class="brand" href="#"><span class="brand-mark">✦</span> PLAYTIME <span>WORKS</span></a><div class="room-top-actions">${muteButton()}<div class="server-status"><i class="status-dot ${state.connected ? '' : 'offline'}"></i>${state.connected ? 'ONLINE' : 'RECONNECTING'}</div><button class="text-button" id="leave-room">← Leave room</button></div></header>
    <div class="lobby-wrap">
      <div class="room-heading"><div><div class="eyebrow"><span class="eyebrow-star">✦</span> FACTORY BREAK ROOM</div><h1>Waiting for the <span>night shift</span></h1><p>Get your crew together. Keep an eye on everyone… especially everyone.</p></div><div class="step-stamp">STEP 1 <small>LOBBY</small></div></div>
      <div class="invite-banner"><div class="invite-icon">🔑</div><div class="invite-copy"><small>YOUR ROOM CODE</small><strong>${room.code}</strong></div><div class="invite-link"><span>${esc(invite)}</span></div><button id="copy-invite" class="button button-copy">${state.copied ? '✓ Copied!' : '↗ Copy Invite'}</button></div>
      <div class="lobby-grid">
        <section class="crew-panel"><div class="panel-heading"><div><small>THE CREW</small><h2>Workers <span>${room.players.length}<i>/5</i></span></h2></div><div class="tiny-status"><i></i> ${allConnected ? 'All links stable' : 'Reconnecting crew'}</div></div>
          <div class="crew-list">${room.players.map(playerCard).join('')}${Array.from({ length: blanks }, (_, i) => `<div class="player-tile empty-slot"><div class="empty-avatar">＋</div><div class="player-info"><div class="player-name">Open worker slot</div><div class="player-sub">Waiting on your friend…</div></div><span class="slot-label">${room.players.length + i + 1}/5</span></div>`).join('')}</div>
          <div class="crew-bottom"><div class="ready-counter"><span class="pulse-dot"></span>${room.players.filter(p => p.ready).length} READY <span class="counter-divider">·</span> ${Math.max(0, 3 - room.players.length)} MORE TO START</div><div class="crew-actions"><button class="button ${me?.ready ? 'button-ready' : 'button-ready-off'}" id="ready-toggle">${me?.ready ? '✓ Ready!' : 'I’m Ready'}</button>${isHost ? `<button class="button button-start" id="start-shift" ${startOk ? '' : 'disabled'}>Start Night Shift <b>›</b></button>` : `<div class="host-wait">Waiting for the captain to start…</div>`}</div></div>
          ${room.players.length < 3 ? '<p class="start-hint">Invite at least <b>' + (3 - room.players.length) + ' more player' + (3 - room.players.length === 1 ? '' : 's') + '</b> to unlock the shift.</p>' : !allConnected ? '<p class="start-hint warning-hint">A worker lost connection. The captain can start when they return.</p>' : ''}
          ${state.error ? `<p class="error-note" role="alert">⚠ ${esc(state.error)}</p>` : ''}
        </section>
        ${avatarPicker()}
      </div>
      <div class="lobby-tip"><span>📣 FACTORY ANNOUNCEMENT</span><b>“Keep your ears open. Someone’s acting suspiciously squeaky…”</b></div>
      <div class="progress-steps"><span class="active">01&nbsp; LOBBY</span><i></i><span>02&nbsp; FACTORY MAP</span><i></i><span>03&nbsp; MYSTERY</span><i></i><span>04&nbsp; MEETING</span></div>
    </div>
  </main>`;
}
function taskPuzzleMarkup() {
  const m=state.mini||{}; const kind=state.activeTask?.kind;
  if(kind==='wires') return `<p>Connect every matching plug. Tap a wire on the left, then its twin.</p><div class="wire-board"><div class="wire-column">${m.left.map(c=>`<button class="wire-plug ${m.selected===c?'picked':''} ${m.connected.includes(c)?'connected':''}" data-wire-left="${c}"><i class="wire-dot ${c}"></i>${m.connected.includes(c)?'✓':'CONNECT'}</button>`).join('')}</div><div class="wire-middle">${m.connected.map(()=>'<span>╲╱</span>').join('')||'⇄'}</div><div class="wire-column">${m.right.map(c=>`<button class="wire-plug ${m.connected.includes(c)?'connected':''}" data-wire-right="${c}" ${m.connected.includes(c)?'disabled':''}><i class="wire-dot ${c}"></i>${m.connected.includes(c)?'✓':'PLUG'}</button>`).join('')}</div></div><div class="puzzle-counter">${m.connected.length} / 3 CONNECTIONS</div>`;
  if(kind==='sort') return `<p>Pick each toy, then drop it in the matching bin.</p><div class="sort-toys">${m.toys.filter(t=>!m.sorted.includes(t.id)).map(t=>`<button class="sort-toy ${m.selected===t.id?'picked':''}" data-sort-toy="${t.id}">${t.icon}<small>${t.id.toUpperCase()}</small></button>`).join('')||'<span class="puzzle-all-done">All toys sorted! ✨</span>'}</div><div class="sort-bins">${[['duck','🦆','DUCKS'],['bear','🧸','PLUSH'],['brick','🧱','BLOCKS']].map(([id,icon,label])=>`<button class="sort-bin ${m.selected===id?'bin-target':''}" data-sort-bin="${id}">${icon}<small>${label}</small></button>`).join('')}</div><div class="puzzle-counter">${m.sorted.length} / 3 TOYS SORTED</div>`;
  if(kind==='paint') return `<p>Hold the brush to fill the duck. Stop in the sweet spot!</p><div class="duck-canvas"><span>🦆</span><small>TOY DUCK · FACTORY FRESH</small></div><div class="paint-track"><i id="paint-fill" style="width:${m.progress||0}%"></i><b></b></div><button class="paint-hold" id="paint-hold" ${m.finished?'disabled':''}>🖌️ &nbsp; HOLD TO PAINT</button><small class="target-hint">Release between 68% and 84%</small>`;
  if(kind==='stack') { const marker=((((performance.now()-(m.startedAt||performance.now()))%1350)/1350)*100); return `<p>Tap when the moving block is over the gold zone. Stack three!</p><div class="stack-tower">${Array.from({length:m.hits||0},(_,i)=>`<div style="--brick:${['#ff6b6b','#55a7ff','#ffc857'][i]}"></div>`).join('')}<small>${m.hits||0} / 3</small></div><div class="stack-gauge"><i class="stack-zone"></i><i class="stack-marker" id="stack-marker" style="left:${marker}%"></i></div><button class="button button-primary stack-button" id="stack-tap">🧱 &nbsp; STACK!</button><small class="target-hint">Aim for the golden band</small>`; }
  if(kind==='keycard') return `<p>Swipe the toy-maker card through at a steady speed.</p><div class="keycard-reader"><div class="reader-light">● READY</div><div class="reader-slot"><span>FACTORY ACCESS</span><b>WORKER</b></div></div><div class="keycard-track" id="keycard-track"><i style="width:${m.progress||0}%"></i><b id="keycard-card" style="left:${m.progress||0}%">🪪</b><span>SWIPE THIS WAY&nbsp; →</span></div><small class="target-hint">Press and drag all the way across smoothly</small>`;
  const seq=(m.sequence||[]).map(i=>['🔴','🔵','🟡','🟢'][i]).join('  ');
  return `<p>${m.showSequence?'Watch the pattern, then repeat it!':'Tap the lights in the same order.'}</p><div class="memory-display">${m.showSequence?seq:'✦  YOUR TURN  ✦'}</div><div class="memory-grid">${['red','blue','yellow','green'].map((c,i)=>`<button class="memory-light ${m.showSequence&&m.sequence?.[Math.floor((Date.now()-(m.localFlashAt||Date.now()))/260)%m.sequence.length]===i?'flashing':''}" data-memory="${i}" aria-label="${c} light"></button>`).join('')}</div><div class="puzzle-counter">${(m.entered||[]).length} / ${(m.sequence||[]).length} LIGHTS</div>`;
}
function roleRevealView() {
  const glitch=state.roleReveal?.role==='glitch';
  return `<div class="role-reveal-backdrop"><section class="role-reveal-card ${glitch?'is-glitch':'is-worker'}"><div class="role-mystery">${glitch?'🌀':'🧸'}</div><small>YOUR NIGHT-SHIFT SECRET</small><h2>${glitch?'YOU ARE THE GLITCH':'YOU ARE A WORKER'}</h2><p>${glitch?'Blend in. Short-circuit workers, sabotage the factory, and stay squeak-free.':'Finish your glowing tasks, watch for suspicious behavior, and keep the factory humming.'}</p><button id="dismiss-role" class="button ${glitch?'button-dark':'button-primary'}">Clock in! ›</button></section></div>`;
}
function taskModalView() {
  const task=state.activeTask;
  return `<div class="task-modal-backdrop"><section class="task-modal"><header><div><small>FACTORY MINI-GAME · ${esc(task.room)}</small><h2>${esc(task.title)}</h2></div><button id="task-close" class="task-close" aria-label="Close task">×</button></header><div class="mini-game-body">${taskPuzzleMarkup()}</div><div class="mini-message ${state.mini?.finished?'success':''}" id="mini-message">${esc(state.mini?.message||'Complete the toy-maker challenge!')}</div></section></div>`;
}
function mapView() {
  const room = state.room, me = self(), pos = myPosition();
  const where = Number.isFinite(pos.x) ? roomAt(pos.x, pos.y) : 'Factory Floor';
  const progress = state.gameState?.taskProgress || { done: 0, total: state.privateTasks.length };
  const own = state.gameState?.own || {}, sabotage = state.gameState?.sabotage;
  const taskRows = state.myRole === 'worker' ? state.privateTasks.map(task => {
    const near = Math.hypot((pos.x||0)-task.x,(pos.y||0)-task.y)<72;
    return `<button class="task-row ${task.completed?'done':''} ${near?'near':''}" data-task="${task.id}" ${task.completed || state.activeTask?'disabled':''}><span class="task-check">${task.completed?'✓':near?'!':'○'}</span><span><b>${esc(task.title)}</b><small>${esc(task.room)}${near?' · press E':''}</small></span><i>${task.completed?'DONE':near?'HERE':'TASK'}</i></button>`;
  }).join('') : '<div class="glitch-mission"><span>🌀</span><b>Keep the crew guessing.</b><small>Short-circuit a nearby worker or stir up factory trouble.</small></div>';
  const target = (state.gameState?.players || []).filter(p=>p.id!==playerId&&p.alive&&!p.ghost).map(p=>({p,d:Math.hypot(p.x-pos.x,p.y-pos.y)})).sort((a,b)=>a.d-b.d).find(x=>x.d<72)?.p;
  const body = nearbyBody();
  const buzzerNear = Math.hypot(pos.x-BUZZER_POINT.x,pos.y-BUZZER_POINT.y)<68;
  const tunnelNear = CONVEYOR_TUNNELS.some(t=>Math.hypot(pos.x-t.x,pos.y-t.y)<58);
  const jamNearest = JAM_STATIONS.map(t=>({station:t,d:Math.hypot(pos.x-t.x,pos.y-t.y)})).sort((a,b)=>a.d-b.d)[0];
  const jamStation = jamNearest?.d<75 ? jamNearest.station : null;
  const glitch = state.myRole === 'glitch';
  return `<main class="map-shell">
    <header class="map-topbar"><a class="brand" href="#"><span class="brand-mark">✦</span> PLAYTIME <span>WORKS</span></a><div class="map-top-center"><span class="map-live-dot"></span> NIGHT SHIFT <i>·</i> ROOM <b>${room.code}</b></div><div class="map-top-actions">${muteButton()}<div class="server-status"><i class="status-dot ${state.connected?'':'offline'}"></i>${state.connected?'SYNCED':'RECONNECTING'}</div>${me?.id===room.hostId?'<button id="back-lobby" class="map-text-button">↶ Lobby</button>':''}<button class="map-text-button" id="leave-room">Leave</button></div></header>
    <div class="map-heading"><div><div class="eyebrow"><span class="eyebrow-star">✦</span> FACTORY FLOOR · ${glitch?'GLITCH CONSOLE':'NIGHT SHIFT'}</div><h1>Mind the moving parts<span>!</span></h1><p>Keep moving. The factory is full of little jobs—and one big secret.</p></div><div class="map-heading-stamp">20<small>UPDATES / SEC</small></div></div>
    <div class="task-progress-strip"><div class="progress-copy"><b>WORKER TASKS</b><span>${progress.done} / ${progress.total} finished</span></div><div class="progress-track"><i style="width:${progress.total?progress.done/progress.total*100:0}%"></i></div><span class="progress-toy">🧸</span></div>${sabotage?`<div class="sabotage-banner"><span>${sabotage.type==='jam'?'🚧 CONVEYOR JAM — hold both relay buttons!':sabotage.type==='power'?'⚡ POWER SURGE — doors locked!':'🌑 LIGHTS OUT — reduced vision!'}</span><b id="sabotage-clock">${Math.max(0,Math.ceil((sabotage.endsAt-Date.now())/1000))}s</b></div>`:''}
    <div class="map-layout">
      <section class="map-board"><div class="canvas-toolbar"><span>🏭 &nbsp; TOY FACTORY · OVERHEAD VIEW</span><span class="map-online-count"><i></i>${room.players.filter(p=>p.connected).length} WORKERS ON SHIFT</span></div><div class="canvas-wrap"><canvas id="factory-map" aria-label="Top-down toy factory map with moving workers"></canvas><div class="map-corner-label">FACTORY FLOOR · ${state.myRole==='worker'?'GLOWING DOTS = YOUR TASKS':'CONVEYOR TUNNELS GLOW'}</div><div class="desktop-controls"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>or arrow keys</span><kbd>E</kbd><span>use</span><kbd>R</kbd><span>report</span></div><div class="touch-joystick" id="joystick" aria-label="Movement joystick"><div class="joystick-ring"><div class="joystick-knob" id="joystick-knob"></div></div><small>MOVE</small></div><div class="mobile-controls-label">DRAG TO MOVE</div><div class="map-social-tools"><button id="chat-open" class="social-tool" ${!state.myAlive?'disabled':''}>💬 Chat <kbd>T</kbd></button><button id="emote-open" class="social-tool">✨ Emote</button></div>${state.emoteWheel?`<div class="emote-wheel">${[['wave','👋','Wave'],['dance','🕺','Dance'],['laugh','😂','Laugh'],['point','👉','Point']].map(([id,icon,label],i)=>`<button data-emote="${id}"><span>${icon}</span><small>${i+1} · ${label}</small></button>`).join('')}</div>`:''}${state.chatOpen?`<div class="game-chat-pop"><div class="game-chat-head">QUICK CHAT <button id="chat-close">×</button></div><div class="game-quick-lines">${['I was in Paint Shop','I saw someone near the conveyor','Where were you?','Sus!'].map(t=>`<button data-game-quick="${esc(t)}">${esc(t)}</button>`).join('')}</div><form id="game-chat-form"><input id="game-chat-input" maxlength="140" placeholder="Type a quick alibi…"/><button>Send</button></form></div>`:''}<div id="game-notice" class="game-notice ${state.gameState?.notice?'show':''}">${esc(state.gameState?.notice||'')}</div></div></section>
      <aside class="map-sidebar"><section class="location-card"><div class="location-top"><span>YOUR LOCATION</span><span class="live-pill"><i></i> LIVE</span></div><b id="map-location">${esc(where)}</b><small id="map-player-name">${esc(me?.name||'Toy Worker')} · ${glitch?'Glitch':'Worker'}${!state.myAlive?' · GHOST':''}</small><div class="location-rule"></div><div class="map-coords"><span>SERVER POSITION</span><b id="map-coords">${Number.isFinite(pos.x)?`${Math.round(pos.x)} / ${Math.round(pos.y)}`:'Syncing…'}</b></div></section>
        <section class="objective-card"><div class="map-panel-title"><div><small>${glitch?'GLITCH OBJECTIVES':'YOUR CHECKLIST'}</small><h2>${glitch?'Cause a little chaos':'Factory tasks'} <span>${glitch?'!':`${progress.done}/${progress.total}`}</span></h2></div><span class="crew-orbit">${glitch?'🌀':'✦'}</span></div><div class="task-list">${taskRows}</div></section>
        <section class="actions-card"><div class="actions-head"><small>QUICK ACTIONS</small><span>${glitch?'GLITCH':'WORKER'}</span></div>${glitch?`<div class="action-grid"><button class="action-button danger" id="kill-action" ${!target||!state.myAlive?'disabled':''}>⚡ <b>Short-circuit</b><small id="kill-cooldown">${target?'Q · nearby':'Find a worker'}</small></button><button class="action-button tunnel" id="tunnel-action" ${!tunnelNear||!state.myAlive?'disabled':''}>🌀 <b>Conveyor tunnel</b><small>T · ${tunnelNear?'ready':'find a tunnel'}</small></button></div><div class="sabotage-label">TRIGGER SABOTAGE</div><div class="sabotage-buttons"><button data-sabotage="lights" ${state.gameState?.sabotage||!state.myAlive?'disabled':''}>🌑 Lights</button><button data-sabotage="jam" ${state.gameState?.sabotage||!state.myAlive?'disabled':''}>🛠 Jam</button><button data-sabotage="power" ${state.gameState?.sabotage||!state.myAlive?'disabled':''}>⚡ Power</button></div>`:`<div class="action-grid"><button class="action-button report" id="report-action" ${!body||!state.myAlive?'disabled':''}>📣 <b>Report body</b><small>R · ${body?'nearby':'no body nearby'}</small></button><button class="action-button buzzer" id="buzzer-action" ${!buzzerNear||own.buzzerUsed||!state.myAlive?'disabled':''}>🔔 <b>Emergency buzzer</b><small>${own.buzzerUsed?'already used':buzzerNear?'ready at this table':'Break Room · one use'}</small></button></div>${state.gameState?.sabotage?.type==='jam'&&!glitch&&state.myAlive?`<button class="fix-button" id="fix-jam" data-station="${jamNearest?.station.id||'west'}" ${!jamStation?'disabled':''}>🔧 Hold to fix ${jamStation?.label||'nearby relay'}</button>`:''}`}${!state.myAlive?'<div class="ghost-note">👻 You are a friendly ghost toy. Keep finishing tasks; no living-crew chat.</div>':''}</section>
        <section class="movement-card"><div class="movement-card-head">🎮 &nbsp; CONTROLS</div><div class="movement-tip"><span>✦</span> Move with WASD/arrows or the joystick. Click any glowing task when close.</div><div class="control-chips"><span>E TASK</span><span>Q ${glitch?'ZAP':'—'}</span><span>R REPORT</span><span>T CHAT</span><span>1–4 EMOTES</span>${glitch?'<span>Z/X/C SABOTAGE</span><span>V TUNNEL</span>':'<span>B BUZZER</span>'}</div></section>
      </aside>
    </div>
    <footer class="map-footer"><span>GLITCH IN THE TOY FACTORY · NIGHT SHIFT</span><span>PROGRESS IS SERVER-SYNCED <b>✦</b></span></footer>
  </main>${state.activeTask?taskModalView():''}${state.roleReveal?roleRevealView():''}`;
}

function meetingView() {
  const phase=state.gameState?.phase||'meeting_discussion'; const meeting=state.gameState?.meeting||{};
  const discussion=phase==='meeting_discussion', voting=phase==='meeting_voting', reveal=phase==='meeting_reveal';
  const own=state.gameState?.own||{}; const result=meeting.result;
  const roster=state.gameState?.players||[];
  return `<main class="meeting-shell"><header class="meeting-top"><a class="brand" href="#"><span class="brand-mark">✦</span> PLAYTIME <span>WORKS</span></a><span class="meeting-room">BREAK ROOM · ${state.room?.code||''}</span><span class="meeting-live">FACTORY MEETING</span>${muteButton()}</header><section class="meeting-card"><div class="meeting-stamp">${meeting.emergency?'🔔':'📣'}</div><div class="meeting-kicker">${meeting.emergency?'EMERGENCY BUZZER':'BODY REPORTED'} · ${esc(meeting.reporterName||'A worker')}</div><h1>${reveal?'The vote is in!':discussion?'Sound off, toy makers!':'Point to the suspicious squeak.'}</h1>${meeting.bodyName?`<p class="meeting-body-note">${esc(meeting.bodyName)} was found on the factory floor.</p>`:''}<div class="meeting-timer"><span>${discussion?'DISCUSSION':voting?'VOTING':'RESULTS'}</span><b id="meeting-clock">${meeting.endAt?Math.max(0,Math.ceil((meeting.endAt-Date.now())/1000))+'s':(reveal?'Resume soon':'')}</b></div>
    ${discussion?`<div class="meeting-grid"><section class="meeting-chat"><div class="meeting-chat-head">🗨️ CREW CHAT <small>Only living workers can speak</small></div><div id="meeting-chat-log" class="meeting-chat-log">${state.chatMessages.map(m=>`<div class="chat-line"><b>${esc(m.name)}</b><span>${esc(m.text)}</span></div>`).join('')||'<div class="chat-empty">The break-room clock is ticking… say what you saw!</div>'}</div><div class="quick-chat">${['I was in Paint Shop','Sus!','Skip vote'].map(line=>`<button data-quick="${esc(line)}">${esc(line)}</button>`).join('')}</div><form id="meeting-chat-form" class="meeting-chat-form"><input id="meeting-chat-input" maxlength="140" placeholder="Type your alibi…" ${!own.alive?'disabled':''}/><button class="button button-primary" ${!own.alive?'disabled':''}>Send</button></form></section><aside class="meeting-crew"><b>ON THE BREAK ROOM FLOOR</b>${roster.map(p=>`<div class="meeting-person ${!p.alive?'is-ghost':''}">${avatarMarkup(p.avatar,'small',!p.alive)}<span>${esc(p.name)}${p.id===playerId?' · YOU':''}</span><i>${p.alive?'HERE':'GHOST'}</i></div>`).join('')}${!own.alive?'<small class="ghost-chat-note">Ghost toys can listen, but cannot chat or vote with the living.</small>':''}</aside></div>`:voting?`<div class="vote-area"><div class="vote-prompt">Choose one living worker to eject—or skip the vote.</div><div class="vote-grid">${roster.filter(p=>p.alive).map(p=>`<button class="vote-card ${p.id===playerId?'vote-self':''}" data-vote="${p.id}" ${!own.alive||own.hasVoted?'disabled':''}>${avatarMarkup(p.avatar,'small')}<b>${esc(p.name)}</b><small>${p.id===playerId?'YOU':'WORKER'}</small></button>`).join('')}<button class="vote-card skip-vote" data-vote="skip" ${!own.alive||own.hasVoted?'disabled':''}><span>⏭</span><b>Skip vote</b><small>NO EJECTION</small></button></div><div class="vote-submit-row">${!own.alive?'<b class="ghost-chat-note">Ghosts cannot vote. Watch the reveal.</b>':own.hasVoted?'<b class="voted-lock">✓ Vote locked in</b>':'<span>Votes reveal together when the timer ends.</span>'}<button data-vote="skip" class="button button-dark" ${!own.alive||own.hasVoted?'disabled':''}>Skip vote</button></div></div>`:`<div class="vote-result"><div class="eject-animation">${result?.ejectedName?'🚀':'🫧'}</div><h2>${result?.ejectedName?`${esc(result.ejectedName)} was ejected!`:'Nobody was ejected.'}</h2><p>${result?.ejectedName?`They were a <b>${result.ejectedRole==='glitch'?'GLITCH':'WORKER'}</b>.`:'The votes tied or the crew skipped.'}</p><div class="revealed-votes">${(result?.votes||[]).map(v=>`<div><span>${esc(v.voterName)}</span><b>→</b><strong>${esc(v.targetName)}</strong></div>`).join('')||'<span>No votes were cast.</span>'}</div><small>Back to shift in <b id="meeting-clock">${meeting.endAt?Math.max(0,Math.ceil((meeting.endAt-Date.now())/1000))+'s':'5s'}</b></small></div>`}</section><div class="meeting-foot">THE FACTORY ANNOUNCER SAYS: “Keep it civil, keep it squeaky.”</div></main>`;
}
function endView() {
  const result=state.gameState?.gameEnded||{winner:'workers',reason:'Shift complete'};
  const stats=state.gameState?.endStats||[]; const host=self()?.id===state.room?.hostId;
  const meStat=stats.find(p=>p.id===playerId);
  return `<main class="end-shell"><div class="end-confetti confetti-one">✦</div><div class="end-confetti confetti-two">✧</div><section class="end-card"><div class="end-tools">${muteButton()}</div><div class="end-emoji">${result.winner==='workers'?'🏆':'🌀'}</div><div class="eyebrow">SHIFT COMPLETE · ROOM ${state.room?.code||''}</div><h1 class="${result.winner==='workers'?'workers-win':'glitch-win'}">${result.winner==='workers'?'Workers win!':'The Glitch wins!'}</h1><p class="end-reason">${esc(result.reason||'The mystery is solved!')}</p><div class="your-role-reveal">${avatarMarkup(meStat?.avatar||state.avatar,'small')}<div><small>YOU WERE</small><b>${meStat?.role==='glitch'?'THE GLITCH':'A WORKER'} ${meStat?.alive===false?'· GHOST TOY':''}</b></div></div><div class="end-stat-grid"><div><b>${meStat?.tasksDone||0}</b><small>TASKS DONE</small></div><div><b>${meStat?.kills||0}</b><small>SNEAKY ELIMS</small></div><div><b>${meStat?.votesReceived||0}</b><small>VOTES RECEIVED</small></div></div><div class="role-reveal-list"><small>EVERYONE'S SECRET IS OUT</small>${stats.map(p=>`<div class="role-row">${avatarMarkup(state.room?.players.find(x=>x.id===p.id)?.avatar||{},'small',!p.alive)}<span><b>${esc(p.name)}</b><small>${p.tasksDone} tasks · ${p.kills} zaps · ${p.votesReceived} votes</small></span><strong class="${p.role==='glitch'?'glitch-tag':'worker-tag'}">${p.role==='glitch'?'GLITCH':'WORKER'}</strong></div>`).join('')}</div>${host?'<button id="play-again" class="button button-start play-again">Play Again ↻</button>':'<div class="host-wait">Waiting for the host to play again…</div>'}<button id="leave-room" class="text-button">Leave room</button></section></main>`;
}

function recomputeMoveInput() {
  if (state.screen !== 'map' || state.activeTask || state.roleReveal) { moveInput.dx = 0; moveInput.dy = 0; return; }
  const down = (...codes) => codes.some(code => pressedKeys.has(code));
  let dx = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0) + joystickInput.dx;
  let dy = (down('KeyS', 'ArrowDown') ? 1 : 0) - (down('KeyW', 'ArrowUp') ? 1 : 0) + joystickInput.dy;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > 1) { dx /= magnitude; dy /= magnitude; }
  moveInput.dx = dx; moveInput.dy = dy;
}
window.addEventListener('keydown', event => {
  if (state.screen === 'meeting' && event.code === 'KeyT') { document.getElementById('meeting-chat-input')?.focus(); return; }
  if (state.screen !== 'map') return;
  if (state.activeTask) { if (event.code === 'Escape') cancelTask(); return; }
  if (state.roleReveal) return;
  if (event.code === 'KeyT' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'')) { state.chatOpen=!state.chatOpen;state.emoteWheel=false;render();document.getElementById('game-chat-input')?.focus();return; }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  if (['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) { event.preventDefault(); pressedKeys.add(event.code); recomputeMoveInput(); return; }
  if (event.repeat) return;
  if (event.code === 'KeyE') startTask(nearbyIncompleteTask());
  else if (event.code === 'KeyQ') attemptKill();
  else if (event.code === 'KeyR') requestReport();
  else if (event.code === 'KeyV') useTunnel();
  else if (event.code === 'KeyB') pressBuzzer();
  else if (event.code === 'KeyZ') triggerSabotage('lights');
  else if (event.code === 'KeyX') triggerSabotage('jam');
  else if (event.code === 'KeyC') triggerSabotage('power');
  else if (event.code === 'Digit1') playEmote('wave');
  else if (event.code === 'Digit2') playEmote('dance');
  else if (event.code === 'Digit3') playEmote('laugh');
  else if (event.code === 'Digit4') playEmote('point');
});
window.addEventListener('keyup', event => { pressedKeys.delete(event.code); recomputeMoveInput(); });
window.addEventListener('blur', () => { pressedKeys.clear(); joystickInput.dx = 0; joystickInput.dy = 0; recomputeMoveInput(); });
window.setInterval(() => {
  if (state.screen !== 'map') return;
  recomputeMoveInput();
  if (socket.connected) socket.emit('player:input', { dx: moveInput.dx, dy: moveInput.dy });
}, 50);
window.setInterval(() => {
  const m=state.mini;
  if(state.activeTask?.kind==='paint'&&m?.painting){
    m.progress=Math.min(100,(Date.now()-m.paintStartedAt)/50);
    const fill=document.getElementById('paint-fill');if(fill)fill.style.width=`${m.progress}%`;
  }
},35);
function setJoystickFromPointer(event) {
  const ring = document.querySelector('.joystick-ring');
  const knob = document.getElementById('joystick-knob');
  if (!ring || !knob) return;
  const rect = ring.getBoundingClientRect();
  const max = rect.width * .34;
  let dx = (event.clientX - (rect.left + rect.width / 2)) / max;
  let dy = (event.clientY - (rect.top + rect.height / 2)) / max;
  const length = Math.hypot(dx, dy);
  if (length > 1) { dx /= length; dy /= length; }
  joystickInput.dx = dx; joystickInput.dy = dy;
  knob.style.transform = `translate(${dx * max}px, ${dy * max}px)`;
  recomputeMoveInput();
}
function bindMapControls() {
  const joystick = document.getElementById('joystick');
  if (!joystick) return;
  const end = event => {
    if (joystickPointer !== event.pointerId) return;
    joystickPointer = null; joystickInput.dx = 0; joystickInput.dy = 0;
    const knob = document.getElementById('joystick-knob'); if (knob) knob.style.transform = 'translate(0, 0)';
    recomputeMoveInput();
  };
  joystick.addEventListener('pointerdown', event => {
    event.preventDefault(); joystickPointer = event.pointerId;
    try { joystick.setPointerCapture(event.pointerId); } catch {}
    setJoystickFromPointer(event);
  });
  joystick.addEventListener('pointermove', event => { if (joystickPointer === event.pointerId) setJoystickFromPointer(event); });
  joystick.addEventListener('pointerup', end);
  joystick.addEventListener('pointercancel', end);
  joystick.addEventListener('lostpointercapture', end);
}
function updateGameHud() {
  const game=state.gameState, own=game?.own||{}, pos=myPosition(), now=Date.now();
  const target=(game?.players||[]).filter(p=>p.id!==playerId&&p.alive&&!p.ghost).map(p=>({p,d:Math.hypot(p.x-pos.x,p.y-pos.y)})).sort((a,b)=>a.d-b.d).find(x=>x.d<72)?.p;
  const kill=document.getElementById('kill-action'), killText=document.getElementById('kill-cooldown');
  const killLeft=Math.max(0,Math.ceil(((own.killReadyAt||0)-now)/1000));
  if(kill)kill.disabled=!target||!own.alive||killLeft>0;
  if(killText)killText.textContent=killLeft?`Q · ${killLeft}s`:target?'Q · nearby':'Find a worker';
  const tunnel=document.getElementById('tunnel-action'), tunnelText=tunnel?.querySelector('small');
  const nearTunnel=CONVEYOR_TUNNELS.some(t=>Math.hypot(pos.x-t.x,pos.y-t.y)<58), tunnelLeft=Math.max(0,Math.ceil(((own.tunnelReadyAt||0)-now)/1000));
  if(tunnel)tunnel.disabled=!nearTunnel||!own.alive||tunnelLeft>0;
  if(tunnelText)tunnelText.textContent=`V · ${tunnelLeft?tunnelLeft+'s':nearTunnel?'ready':'find a tunnel'}`;
  const body=nearbyBody(), report=document.getElementById('report-action'); if(report)report.disabled=!body||!own.alive;
  const buzzer=document.getElementById('buzzer-action');
  if(buzzer)buzzer.disabled=Math.hypot(pos.x-BUZZER_POINT.x,pos.y-BUZZER_POINT.y)>68||own.buzzerUsed||!own.alive;
  const sabotageLeft=Math.max(0,Math.ceil(((own.sabotageReadyAt||0)-now)/1000));
  document.querySelectorAll('[data-sabotage]').forEach(b=>b.disabled=Boolean(game?.sabotage)||!own.alive||sabotageLeft>0);
  const fix=document.getElementById('fix-jam');
  if(fix){const nearby=JAM_STATIONS.map(s=>({s,d:Math.hypot(pos.x-s.x,pos.y-s.y)})).sort((a,b)=>a.d-b.d)[0];fix.disabled=!nearby||nearby.d>75;fix.dataset.station=nearby?.s.id||'west';fix.textContent=`🔧 Hold to fix ${nearby?.d<75?nearby.s.label:'a nearby relay'}`;}
  for(const button of document.querySelectorAll('[data-task]')){
    const task=state.privateTasks.find(t=>t.id===button.dataset.task); if(!task)continue;
    const near=Math.hypot(pos.x-task.x,pos.y-task.y)<72;
    button.disabled=Boolean(task.completed||state.activeTask);
    button.classList.toggle('near',near);
    const small=button.querySelector('small');if(small)small.textContent=`${task.room}${near?' · press E':''}`;
    const marker=button.querySelector('.task-check');if(marker)marker.textContent=task.completed?'✓':near?'!':'○';
  }
  const progress=game?.taskProgress;
  const bar=document.querySelector('.progress-track i');if(bar&&progress)bar.style.width=`${progress.total?progress.done/progress.total*100:0}%`;
  const notice=document.getElementById('game-notice');if(notice){notice.textContent=game?.notice||'';notice.classList.toggle('show',Boolean(game?.notice));}
  const timer=document.getElementById('sabotage-clock');if(timer&&game?.sabotage)timer.textContent=`${Math.max(0,Math.ceil((game.sabotage.endsAt-now)/1000))}s`;
}
function animateFactoryMap() {
  if (state.screen !== 'map') { mapFrame = 0; return; }
  const canvas = document.getElementById('factory-map');
  if (canvas) {
    const fallback = state.room?.players.filter(p => Number.isFinite(p.x)) || [];
    const game = state.gameState?.players?.length ? state.gameState : { code: state.room?.code, players: fallback };
    drawFactoryMap(canvas, game, state.room?.selfId || playerId, moveInput, visualPlayers, state.privateTasks, state.myRole);
    updateGameHud();
    const me = game.players.find(p => p.id === (state.room?.selfId || playerId));
    if (me) {
      const loc = document.getElementById('map-location');
      const coords = document.getElementById('map-coords');
      if (loc) loc.textContent = roomAt(me.x, me.y);
      if (coords) coords.textContent = `${Math.round(me.x)} / ${Math.round(me.y)}`;
    }
  }
  mapFrame = requestAnimationFrame(animateFactoryMap);
}
function startMapLoop() { if (!mapFrame) mapFrame = requestAnimationFrame(animateFactoryMap); }
function stopMapLoop() {
  if (mapFrame) cancelAnimationFrame(mapFrame);
  mapFrame = 0; pressedKeys.clear(); joystickInput.dx = 0; joystickInput.dy = 0; recomputeMoveInput();
}
function bindMiniGame() {
  const m=state.mini; if(!m||!state.activeTask) return;
  document.getElementById('task-close')?.addEventListener('click',cancelTask);
  document.getElementById('dismiss-role')?.addEventListener('click',()=>{state.roleReveal=null;render();});
  document.querySelectorAll('[data-wire-left]').forEach(b=>b.addEventListener('click',()=>{m.selected=b.dataset.wireLeft; m.message='Now tap the matching color on the right.'; render();}));
  document.querySelectorAll('[data-wire-right]').forEach(b=>b.addEventListener('click',()=>{
    const c=b.dataset.wireRight;
    if(!m.selected){m.message='Pick a wire from the left first.';render();return;}
    if(m.selected===c){m.connected.push(c);m.selected='';m.message='Nice connection!';render();if(m.connected.length===3)finishTaskPuzzle();}
    else {m.selected='';m.message='Those colors do not match. Try again!';render();}
  }));
  document.querySelectorAll('[data-sort-toy]').forEach(b=>b.addEventListener('click',()=>{m.selected=b.dataset.sortToy;render();}));
  document.querySelectorAll('[data-sort-bin]').forEach(b=>b.addEventListener('click',()=>{
    const bin=b.dataset.sortBin;
    if(m.selected===bin){if(!m.sorted.includes(bin))m.sorted.push(bin);m.selected='';m.message='Perfectly sorted!';render();if(m.sorted.length===3)finishTaskPuzzle();}
    else {m.message='That toy belongs in a different bin.';render();}
  }));
  document.querySelectorAll('[data-memory]').forEach(b=>b.addEventListener('click',()=>{
    if(m.showSequence||m.finished)return;
    const index=Number(b.dataset.memory), order=m.entered.length;
    if(m.sequence[order]!==index){m.entered=[];m.message='Oops! Watch closely and try that pattern again.';m.showSequence=true;m.localFlashAt=Date.now();render();setTimeout(()=>{if(state.mini===m){m.showSequence=false;render();}},1100);return;}
    m.entered.push(index);m.message='That is the right light…';render();if(m.entered.length===m.sequence.length)finishTaskPuzzle();
  }));
  document.getElementById('stack-tap')?.addEventListener('click',()=>{
    const phase=((performance.now()-m.startedAt)%1350)/1350;
    if(phase>.37&&phase<.65){m.hits++;m.hitPhases.push(phase);m.message='Plunk! One more block!';}
    else {m.hits=0;m.hitPhases=[];m.message='Wobble! Reset the tower and wait for gold.';}
    render();if(m.hits>=3)finishTaskPuzzle();
  });
  const paint=document.getElementById('paint-hold');
  if(paint){const down=e=>{e.preventDefault();m.painting=true;m.paintStartedAt=Date.now();try{paint.setPointerCapture(e.pointerId);}catch{}};const up=()=>{if(!m.painting)return;m.painting=false;m.paintHoldMs=Date.now()-m.paintStartedAt;const filled=Math.min(100,m.paintHoldMs/50);m.progress=filled;if(filled>=68&&filled<=84){m.message='A perfectly painted duck!';finishTaskPuzzle();}else{m.progress=0;m.message=filled>84?'Whoops—too much paint!':'A little more paint, please!';render();}};paint.addEventListener('pointerdown',down);paint.addEventListener('pointerup',up);paint.addEventListener('pointercancel',up);}
  const track=document.getElementById('keycard-track');
  if(track){const update=e=>{const rect=track.getBoundingClientRect();m.progress=Math.max(0,Math.min(100,(e.clientX-rect.left)/rect.width*100));const fill=track.querySelector('i'),card=document.getElementById('keycard-card');if(fill)fill.style.width=`${m.progress}%`;if(card)card.style.left=`${m.progress}%`;};
    track.addEventListener('pointerdown',e=>{e.preventDefault();m.dragging=true;m.startedAt=Date.now();try{track.setPointerCapture(e.pointerId);}catch{}update(e);});
    track.addEventListener('pointermove',e=>{if(m.dragging)update(e);});
    const end=e=>{if(!m.dragging)return;update(e);m.dragging=false;const elapsed=Date.now()-m.startedAt;m.swipeMs=elapsed;if(m.progress>94&&elapsed>350&&elapsed<1400){m.message='Access granted!';finishTaskPuzzle();}else{m.progress=0;m.message='Swipe smoothly all the way across. Try again.';render();}};
    track.addEventListener('pointerup',end);track.addEventListener('pointercancel',end);
  }
}
function bindEvents() {
  document.getElementById('tutorial-close')?.addEventListener('click',()=>{state.tutorialOpen=false;localStorage.setItem('toy-tutorial-done','1');render();});
  document.getElementById('mute-audio')?.addEventListener('click',muteSounds);
  document.getElementById('create-room')?.addEventListener('click', createRoom);
  document.getElementById('join-form')?.addEventListener('submit', event => { event.preventDefault(); const code = document.getElementById('room-code').value.trim().toUpperCase(); if (code.length !== 5) { setError('Room codes have 5 letters or numbers.'); return; } joinRoom(code); });
  document.getElementById('player-name')?.addEventListener('input', event => { state.name = event.target.value.slice(0, 16); localStorage.setItem('toy-name', state.name); });
  document.getElementById('player-name')?.addEventListener('change', event => updateName(event.target.value));
  document.getElementById('copy-invite')?.addEventListener('click', copyInvite);
  document.getElementById('ready-toggle')?.addEventListener('click', readyToggle);
  document.querySelectorAll('[data-color]').forEach(button => button.addEventListener('click', () => updateAvatar('color', button.dataset.color)));
  document.querySelectorAll('[data-face]').forEach(button => button.addEventListener('click', () => updateAvatar('face', button.dataset.face)));
  document.getElementById('hat-select')?.addEventListener('change', event => updateAvatar('hat', event.target.value));
  document.getElementById('start-shift')?.addEventListener('click', startShift);
  document.getElementById('back-lobby')?.addEventListener('click', resetLobby);
  document.getElementById('play-again')?.addEventListener('click', resetLobby);
  document.getElementById('leave-room')?.addEventListener('click', leaveRoom);
  document.querySelectorAll('[data-task]').forEach(button=>button.addEventListener('click',()=>startTask(state.privateTasks.find(t=>t.id===button.dataset.task))));
  document.getElementById('kill-action')?.addEventListener('click',attemptKill);
  document.getElementById('report-action')?.addEventListener('click',requestReport);
  document.getElementById('buzzer-action')?.addEventListener('click',pressBuzzer);
  document.getElementById('tunnel-action')?.addEventListener('click',useTunnel);
  document.getElementById('chat-open')?.addEventListener('click',()=>{state.chatOpen=!state.chatOpen;state.emoteWheel=false;render();document.getElementById('game-chat-input')?.focus();});
  document.getElementById('chat-close')?.addEventListener('click',()=>{state.chatOpen=false;render();});
  document.getElementById('emote-open')?.addEventListener('click',()=>{state.emoteWheel=!state.emoteWheel;state.chatOpen=false;render();});
  document.querySelectorAll('[data-emote]').forEach(button=>button.addEventListener('click',()=>playEmote(button.dataset.emote)));
  document.querySelectorAll('[data-game-quick]').forEach(button=>button.addEventListener('click',()=>submitGameChat('',button.dataset.gameQuick)));
  document.getElementById('game-chat-form')?.addEventListener('submit',event=>{event.preventDefault();submitGameChat(document.getElementById('game-chat-input')?.value||'');});
  document.querySelectorAll('[data-sabotage]').forEach(button=>button.addEventListener('click',()=>triggerSabotage(button.dataset.sabotage)));
  const fix=document.getElementById('fix-jam');
  if(fix){const begin=e=>{e.preventDefault();holdJam(fix.dataset.station,true);};const end=()=>holdJam(fix.dataset.station,false);fix.addEventListener('pointerdown',begin);fix.addEventListener('pointerup',end);fix.addEventListener('pointercancel',end);fix.addEventListener('pointerleave',end);}
  document.querySelectorAll('[data-quick]').forEach(button=>button.addEventListener('click',()=>submitMeetingChat(button.dataset.quick)));
  document.getElementById('meeting-chat-form')?.addEventListener('submit',event=>{event.preventDefault();submitMeetingChat(document.getElementById('meeting-chat-input')?.value||'');});
  document.querySelectorAll('[data-vote]').forEach(button=>button.addEventListener('click',()=>sendVote(button.dataset.vote)));
  bindMiniGame();
}
function render() {
  const app = document.getElementById('app');
  app.innerHTML = state.screen === 'landing' ? landingView() : state.screen === 'lobby' ? lobbyView() : state.screen === 'meeting' ? meetingView() : state.screen === 'end' ? endView() : mapView();
  if(state.tutorialOpen) app.insertAdjacentHTML('beforeend',tutorialView());
  bindEvents();
  if (state.screen === 'map') { bindMapControls(); startMapLoop(); }
  else stopMapLoop();
  if (state.screen === 'meeting') { updateMeetingClock(); scrollChatToBottom(); }
  if (state.notice) {
    const toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.textContent = state.notice; app.append(toastEl);
  }
}

render();
// Invite links are one-click joins. A room code from the URL takes precedence over a stale saved lobby.
const autoJoinCode = params.get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
if (autoJoinCode && autoJoinCode.length === 5) {
  const autoJoin = () => { if (!state.room && state.screen === 'landing') joinRoom(autoJoinCode); };
  if (socket.connected) autoJoin();
  else socket.once('connect', autoJoin);
}
