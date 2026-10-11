export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 760;
export const PLAYER_RADIUS = 15;
export const PLAYER_SPEED = 185;

export const ROOMS = [
  { id: 'assembly', name: 'Assembly Line', icon: '⚙', x: 52, y: 62, w: 345, h: 235, color: '#f3d98f' },
  { id: 'paint', name: 'Paint Shop', icon: '🎨', x: 430, y: 42, w: 270, h: 215, color: '#f4b4d9' },
  { id: 'teddy', name: 'Teddy Bear Stuffing Room', icon: '🧸', x: 733, y: 62, w: 414, h: 235, color: '#c3dda3' },
  { id: 'break', name: 'Break Room', icon: '☕', x: 452, y: 280, w: 296, h: 200, color: '#f3c96e' },
  { id: 'battery', name: 'Battery Storage', icon: '🔋', x: 52, y: 460, w: 345, h: 245, color: '#96d8ce' },
  { id: 'gift', name: 'Gift Wrapping', icon: '🎁', x: 420, y: 505, w: 335, h: 200, color: '#b9b2f0' },
  { id: 'control', name: 'Control Room', icon: '🎛', x: 805, y: 460, w: 342, h: 245, color: '#99c8ed' }
];

// Broad, chunky hallways join each production room to the central break room.
export const CORRIDORS = [
  { x: 270, y: 221, w: 680, h: 76 },        // upper cross-hall
  { x: 222, y: 252, w: 76, h: 255 },        // west connector
  { x: 63, y: 334, w: 1075, h: 78 },        // central cross-hall
  { x: 562, y: 420, w: 78, h: 115 },        // gift room connector
  { x: 901, y: 248, w: 78, h: 255 }         // east connector
];

export const OBSTACLES = [
  { id: 'assembly-belt', x: 112, y: 139, w: 208, h: 37, kind: 'belt' },
  { id: 'paint-booth', x: 507, y: 97, w: 82, h: 57, kind: 'machine' },
  { id: 'stuffing-machine', x: 927, y: 135, w: 104, h: 76, kind: 'machine' },
  { id: 'break-table', x: 548, y: 337, w: 105, h: 66, kind: 'table' },
  { id: 'battery-crates', x: 93, y: 548, w: 95, h: 76, kind: 'crate' },
  { id: 'wrapping-table', x: 520, y: 566, w: 125, h: 67, kind: 'table' },
  { id: 'control-console', x: 890, y: 529, w: 166, h: 57, kind: 'machine' }
];

export const SPAWNS = [
  { x: 488, y: 314 }, { x: 708, y: 314 }, { x: 488, y: 448 },
  { x: 709, y: 448 }, { x: 518, y: 448 }
];

const walkable = [...ROOMS, ...CORRIDORS];
const inside = (x, y, rect) => x >= rect.x && y >= rect.y && x <= rect.x + rect.w && y <= rect.y + rect.h;

export function canStandAt(x, y, radius = PLAYER_RADIUS) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const offsets = [
    [0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius],
    [radius * .68, radius * .68], [-radius * .68, radius * .68],
    [radius * .68, -radius * .68], [-radius * .68, -radius * .68]
  ];
  if (offsets.some(([dx, dy]) => !walkable.some(area => inside(x + dx, y + dy, area)))) return false;
  return !OBSTACLES.some(obstacle => {
    const closestX = Math.max(obstacle.x, Math.min(x, obstacle.x + obstacle.w));
    const closestY = Math.max(obstacle.y, Math.min(y, obstacle.y + obstacle.h));
    const dx = x - closestX, dy = y - closestY;
    return dx * dx + dy * dy < radius * radius;
  });
}

export function roomAt(x, y) {
  // Break room wins at the central overlap by being listed explicitly first.
  const breakRoom = ROOMS.find(room => room.id === 'break');
  if (inside(x, y, breakRoom)) return breakRoom.name;
  const found = ROOMS.find(room => inside(x, y, room));
  return found?.name || 'Factory Hallway';
}
