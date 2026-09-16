# Cyber Arena — Classroom Wargame

A closed, simulated cybersecurity classroom game. It does **not** scan or exploit real devices. All nodes, services, ports, vulnerabilities and terminal interactions are fictional game state.

## Included game modes

- **Classic Lab** — free-for-all simulated vulnerability discovery and XP.
- **Duel** — exactly two combatants. Successful server-validated puzzle solves damage the opponent's shield. You can add one bot and play 1v1.
- **Team vs Team** — Red Team vs Blue Team. Add classmates and/or bots; successful challenge solves damage the opposing team's integrity.
- **AI bots** — the instructor can add bots before starting. Bots solve synthetic challenges, patch themselves, target low-shield opponents and optionally use Z.AI for high-level game decisions.
- **Z-Shield AI** — adaptive Socratic hints. Z.AI never receives or returns instructions for attacking real systems.

## Architecture

```text
InfinityFree
  frontend/
    index.html
    style.css
    app.js
    config.js
       |
       | HTTPS + Socket.IO
       v
Render Web Service
  backend/
    server.js
    game.js
    ai.js
    db.js
    schema.sql
    package.json
       |
       +--> Render PostgreSQL (recommended)
       |
       +--> Z.AI API (optional)
```

GitHub stores the source. InfinityFree serves only the static frontend. Render runs Node.js + Socket.IO.

## 1. GitHub

Create a repository, for example:

`cyber-arena-classroom`

Upload the full project, or at minimum the `backend/` directory for the Render service.

## 2. Render backend

Create a Node Web Service using `backend` as the Root Directory.

Build command:

```text
npm install
```

Start command:

```text
npm start
```

Set environment variables:

```text
NODE_ENV=production
JWT_SECRET=<a long random secret>
CORS_ORIGIN=https://YOUR-INFINITYFREE-DOMAIN
DATABASE_URL=<your PostgreSQL connection string>

ZAI_ENABLED=true
ZAI_API_KEY=<your secret Z.AI key>
ZAI_MODEL=glm-5.2
ZAI_BASE_URL=https://api.z.ai/api/paas/v4
```

The Z.AI key belongs **only** on Render. Never put it in frontend files.

Test:

```text
https://YOUR-RENDER-SERVICE.onrender.com/health
```

Expected shape:

```json
{
  "ok": true,
  "rooms": 0,
  "database": true,
  "aiEnabled": true
}
```

### PostgreSQL

Point `DATABASE_URL` at PostgreSQL. `server.js` automatically executes `schema.sql` at startup.

If `DATABASE_URL` is absent, the server starts in a **demo-memory mode** for quick testing. Accounts and persistent data are lost on restart in demo mode, so use PostgreSQL for classroom deployment.

## 3. InfinityFree frontend

Edit:

`frontend/config.js`

Set:

```js
window.CYBER_ARENA_CONFIG = {
  SERVER_URL: "https://YOUR-RENDER-SERVICE.onrender.com"
};
```

Upload these four files directly to InfinityFree `htdocs/`:

```text
index.html
style.css
app.js
config.js
```

Then hard-refresh the browser.

## Gameplay

### Instructor

1. Sign up and login.
2. Pick a mode.
3. Create a room.
4. Share the six-character room code.
5. Optionally add bots.
6. Start the match.

### Students

1. Sign up/login.
2. Join using room code + handle.
3. Select a peer.
4. Press **SCAN**.
5. Solve the synthetic diagnostic puzzle.
6. Submit the answer; the server validates it.
7. Earn XP and, in Duel/Team modes, damage shields.
8. Spend XP in **Defense Matrix** to restore shield integrity.

### Terminal commands

The terminal is a tiny game DSL, not an operating-system shell:

```text
help
status
peers
scan <handle>
shield
clear
```

No input is passed to Bash, PowerShell, SSH, Docker, or any real network scanner.

## Bot behavior

Bots:
- join as simulated classroom players;
- have levels, XP, shields and teams;
- periodically choose a synthetic opponent;
- solve game puzzles probabilistically;
- patch when damaged;
- use Z.AI for high-level choices when enabled;
- fall back to deterministic behavior if the AI provider is unavailable.

Bots never execute real attack commands.

## Important production notes

The included server is designed for a **single active Render game-server instance**, which matches the earlier Space Party deployment pattern. Socket.IO and game state are in memory for low latency.

For horizontal scaling across multiple Node instances, move room/game state to Redis or another shared state store before enabling multiple backend instances.

Recommended additional production hardening:
- terminate TLS at Render;
- use a long random `JWT_SECRET`;
- keep CORS restricted to your InfinityFree origin;
- enable PostgreSQL;
- add teacher/student roles if accounts are pre-provisioned;
- add password reset / account lifecycle workflows;
- add automated backups and log retention;
- add per-class AI quotas before a large rollout.

## Safety boundary

Cyber Arena intentionally uses:
- synthetic node IDs;
- fictional services;
- fictional versions;
- puzzle-based validation;
- server-authoritative XP/shields;
- constrained AI prompts.

It intentionally does **not** include:
- real LAN scanning;
- arbitrary shell execution;
- actual exploit payloads;
- IP enumeration;
- credential theft;
- real-system targeting.
