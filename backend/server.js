require('dotenv').config?.();

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { Server } = require('socket.io');

const db = require('./db');
const {
  createRoom,
  getRoom,
  joinRoom,
  addBots,
  startMatch,
  publicRoom,
  patchPlayer,
  addFeed,
  ensureChallenge,
  safeChallenge,
  verifyChallenge,
  startBotLoop
} = require('./game');
const { mentorHint, ZAI_ENABLED } = require('./ai');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-me';
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map(x => x.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'development-only-change-me') {
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN.length ? CORS_ORIGIN : true,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({
  origin(origin, cb) {
    if (!origin || !CORS_ORIGIN.length || CORS_ORIGIN.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '64kb' }));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

app.use('/api/', apiLimiter);

// Demo-memory auth fallback. PostgreSQL is used automatically when DATABASE_URL exists.
const memUsersByName = new Map();
const memUsersById = new Map();

function makeToken(user) {
  return jwt.sign(
    { sub: user.user_id || user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '8h', issuer: 'cyber-arena' }
  );
}

function authFromToken(token) {
  return jwt.verify(token, JWT_SECRET, { issuer: 'cyber-arena' });
}

function tokenFromReq(req) {
  const h = String(req.headers.authorization || '');
  if (h.startsWith('Bearer ')) return h.slice(7);
  return '';
}

function requireAuth(req, res, next) {
  try {
    const token = tokenFromReq(req);
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    req.user = authFromToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired or invalid.' });
  }
}

const authSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),
  password: z.string().min(10).max(128)
});

app.post('/api/auth/signup', authLimiter, async (req, res, next) => {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Use a 3–32 character username and a password of at least 10 characters.' });
    const { username, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    if (db.hasDb()) {
      try {
        const q = await db.query(
          `INSERT INTO users(username,password_hash) VALUES($1,$2)
           RETURNING user_id,username,created_at`,
          [username, passwordHash]
        );
        return res.status(201).json({ user: q.rows[0] });
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Username already exists.' });
        throw err;
      }
    }

    const key = username.toLowerCase();
    if (memUsersByName.has(key)) return res.status(409).json({ error: 'Username already exists.' });
    const user = { id: crypto.randomUUID(), username, password_hash: passwordHash, created_at: new Date().toISOString() };
    memUsersByName.set(key, user);
    memUsersById.set(user.id, user);
    return res.status(201).json({ user: { user_id: user.id, username: user.username, created_at: user.created_at } });
  } catch (err) { next(err); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(401).json({ error: 'Invalid credentials.' });
    const { username, password } = parsed.data;

    let user;
    if (db.hasDb()) {
      const q = await db.query(`SELECT user_id,username,password_hash FROM users WHERE username=$1`, [username]);
      user = q.rows[0];
    } else {
      user = memUsersByName.get(username.toLowerCase());
    }

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const id = user.user_id || user.id;
    const token = makeToken(user);
    return res.json({ token, user: { id, username: user.username } });
  } catch (err) { next(err); }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ user: { id: req.user.sub, username: req.user.username } });
});

const createRoomSchema = z.object({
  roomName: z.string().trim().min(1).max(80),
  handle: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/),
  mode: z.enum(['classic', 'duel', 'teams'])
});

