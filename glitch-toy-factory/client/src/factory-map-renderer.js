import { CORRIDORS, OBSTACLES, PLAYER_SPEED, ROOMS, WORLD_HEIGHT, WORLD_WIDTH } from '../../shared/factory-map.js';
import { CONVEYOR_TUNNELS, JAM_STATIONS } from '../../shared/game-config.js';

const DARK = '#463b58';
const roundRect = (ctx, x, y, w, h, r = 14) => {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function drawFloor(ctx) {
  ctx.fillStyle = '#d8cdbb'; ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  for (let y = 12; y < WORLD_HEIGHT; y += 34) {
    for (let x = 12 + ((y / 34) % 2) * 17; x < WORLD_WIDTH; x += 34) {
      ctx.fillStyle = '#ffffff13'; roundRect(ctx, x, y, 25, 25, 5); ctx.fill();
    }
  }
}
function drawCorridors(ctx) {
  for (const path of CORRIDORS) {
    ctx.save(); ctx.shadowColor = '#392e4a29'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
    roundRect(ctx, path.x, path.y, path.w, path.h, 25); ctx.fillStyle = '#5a4d65'; ctx.fill(); ctx.restore();
    roundRect(ctx, path.x + 8, path.y + 8, path.w - 16, path.h - 16, 19); ctx.fillStyle = '#eee6d7'; ctx.fill();
    ctx.save(); ctx.setLineDash([9, 10]); ctx.strokeStyle = '#d2c7b7'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(path.x + 18, path.y + path.h / 2); ctx.lineTo(path.x + path.w - 18, path.y + path.h / 2); ctx.stroke(); ctx.restore();
  }
}
function drawRooms(ctx) {
  for (const room of ROOMS) {
    ctx.save(); ctx.shadowColor = '#372d4429'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 7;
    roundRect(ctx, room.x, room.y, room.w, room.h, 20); ctx.fillStyle = '#55485f'; ctx.fill(); ctx.restore();
    roundRect(ctx, room.x + 7, room.y + 7, room.w - 14, room.h - 14, 15); ctx.fillStyle = room.color; ctx.fill();
    ctx.save(); ctx.globalAlpha = .25; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    for (let x = room.x + 18; x < room.x + room.w - 10; x += 42) {
      ctx.beginPath(); ctx.moveTo(x, room.y + 10); ctx.lineTo(x, room.y + room.h - 10); ctx.stroke();
    }
    ctx.restore();
    roundRect(ctx, room.x + 14, room.y + 13, Math.min(194, room.w - 28), 32, 10);
    ctx.fillStyle = '#fffdf3eF'; ctx.fill(); ctx.strokeStyle = '#51475e70'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.font = room.id === 'teddy' ? '900 11px Trebuchet MS, sans-serif' : '900 15px Trebuchet MS, sans-serif'; ctx.fillStyle = DARK;
    ctx.fillText(`${room.icon}  ${room.name}`, room.x + 24, room.y + 29);
  }
}
function drawBrick(ctx, x, y, color, width = 38, height = 24) {
  ctx.save(); ctx.shadowColor = '#30274729'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 3;
  roundRect(ctx, x, y, width, height, 6); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  for (let i = 0; i < Math.floor(width / 14); i++) {
    ctx.beginPath(); ctx.arc(x + 9 + i * 14, y + 1, 4, Math.PI, 0); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 1.5; ctx.stroke();
  }
}
function drawMachine(ctx, obstacle, now) {
  const { x, y, w, h, id } = obstacle;
  if (id === 'assembly-belt') {
    roundRect(ctx, x, y, w, h, 10); ctx.fillStyle = '#81768a'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 4; ctx.stroke();
    ctx.save(); ctx.beginPath(); roundRect(ctx, x + 6, y + 6, w - 12, h - 12, 6); ctx.clip();
    ctx.fillStyle = '#c2b6c9';
    const offset = (now / 28) % 22;
    for (let xx = x - 24 + offset; xx < x + w + 24; xx += 22) {
      ctx.beginPath(); ctx.moveTo(xx, y + 7); ctx.lineTo(xx + 10, y + 7); ctx.lineTo(xx + 18, y + h - 7); ctx.lineTo(xx + 8, y + h - 7); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    drawBrick(ctx, x + 42, y - 11, '#fb7f70', 31, 22); drawBrick(ctx, x + 136, y + 19, '#63cbb1', 26, 20);
    return;
  }
  const baseColor = id === 'paint-booth' ? '#d47bb9' : id === 'stuffing-machine' ? '#8bbb72' : id === 'control-console' ? '#6da6d0' : '#e2a14b';
  roundRect(ctx, x, y + 7, w, h - 7, 10); ctx.fillStyle = baseColor; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 4; ctx.stroke();
  roundRect(ctx, x + 8, y + 13, w - 16, Math.min(27, h - 22), 6); ctx.fillStyle = '#fff4de'; ctx.fill();
  ctx.fillStyle = '#493d5a'; ctx.font = '900 11px Trebuchet MS'; ctx.textAlign = 'center'; ctx.fillText(id === 'paint-booth' ? 'MIX!' : id === 'stuffing-machine' ? 'PUFF' : id === 'control-console' ? 'TAP!' : 'TOYS', x + w / 2, y + 29);
  ctx.textAlign = 'start';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.arc(x + 20 + i * 21, y + h - 7, 4, 0, Math.PI * 2); ctx.fillStyle = ['#ffd364', '#ff7a70', '#57c8a9'][i]; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 1; ctx.stroke();
  }
}
function drawTable(ctx, obstacle) {
  const { x, y, w, h, id } = obstacle;
  if (id === 'break-table') {
    for (const [cx, cy] of [[x + 8,y + 8],[x + w - 8,y + 8],[x + 8,y + h - 8],[x + w - 8,y + h - 8]]) {
      ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.fillStyle = '#d7af6a'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 2; ctx.stroke();
    }
    roundRect(ctx, x, y, w, h, 19); ctx.fillStyle = '#b87c4d'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 4; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, 26, 16, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff0ca'; ctx.fill();
    ctx.font = '17px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('☕', x + w / 2, y + h / 2 + 6); ctx.textAlign = 'start';
  } else {
    roundRect(ctx, x, y, w, h, 10); ctx.fillStyle = '#d7b782'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = '#fff3d699'; ctx.lineWidth = 3;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * w / 4, y + 5); ctx.lineTo(x + i * w / 4, y + h - 5); ctx.stroke(); }
    drawBrick(ctx, x + 14, y + 16, '#ff8ac6', 31, 21); drawBrick(ctx, x + 75, y + 33, '#55a7ff', 29, 20);
  }
}
function drawCrates(ctx, obstacle) {
  const { x, y } = obstacle;
  drawBrick(ctx, x, y + 28, '#60c3aa', 47, 41);
  drawBrick(ctx, x + 43, y + 13, '#ffbd53', 46, 45);
  drawBrick(ctx, x + 20, y - 10, '#ff7d75', 43, 37);
}
function drawProps(ctx, now) {
  for (const item of OBSTACLES) {
    if (item.kind === 'belt') drawMachine(ctx, item, now);
    else if (item.kind === 'crate') drawCrates(ctx, item);
    else if (item.kind === 'table') drawTable(ctx, item);
    else drawMachine(ctx, item, now);
  }
  drawBrick(ctx, 334, 96, '#6fcbb1', 31, 23);
  drawBrick(ctx, 1060, 347, '#ff8a75', 36, 23);
  drawBrick(ctx, 346, 646, '#f2bd4b', 35, 25);
  drawBrick(ctx, 1091, 635, '#b49aed', 35, 25);
  ctx.font = '26px sans-serif'; ctx.fillText('🦆', 355, 386); ctx.fillText('🧸', 772, 414); ctx.fillText('🪁', 781, 630);
  ctx.font = '900 10px Trebuchet MS'; ctx.fillStyle = '#776c7c'; ctx.fillText('TOY FACTORY • NIGHT SHIFT', 503, 744);
}
function drawTaskMarkers(ctx, tasks, now) {
  for (const task of tasks || []) {
    const complete = task.completed;
    const pulse = 1 + Math.sin(now / 210) * .12;
    ctx.save(); ctx.globalAlpha = complete ? .45 : .8;
    ctx.beginPath(); ctx.arc(task.x, task.y, (complete ? 20 : 23) * pulse, 0, Math.PI * 2);
    ctx.fillStyle = complete ? '#54c39433' : '#ffe76d44'; ctx.fill();
    ctx.strokeStyle = complete ? '#399f6e' : '#f1b83f'; ctx.lineWidth = 3; ctx.setLineDash(complete ? [] : [5, 4]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(task.x, task.y, 12, 0, Math.PI * 2); ctx.fillStyle = complete ? '#52bf8c' : '#fff9d7'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = '900 13px Trebuchet MS'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = complete ? '#fff' : DARK; ctx.fillText(complete ? '✓' : '!', task.x, task.y + 1);
    ctx.restore();
  }
}
function drawTunnelMarkers(ctx, now) {
  for (const tunnel of CONVEYOR_TUNNELS) {
    ctx.save(); ctx.translate(tunnel.x, tunnel.y);
    ctx.fillStyle = '#7562c5'; ctx.strokeStyle = DARK; ctx.lineWidth = 3;
    roundRect(ctx, -23, -11, 46, 22, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#eee8ff';
    for (let i = 0; i < 3; i++) {
      const xx = -10 + i * 12 + ((now / 90) % 12);
      ctx.beginPath(); ctx.moveTo(xx - 7, -6); ctx.lineTo(xx - 2, -6); ctx.lineTo(xx + 3, 6); ctx.lineTo(xx - 2, 6); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}
function drawJamStations(ctx, now, active) {
  if (!active) return;
  for (const station of JAM_STATIONS) {
    const pulse = 1 + Math.sin(now / 160) * .15;
    ctx.save(); ctx.beginPath(); ctx.arc(station.x, station.y, 26 * pulse, 0, Math.PI * 2); ctx.fillStyle = '#ff715b3b'; ctx.fill();
    ctx.beginPath(); ctx.arc(station.x, station.y, 14, 0, Math.PI * 2); ctx.fillStyle = '#ff806a'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '900 12px Trebuchet MS'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', station.x, station.y); ctx.restore();
  }
}
function drawBodies(ctx, bodies = []) {
  for (const body of bodies) {
    ctx.save(); ctx.translate(body.x, body.y); ctx.rotate(-.25);
    ctx.beginPath(); ctx.ellipse(0, 4, 19, 11, 0, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 3; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -1, 10, 0, Math.PI * 2); ctx.fillStyle = body.color || '#ff6b6b'; ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#463b58'; ctx.font = '900 10px Trebuchet MS'; ctx.textAlign = 'center'; ctx.fillText('✦', 0, 2);
    ctx.restore();
  }
}
function drawFog(ctx, dpr, width, height, scale, cameraX, cameraY, player, role, lightsActive) {
  if (!player || player.alive === false) return;
  const base = role === 'glitch' ? 420 : 300;
  const radius = lightsActive ? Math.min(base, role === 'glitch' ? 210 : 120) : base;
  const px = (player.x - cameraX) * scale, py = (player.y - cameraY) * scale;
  const r = radius * scale;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const gradient = ctx.createRadialGradient(px, py, r * .22, px, py, r);
  gradient.addColorStop(0, 'rgba(18,16,32,0)');
  gradient.addColorStop(.55, 'rgba(18,16,32,.05)');
  gradient.addColorStop(.82, 'rgba(18,16,32,.55)');
  gradient.addColorStop(1, 'rgba(18,16,32,.9)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
}
function drawToy(ctx, p, x, y, isSelf) {
  ctx.save();
  if (!p.connected) ctx.globalAlpha = .54;
  if (p.ghost) ctx.globalAlpha = Math.min(ctx.globalAlpha, .58);
  if (isSelf) { ctx.shadowColor = '#fff9d0'; ctx.shadowBlur = 17; }
  // Ground shadow and little feet.
  ctx.beginPath(); ctx.ellipse(x, y + 12, 19, 7, 0, 0, Math.PI * 2); ctx.fillStyle = '#392f4d3d'; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = p.avatar?.color || '#ff6b6b'; ctx.strokeStyle = DARK; ctx.lineWidth = 2.5;
  roundRect(ctx, x - 13, y + 3, 10, 13, 4); ctx.fill(); ctx.stroke();
  roundRect(ctx, x + 3, y + 3, 10, 13, 4); ctx.fill(); ctx.stroke();
  roundRect(ctx, x - 16, y - 16, 32, 29, 9); ctx.fill(); ctx.stroke();
  // Bright plastic highlight.
  ctx.beginPath(); ctx.moveTo(x - 9, y - 10); ctx.lineTo(x - 9, y - 1); ctx.strokeStyle = '#ffffff7a'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
  ctx.fillStyle = '#352d45'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 13px sans-serif';
  const face = { smile: '☺', wink: '😉', wow: '◉', cool: '⌐■' }[p.avatar?.face] || '☺';
  ctx.fillText(face, x, y - 3);
  const hat = { none: '', cap: '🧢', crown: '👑', cone: '🔺', propeller: '🚁' }[p.avatar?.hat] || '';
  if (hat) { ctx.font = '17px sans-serif'; ctx.fillText(hat, x, y - 24); }
  const emote = { wave:'👋', dance:'🕺', laugh:'😂', point:'👉' }[p.emote];
  if (emote) { ctx.font = '20px sans-serif'; ctx.fillText(emote, x + 22, y - 28); }
  if (p.chatBubble) {
    const bubbleText = String(p.chatBubble).slice(0, 34); ctx.font = '900 9px Trebuchet MS';
    const bubbleW = Math.min(142, ctx.measureText(bubbleText).width + 16);
    roundRect(ctx, x - bubbleW/2, y - 67, bubbleW, 20, 7); ctx.fillStyle = '#fffef7'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fffef7'; ctx.beginPath(); ctx.moveTo(x-3,y-47); ctx.lineTo(x+4,y-47); ctx.lineTo(x,y-41); ctx.fill();
    ctx.fillStyle = DARK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(bubbleText,x,y-57);
  }
  const label = String(p.name || 'Toy Worker').slice(0, 16);
  ctx.font = '900 11px Trebuchet MS, sans-serif';
  const labelW = Math.min(124, ctx.measureText(label).width + 14);
  roundRect(ctx, x - labelW / 2, y - 42, labelW, 17, 6); ctx.fillStyle = isSelf ? '#fff2bd' : '#fffdf5'; ctx.fill(); ctx.strokeStyle = DARK; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = DARK; ctx.fillText(label, x, y - 33);
  if (!p.connected) { ctx.font = '900 8px Trebuchet MS'; ctx.fillStyle = '#ad5a47'; ctx.fillText('RECONNECTING', x, y + 25); }
  ctx.restore();
}

export function drawFactoryMap(canvas, gameState, playerId, input, visualPlayers, privateTasks = [], role = 'worker') {
  const bounds = canvas.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = bounds.width, height = bounds.height;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext('2d');
  const smallScreen = width < 760;
  const scale = smallScreen ? Math.min(width / 790, height / 540) : Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
  const viewW = width / scale, viewH = height / scale;
  const players = gameState?.players || [];
  const targets = new Map(players.map(p => [p.id, p]));
  const dt = Math.min(.05, Math.max(0, (performance.now() - (visualPlayers.lastFrame || performance.now())) / 1000));
  visualPlayers.lastFrame = performance.now();
  for (const p of players) {
    let v = visualPlayers.get(p.id);
    if (!v) { v = { x: p.x, y: p.y }; visualPlayers.set(p.id, v); }
    const own = p.id === playerId;
    if (own) { v.x += (input.dx || 0) * PLAYER_SPEED * dt; v.y += (input.dy || 0) * PLAYER_SPEED * dt; }
    v.x += (p.x - v.x) * (own ? .24 : .2);
    v.y += (p.y - v.y) * (own ? .24 : .2);
  }
  for (const id of [...visualPlayers.keys()]) if (!targets.has(id) && id !== 'lastFrame') visualPlayers.delete(id);
  const me = visualPlayers.get(playerId) || players[0] || { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  const cameraX = viewW >= WORLD_WIDTH ? (WORLD_WIDTH - viewW) / 2 : clamp(me.x - viewW / 2, 0, WORLD_WIDTH - viewW);
  const cameraY = viewH >= WORLD_HEIGHT ? (WORLD_HEIGHT - viewH) / 2 : clamp(me.y - viewH / 2, 0, WORLD_HEIGHT - viewH);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -cameraX * dpr * scale, -cameraY * dpr * scale);
  ctx.clearRect(cameraX, cameraY, viewW, viewH);
  const now = performance.now();
  drawFloor(ctx); drawCorridors(ctx); drawRooms(ctx); drawProps(ctx, now);
  drawTunnelMarkers(ctx, now);
  drawJamStations(ctx, now, gameState?.sabotage?.type === 'jam');
  drawTaskMarkers(ctx, privateTasks, now);
  drawBodies(ctx, gameState?.bodies || []);
  for (const p of players) {
    const v = visualPlayers.get(p.id);
    if (v) drawToy(ctx, p, v.x, v.y, p.id === playerId);
  }
  const ownState = players.find(p => p.id === playerId);
  const lights = gameState?.sabotage?.type === 'lights';
  drawFog(ctx, dpr, width, height, scale, cameraX, cameraY, ownState, role, lights);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cameraX, cameraY, scale, width, height, players, roomName: ownState ? '' : 'Factory Hallway' };
}
