export const TASKS = [
  { id: 'wires', title: 'Wire Matching', room: 'Assembly Line', kind: 'wires', x: 344, y: 253 },
  { id: 'sort', title: 'Sort the Toys', room: 'Teddy Bear Stuffing Room', kind: 'sort', x: 804, y: 257 },
  { id: 'paint', title: 'Paint the Duck', room: 'Paint Shop', kind: 'paint', x: 655, y: 199 },
  { id: 'stack', title: 'Stack the Blocks', room: 'Assembly Line', kind: 'stack', x: 125, y: 268 },
  { id: 'keycard', title: 'Swipe the Keycard', room: 'Control Room', kind: 'keycard', x: 1084, y: 635 },
  { id: 'memory', title: 'Memory Lights', room: 'Battery Storage', kind: 'memory', x: 325, y: 665 }
];
export const CONVEYOR_TUNNELS = [
  { id: 'north-west', x: 360, y: 253, pair: 'north-east' },
  { id: 'north-east', x: 875, y: 253, pair: 'north-west' },
  { id: 'south-west', x: 270, y: 390, pair: 'south-east' },
  { id: 'south-east', x: 930, y: 390, pair: 'south-west' }
];
export const JAM_STATIONS = [
  { id: 'west', label: 'West Relay', x: 300, y: 374 },
  { id: 'east', label: 'East Relay', x: 900, y: 374 }
];
export const BUZZER_POINT = { x: 702, y: 439 };
export const SABOTAGE_DURATION = { lights: 15000, jam: 30000, power: 10000 };
export const KILL_COOLDOWN_MS = 25000;
export const TUNNEL_COOLDOWN_MS = 6500;
export const DISCUSSION_MS = 30000;
export const VOTING_MS = 20000;
