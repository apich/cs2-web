# Dust2 Web protocol v1

This is an original browser FPS prototype. The Node server owns movement, health,
ammo, shooting, purchases, bomb progress and rounds. All messages use JSON over
WebSocket at `/ws`. Time values are Unix milliseconds unless a field ends in `Seconds`.

Client sends `join` once before other actions:

```json
{"type":"join","name":"Player","room":"AB12CD","team":"auto","mode":"deathmatch","bots":6,"maps":["de_dust2","de_mirage"]}
```

`maps` is the player's map *pool*, not a map order: the server draws one id from it
uniformly when it creates the room, and re-draws on a rematch. A pool of one is
that map every time. Unknown ids are dropped; a pool left empty falls back to
`de_dust2`. Omitting `maps` means every registered map, as before.

An empty room creates a new room; a supplied existing code joins that room, whose
mode is authoritative. A supplied unused code creates it. Room codes are uppercase
alphanumeric, 4–12 characters. Team is `T`, `CT`, or `auto`; modes are `deathmatch`
and `defuse`. Maximum players including bots: 10, maximum humans per team: 5.
Bots yield their slots to humans. Match settings are set by the room's creator.

```json
{"type":"welcome","id":"p_...","room":"AB12CD","mode":"deathmatch","team":"T","map":"de_mirage","maps":["de_dust2","de_mirage"],"tickRate":30,"snapshotRate":15,"serverTime":0,"protocol":1}
```

`map` is the map this room actually runs and the client must load; `maps` is the
pool it was drawn from, so the client can show what the room could have been.

Input is sent at 30 Hz, with a monotonically increasing nonnegative integer seq:

```json
{"type":"input","seq":1,"forward":1,"right":0,"yaw":0,"pitch":0,"jump":false,"crouch":false,"walk":false,"fire":false,"reload":false,"slot":1,"interact":false}
```

Coordinates: Y up; player's y is feet position; yaw 0 looks toward -Z; positive
pitch looks up. Forward/right are -1..1. Slot 1 is rifle, 2 pistol, 3 knife.
Holding interact (E) plants when the carrier is in a bomb site, or defuses when a
CT is close to the planted bomb. Inputs expire after 300 ms without a new input.
Buy via `{"type":"buy","weapon":"ak47"}` (`m4a1`, `awp` also supported).
Aliases `ak`, `m4` accepted. Deathmatch has free purchases; defuse purchases require
money, the buy period and proximity to the team's spawn. An armor purchase is
`{"type":"buy","weapon":"armor"}` (650). Client pings can be echoed:
`{"type":"ping","time":123}` → `{"type":"pong","time":123,"serverTime":...}`.

Snapshots arrive at 15 Hz:

```json
{"type":"snapshot","time":0,"room":"AB12CD","mode":"deathmatch","map":"de_mirage","maps":["de_dust2","de_mirage"],"players":[],"round":{},"bomb":{},"scores":{"T":0,"CT":0},"events":[]}
```

Each player: id, name, team, bot, x/y/z, vx/vy/vz, yaw/pitch, crouch, grounded,
onLadder, health, armor, alive, weapon, slot, ammo, reserve, reloadRemaining,
money, kills, deaths, assists, seq (last processed input), inventory (weapon
IDs), hasBomb, spawnProtectionRemaining, respawnIn, lastShotTime.

`onLadder` is true while the player is climbing a ladder volume. Climbing is a
server-owned state reached by walking into the volume while looking at it: the
climb rate is the sign of the pitch (look up to climb, level to hold, look down
to descend), horizontal position is frozen, and jumping pushes off. Maps without
ladder volumes (Dust II) never set it.

The server replies `{"type":"error","code":"MAP_UNAVAILABLE","message":"..."}` to a
join naming a map whose collision world is not resident.

Round: number, phase (`waiting`, `freeze`, `live`, `ended`), phaseEndsAt,
timeLeft, buyEndsAt, winner (null or team), reason. Deathmatch is continuously live.
Bomb: state (`carried`, `dropped`, `planted`, `exploded`, `defused`, `none`),
carrierId, x/y/z, site, plantedAt, explodesAt, planterId, actorId, action
(`plant`/`defuse`/null), progress (0..1), remaining. A dropped bomb is picked up
automatically by a living T within 2.3 units. Plant = 3 seconds; defuse = 5 seconds;
fuse = 40 seconds. Plant/defuse require a stationary living actor.

Event types: `shot` (shooterId, weapon, origin, end, hitId, headshot), `hit`
(shooterId, targetId, damage, headshot), `kill` (killerId, victimId, weapon,
headshot), `spawn`, `round_start`, `round_end`, `bomb_planted`, `bomb_defused`,
`bomb_exploded`, `buy`, `join`, `leave`. Events have id/time, are delivered once
per broadcast and should be deduplicated by id. No chat or external services.

Errors: `{"type":"error","code":"...","message":"..."}`. The server rejects
invalid JSON, oversized frames, join spam, stale inputs, non-finite coordinates,
invalid weapons and excessive requests. Invalid inputs never set positions.
Disconnect removes the player and drops their bomb. Empty human rooms are removed.

## Accounts (optional)

Accounts are optional: a guest can join without one, but name, loadouts and
stats only persist for logged-in players. All account messages are sent on the
same `/ws` connection and work before `join`:

```json
{"type":"register","username":"alice","password":"secret"}
{"type":"login","username":"alice","password":"secret"}
{"type":"loginToken","token":"<hex>"}
```

Success answers `{"type":"authOk","token":"...","account":{...}}`. `account`
carries `username`, `name`, `skins` (`{ct,t}` per-team loadouts), `agents`,
`settings` and `stats` (kills/deaths/wins/matches/xp/level). Tokens expire after
30 days; passwords are stored as scrypt hashes, tokens as SHA-256 hashes, in
`data/accounts.json` (path overridable with `DATA_DIR`).

While authenticated on a connection:

- `join` overrides the message's `name`, `skins` and `agents` with the account's
  values (skins are picked per assigned team). Clients should still send valid
  cosmetics so guests keep working.
- `{"type":"equipSkin","weapon":"ak47","skin":"...","team":"CT"}` and
  `{"type":"equipAgent","agent":"..."}` also write back to the account; `team`
  selects which side's loadout the skin is stored under (`CT`/`T`, defaults to
  the player's current team).
- `{"type":"saveProfile","name":"...","skins":{...},"agents":{...},"settings":{...}}`
  merges a partial profile (debounced client-side) and answers
  `{"type":"profileSaved","account":{...}}`.
- `{"type":"logout","token":"..."}` revokes the token.

Auth failures answer `error` with codes `AUTH_BAD_CREDENTIALS`, `AUTH_TAKEN`,
`AUTH_BAD_TOKEN`, `AUTH_USERNAME`, `AUTH_PASSWORD`, `AUTH_RATE`, `AUTH_LOCKED`.
Repeated password failures lock further attempts on that connection for 60s.

HTTP: `/health` returns room/player statistics; other requests serve the built
`dist` frontend when present. `PORT` defaults to 3000; `HOST` defaults to 0.0.0.0.
Programmatic API: `await startGameServer({port: 0, host: '127.0.0.1'})` returns
`{ server, wss, rooms, port, close }` for integration tests.
