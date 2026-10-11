# GLITCH IN THE TOY FACTORY

A browser-based multiplayer social-deduction party game for **3–5 players**. The current build includes all six requested milestones: rooms and lobby, synced factory movement, secret roles and tasks, eliminations and meetings, sabotage and conveyor tunnels, plus the mini-games and polish layer.

## Run locally

Requirements: Node.js 20+ recommended and npm.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies Socket.IO to the authoritative Node server on port 3001. Test with three to five tabs, browser profiles, or devices: create a room in one, share its invite, then join from the others. Each browser tab has its own reconnect identity.

Production build / local production server:

```bash
npm run build
NODE_ENV=production npm start
```

The production server reads `PORT` (default 3001), binds to `0.0.0.0`, and serves both the client and Socket.IO from one origin.

## Rules and controls

- One player is randomly selected as the **Glitch**; everyone else is a **Worker**. The server sends each role privately. Roles are revealed after the game ends.
- **Workers** finish their three assigned mini-game tasks, report bodies, use the Break Room buzzer once, and vote together. Completing all worker tasks or voting out the Glitch wins for Workers.
- **The Glitch** can short-circuit a nearby worker (25-second cooldown), travel through conveyor tunnels, or trigger Lights Out, Jammed Conveyor, and Power Surge. The Glitch wins when only one Worker remains or a sabotage timer runs out.
- Eliminated Workers become friendly ghosts: they can pass through walls, see the whole factory, and finish their tasks, but cannot chat with the living or vote.
- Meetings have a 30-second discussion and 20-second vote. Most votes eject; ties and a skip vote eject nobody. Vote choices are revealed afterward.

### Keyboard

- **WASD / arrow keys** — move
- **E** — open a nearby assigned task
- **Q** — short-circuit a nearby Worker (Glitch)
- **R** — report a nearby body
- **B** — Emergency Buzzer when standing by the Break Room table
- **V** — conveyor tunnel (Glitch)
- **Z / X / C** — Lights / Jam / Power sabotage (Glitch)
- **T** — open chat; **1–4** — wave, dance, laugh, point

### Touch

Drag the on-screen joystick to move. Use the on-screen task list, chat, emote wheel, and contextual action buttons.

## Mini-games

- Wire Matching — connect matching plugs
- Sort the Toys — sort toys into the right bins
- Paint the Duck — hold and release in the target zone
- Stack the Blocks — tap in the timing window
- Swipe the Keycard — swipe across at the right speed
- Memory Lights — repeat the light pattern

Each Worker gets three tasks. Task markers glow on the map and shared progress is visible to everyone.

## Multiplayer and anti-cheat

- The Node + Socket.IO server is authoritative. Clients send directional input—not positions—and the server simulates and broadcasts positions at 20 Hz.
- Server checks movement speed, wall/prop/player collisions, task assignment and proximity, one open task per player, minimum task duration and puzzle solutions, kill range/cooldown, reports, buzzer use, votes, sabotage role, and tunnel range.
- Workers see nearby player/body positions; the Glitch has a larger radius and ghosts see the full floor. Role data is never included in public room or position snapshots.
- Disconnected seats are reserved for 45 seconds. If the Glitch disconnects or leaves mid-shift, Workers win.
- Rooms live in memory; a server restart clears them.

## Free deployment (Render)

1. Push this project folder to a GitHub repository.
2. Create a Render **Web Service** from that repository.
3. Set **Build Command** to `npm install && npm run build`.
4. Set **Start Command** to `npm start` and environment variable `NODE_ENV=production`.
5. Deploy. Render provides a stable HTTPS URL for rooms and invite links.

Railway works similarly: use the same build/start commands and set `NODE_ENV=production`.

## Source layout

```text
client/       Vite UI, canvas factory map, minigames, Web Audio sound effects
server/       Express + Socket.IO authoritative multiplayer/game state
shared/       Shared map geometry, collision rules, tasks, tunnels, sabotage constants
```