app.post('/api/rooms/create', requireAuth, async (req, res, next) => {
  try {
    const data = createRoomSchema.parse(req.body);
    const room = createRoom({
      instructorId: req.user.sub,
      roomName: data.roomName,
      mode: data.mode,
      handle: data.handle
    });

    if (db.hasDb()) {
      await db.query(
        `INSERT INTO rooms(room_id,room_name,instructor_id,mode,match_state)
         VALUES($1,$2,$3,$4,'lobby')`,
        [room.roomId, room.roomName, room.instructorId, room.mode]
      );
      await upsertHumanSession(room, room.players[0]);
    }

    addFeed(room, `${data.handle} created ${room.mode.toUpperCase()} match ${room.roomId}.`, 'room');
    return res.status(201).json({ room: publicRoom(room) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid room settings.' });
    next(err);
  }
});

const joinSchema = z.object({
  roomCode: z.string().trim().length(6),
  handle: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/)
});

app.post('/api/rooms/join', requireAuth, async (req, res, next) => {
  try {
    const data = joinSchema.parse(req.body);
    const room = getRoom(data.roomCode);
    if (!room) return res.status(404).json({ error: 'Room not found on this server instance.' });

    const p = joinRoom(room, { userId: req.user.sub, handle: data.handle });
    if (db.hasDb()) await upsertHumanSession(room, p);

    const feed = addFeed(room, `${p.handle} connected to the classroom arena.`, 'join');
    io.to(`room:${room.roomId}`).emit('feed:event', feed);
    broadcastRoom(room);
    io.to(`room:${room.roomId}`).emit('room:playerJoined', { handle: p.handle });

    return res.json({ room: publicRoom(room) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid room code or handle.' });
    return res.status(400).json({ error: err.message || 'Could not join room.' });
  }
});

app.post('/api/rooms/:code/bots', requireAuth, async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  if (room.instructorId !== req.user.sub) return res.status(403).json({ error: 'Instructor only.' });
  if (room.matchState !== 'lobby') return res.status(400).json({ error: 'Add bots before starting the match.' });

  const added = addBots(room, Number(req.body?.count || 1));
  const feed = addFeed(room, `${added} AI training bot${added === 1 ? '' : 's'} entered the simulation.`, 'bot');
  io.to(`room:${room.roomId}`).emit('feed:event', feed);
  broadcastRoom(room);
  return res.json({ ok: true, added, room: publicRoom(room) });
});

app.post('/api/rooms/:code/start', requireAuth, async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  if (room.instructorId !== req.user.sub) return res.status(403).json({ error: 'Instructor only.' });

  try {
    startMatch(room);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const feed = addFeed(room, `${room.mode.toUpperCase()} simulation started. All targets are fictional classroom nodes.`, 'start');
  io.to(`room:${room.roomId}`).emit('feed:event', feed);
  io.to(`room:${room.roomId}`).emit('match:state', {
    matchState: room.matchState,
    teamHealth: room.teamHealth,
    message: room.mode === 'duel' ? 'DUEL STARTED' : room.mode === 'teams' ? 'RED TEAM VS BLUE TEAM' : 'CLASSIC LAB STARTED'
  });
  broadcastRoom(room);

  startBotLoop(room, (event, payload) => {
    io.to(`room:${room.roomId}`).emit(event, payload);
    broadcastRoom(room);
  });

  return res.json({ ok: true, message: 'Match started.', room: publicRoom(room) });
});

app.post('/api/game/scan', requireAuth, async (req, res, next) => {
  try {
    const room = getRoom(req.body?.roomCode);
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    if (room.matchState !== 'running') return res.status(400).json({ error: 'Start the match before scanning.' });

    const attacker = room.players.find(p => p.userId === req.user.sub);
    const target = room.players.find(p => p.userId === req.body?.targetUserId);
    if (!attacker || !target) return res.status(403).json({ error: 'Player is not in this room.' });
    if (attacker.userId === target.userId) return res.status(400).json({ error: 'Select another classroom node.' });
    if (room.mode === 'teams' && attacker.team === target.team) {
      return res.status(400).json({ error: 'Team mode allows offensive challenges only against the opposing team.' });
    }

    const challenge = await ensureChallenge(room, attacker, target);
    const feed = addFeed(room, `${attacker.handle} scanned synthetic node ${target.nodeId} (${target.handle}).`, 'scan');
    io.to(`room:${room.roomId}`).emit('feed:event', feed);

    return res.json({
      target: { userId: target.userId, handle: target.handle, nodeId: target.nodeId },
      challenge: safeChallenge(challenge)
    });
  } catch (err) { next(err); }
});

app.post('/api/exploit/verify', requireAuth, async (req, res) => {
  const room = getRoom(req.body?.roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  if (room.matchState !== 'running') return res.status(400).json({ error: 'Match is not running.' });

  const attacker = room.players.find(p => p.userId === req.user.sub);
  if (!attacker) return res.status(403).json({ error: 'Not a combatant in this room.' });

  try {
    const result = verifyChallenge(room, attacker, req.body?.challengeId, req.body?.answer);
    const feed = addFeed(
      room,
      result.success
        ? `${attacker.handle} solved a fictional vulnerability puzzle on ${result.target.handle} +${result.xp}XP.`
        : `${attacker.handle} attempted a classroom diagnostic puzzle.`,
      result.success ? 'exploit-success' : 'exploit-failed'
    );

    io.to(`room:${room.roomId}`).emit('feed:event', feed);
    io.to(`room:${room.roomId}`).emit('challenge:resolved', {
      userId: attacker.userId,
      success: result.success,
      message: result.message
    });
    io.to(`room:${room.roomId}`).emit('shield:update', {
      userId: result.target.userId,
      shield: result.target.shield
    });

    if (room.matchState === 'ended') {
      io.to(`room:${room.roomId}`).emit('match:state', {
        matchState: room.matchState,
        teamHealth: room.teamHealth,
        message: room.mode === 'teams'
          ? `${String(room.winner).toUpperCase()} TEAM WINS`
          : `${attacker.handle} WINS THE DUEL`
      });
    }

    broadcastRoom(room);
    await persistPlayer(room, attacker);
    if (!result.target.isBot) await persistPlayer(room, result.target);
    await logDb(room, attacker.userId, result.target.userId, result.success ? 'exploit-success' : 'exploit-failed', { xp: result.xp });

    return res.json({ success: result.success, xp: result.xp, message: result.message });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.post('/api/defense/patch', requireAuth, async (req, res) => {
  const room = getRoom(req.body?.roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const player = room.players.find(p => p.userId === req.user.sub);
  if (!player) return res.status(403).json({ error: 'Not in this room.' });

  try {
    const result = patchPlayer(room, player);
    const feed = addFeed(room, `${player.handle} compiled a defensive patch (-${result.cost}XP, shield ${result.shield}%).`, 'patch');
    io.to(`room:${room.roomId}`).emit('feed:event', feed);
    io.to(`room:${room.roomId}`).emit('shield:update', { userId: player.userId, shield: player.shield });
    broadcastRoom(room);
    await persistPlayer(room, player);
    return res.json({ ok: true, message: `Patch compiled. Shield restored to ${result.shield}%.` });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.post('/api/ai/hint', requireAuth, aiLimiter, async (req, res) => {
  const room = getRoom(req.body?.roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const challenge = [...room.challenges.values()].find(c => c.challengeId === req.body?.challengeId);
  if (!challenge || challenge.attackerId !== req.user.sub) return res.status(404).json({ error: 'Challenge not found.' });

  const hint = await mentorHint({
    challenge,
    question: String(req.body?.question || 'Help me reason about this challenge.').slice(0, 500),
    attempts: challenge.attempts
  });
  return res.json({ hint });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    rooms: require('./game').rooms.size,
    database: db.hasDb(),
    aiEnabled: ZAI_ENABLED
  });
});

function broadcastRoom(room) {
  const payload = publicRoom(room);
  io.to(`room:${room.roomId}`).emit('room:state', payload);
  io.to(`room:${room.roomId}`).emit(
    'leaderboard:update',
    payload.players.slice().sort((a, b) => b.xp - a.xp || b.level - a.level)
  );
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Unauthorized'));
    socket.data.user = authFromToken(token);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', socket => {
  socket.on('room:join', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.userId === socket.data.user.sub);
    if (!player) return;
    socket.join(`room:${room.roomId}`);
    socket.data.roomCode = room.roomId;
    player.online = true;
    socket.emit('room:state', publicRoom(room));
    socket.emit('leaderboard:update', publicRoom(room).players.slice().sort((a, b) => b.xp - a.xp));
    room.feed.slice().reverse().forEach(item => socket.emit('feed:event', item));
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket.data.roomCode);
    if (!room) return;
    const p = room.players.find(x => x.userId === socket.data.user.sub);
    if (p) {
      p.online = false;
      const feed = addFeed(room, `${p.handle} disconnected.`, 'leave');
      io.to(`room:${room.roomId}`).emit('feed:event', feed);
      io.to(`room:${room.roomId}`).emit('room:playerLeft', { handle: p.handle });
      broadcastRoom(room);
    }
  });
});

async function upsertHumanSession(room, player) {
  if (!db.hasDb() || player.isBot) return;
  await db.query(
    `INSERT INTO player_sessions(user_id,player_handle,current_room_id,active_score_xp,current_level,defensive_shield_status,connection_status,team)
     VALUES($1,$2,$3,$4,$5,$6,'online',$7)
     ON CONFLICT(current_room_id,player_handle)
     DO UPDATE SET user_id=EXCLUDED.user_id, active_score_xp=EXCLUDED.active_score_xp,
       current_level=EXCLUDED.current_level, defensive_shield_status=EXCLUDED.defensive_shield_status,
       connection_status='online', team=EXCLUDED.team, last_seen_at=NOW()`,
    [player.userId, player.handle, room.roomId, player.xp, player.level, player.shield, player.team]
  );
}

async function persistPlayer(room, player) {
  if (!db.hasDb() || player.isBot) return;
  await db.query(
    `UPDATE player_sessions SET active_score_xp=$1,current_level=$2,defensive_shield_status=$3,team=$4,last_seen_at=NOW()
     WHERE user_id=$5 AND current_room_id=$6`,
    [player.xp, player.level, player.shield, player.team, player.userId, room.roomId]
  );
}

async function logDb(room, actor, target, type, payload) {
  if (!db.hasDb()) return;
  await db.query(
    `INSERT INTO activity_log(room_id,actor_user_id,target_user_id,event_type,event_payload)
     VALUES($1,$2,$3,$4,$5)`,
    [room.roomId, actor && /^[0-9a-f-]{36}$/i.test(actor) ? actor : null, target && /^[0-9a-f-]{36}$/i.test(target) ? target : null, type, JSON.stringify(payload || {})]
  );
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

db.initDb()
  .then(() => server.listen(PORT, () => {
    console.log(`Cyber Arena server listening on ${PORT}`);
    console.log(`AI enabled: ${ZAI_ENABLED}`);
  }))
  .catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
