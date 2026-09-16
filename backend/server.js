'use strict';

require('dotenv').config();

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
  rooms,
  DIFFICULTY,
  rankTitle,
  createRoom,
  getRoom,
  findUserRoom,
  joinRoom,
  addExistingHuman,
  addBots,
  startMatch,
  publicRoom,
  patchPlayer,
  addFeed,
  ensureChallenge,
  safeChallenge,
  verifyChallenge,
  startBotLoop,
  stopBotLoop,
  matchEndPayload,
  canRematch
} = require('./game');
const { mentorHint, explainConcept, ZAI_ENABLED } = require('./ai');

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
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25_000,
  pingTimeout: 20_000
});

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, cb) {
    if (!origin || !CORS_ORIGIN.length || CORS_ORIGIN.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '96kb' }));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const scanLimiter = rateLimit({ windowMs: 60_000, limit: 24, standardHeaders: true, legacyHeaders: false, keyGenerator: req => req.user?.sub || req.ip });
const answerLimiter = rateLimit({ windowMs: 60_000, limit: 45, standardHeaders: true, legacyHeaders: false, keyGenerator: req => req.user?.sub || req.ip });
app.use('/api/', apiLimiter);

const memUsersByName = new Map();
const memUsersById = new Map();
const actionCooldowns = new Map();

const ACHIEVEMENTS = {
  FIRST_BREACH: { name: 'FIRST BREACH', description: 'Complete your first synthetic challenge.' },
  PERFECT_LOGIC: { name: 'PERFECT LOGIC', description: 'Solve a challenge on the first attempt.' },
  PATCH_MASTER: { name: 'PATCH MASTER', description: 'Deploy five defensive patches.' },
  BOT_HUNTER: { name: 'BOT HUNTER', description: 'Win ten matches that include AI opponents.' },
  TEAM_PLAYER: { name: 'TEAM PLAYER', description: 'Win five Team Battles.' },
  UNTOUCHABLE: { name: 'UNTOUCHABLE', description: 'Win a Duel above 75% shield integrity.' },
  DEFENDER: { name: 'DEFENDER', description: 'Win a match at full shield integrity.' }
};

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
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7) : '';
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

function checkCooldown(userId, key, waitMs) {
  const id = `${userId}:${key}`;
  const now = Date.now();
  const until = actionCooldowns.get(id) || 0;
  if (now < until) return until - now;
  actionCooldowns.set(id, now + waitMs);
  return 0;
}

function xpRequiredForLevel(level) {
  const l = Math.max(1, Number(level) || 1);
  return Math.floor(500 + (l - 1) * 250 + Math.pow(l - 1, 1.35) * 45);
}

function levelFromXp(totalXp) {
  let level = 1;
  let remaining = Math.max(0, Number(totalXp) || 0);
  while (level < 100 && remaining >= xpRequiredForLevel(level)) {
    remaining -= xpRequiredForLevel(level);
    level += 1;
  }
  return { level, progressXp: remaining, nextXp: xpRequiredForLevel(level) };
}

function publicProfileFromRows(user, stats = {}, achievements = [], history = []) {
  const accountXp = Number(user.account_xp || user.accountXp || 0);
  const computed = levelFromXp(accountXp);
  const level = Math.max(Number(user.account_level || user.accountLevel || 1), computed.level);
  return {
    id: user.user_id || user.id,
    username: user.username,
    displayHandle: user.display_handle || user.displayHandle || user.username,
    onboardingCompleted: Boolean(user.onboarding_completed ?? user.onboardingCompleted),
    accountXp,
    accountLevel: level,
    rank: rankTitle(level),
    xpIntoLevel: computed.progressXp,
    xpForNextLevel: computed.nextXp,
    stats: {
      matchesPlayed: Number(stats.matches_played || stats.matchesPlayed || 0),
      wins: Number(stats.wins || 0),
      losses: Number(stats.losses || 0),
      duelWins: Number(stats.duel_wins || stats.duelWins || 0),
      teamWins: Number(stats.team_wins || stats.teamWins || 0),
      botWins: Number(stats.bot_wins || stats.botWins || 0),
      challengesSolved: Number(stats.challenges_solved || stats.challengesSolved || 0),
      successfulPatches: Number(stats.successful_patches || stats.successfulPatches || 0),
      successfulAttempts: Number(stats.successful_attempts || stats.successfulAttempts || 0),
      totalAttempts: Number(stats.total_attempts || stats.totalAttempts || 0),
      bestStreak: Number(stats.best_streak || stats.bestStreak || 0)
    },
    achievements,
    recentMatches: history
  };
}

async function ensureStatsRow(userId) {
  if (!db.hasDb()) return;
  await db.query('INSERT INTO player_stats(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [userId]);
}

async function loadProfile(userId) {
  if (!db.hasDb()) {
    const user = memUsersById.get(userId);
    if (!user) throw new Error('User not found.');
    return publicProfileFromRows(user, user.stats, [...user.achievements].map(key => ({ key, ...ACHIEVEMENTS[key], unlockedAt: user.created_at })), user.history || []);
  }

  await ensureStatsRow(userId);
  const userQ = await db.query(`
    SELECT user_id, username, display_handle, onboarding_completed, account_xp, account_level, created_at
    FROM users WHERE user_id=$1
  `, [userId]);
  const user = userQ.rows[0];
  if (!user) throw new Error('User not found.');

  const statsQ = await db.query('SELECT * FROM player_stats WHERE user_id=$1', [userId]);
  const achievementsQ = await db.query(`
    SELECT achievement_key, unlocked_at, metadata
    FROM user_achievements WHERE user_id=$1 ORDER BY unlocked_at DESC
  `, [userId]);
  const historyQ = await db.query(`
    SELECT mh.match_id, mh.mode, mh.started_at, mh.finished_at, mh.winner_team,
           mp.result, mp.match_xp, mp.shield_end, mp.account_xp_awarded
    FROM match_participants mp
    JOIN match_history mh ON mh.match_id=mp.match_id
    WHERE mp.user_id=$1
    ORDER BY mh.started_at DESC
    LIMIT 10
  `, [userId]);

  const achievements = achievementsQ.rows.map(row => ({
    key: row.achievement_key,
    ...(ACHIEVEMENTS[row.achievement_key] || { name: row.achievement_key, description: '' }),
    unlockedAt: row.unlocked_at,
    metadata: row.metadata
  }));

  const history = historyQ.rows.map(row => ({
    matchId: row.match_id,
    mode: row.mode,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    matchXp: row.match_xp,
    shieldEnd: row.shield_end,
    accountXpAwarded: row.account_xp_awarded,
    winnerTeam: row.winner_team
  }));

  return publicProfileFromRows(user, statsQ.rows[0] || {}, achievements, history);
}

async function updateDisplayHandle(userId, handle) {
  if (!db.hasDb()) {
    const user = memUsersById.get(userId);
    user.displayHandle = handle;
    return;
  }
  await db.query('UPDATE users SET display_handle=$1 WHERE user_id=$2', [handle, userId]);
}

async function markOnboardingComplete(userId) {
  if (!db.hasDb()) {
    const user = memUsersById.get(userId);
    if (user) user.onboardingCompleted = true;
    return;
  }
  await db.query('UPDATE users SET onboarding_completed=TRUE WHERE user_id=$1', [userId]);
}

async function addAccountXp(userId, amount) {
  const delta = Math.max(0, Number(amount) || 0);
  if (!delta) return loadProfile(userId);

  if (!db.hasDb()) {
    const user = memUsersById.get(userId);
    const before = levelFromXp(user.accountXp || 0).level;
    user.accountXp = (user.accountXp || 0) + delta;
    const after = levelFromXp(user.accountXp).level;
    user.accountLevel = after;
    const profile = await loadProfile(userId);
    profile.levelUp = after > before ? { from: before, to: after, rank: rankTitle(after) } : null;
    return profile;
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const currentQ = await client.query('SELECT account_xp,account_level FROM users WHERE user_id=$1 FOR UPDATE', [userId]);
    const current = currentQ.rows[0];
    const before = Number(current.account_level || 1);
    const total = Number(current.account_xp || 0) + delta;
    const after = levelFromXp(total).level;
    await client.query('UPDATE users SET account_xp=$1,account_level=$2 WHERE user_id=$3', [total, after, userId]);
    await client.query('COMMIT');
    const profile = await loadProfile(userId);
    profile.levelUp = after > before ? { from: before, to: after, rank: rankTitle(after) } : null;
    return profile;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function incrementStats(userId, changes) {
  if (!changes || !Object.keys(changes).length) return;
  if (!db.hasDb()) {
    const user = memUsersById.get(userId);
    const s = user.stats;
    for (const [key, value] of Object.entries(changes)) s[key] = (s[key] || 0) + Number(value || 0);
    s.bestStreak = Math.max(s.bestStreak || 0, changes.bestStreakAbsolute || 0);
    return;
  }

  await ensureStatsRow(userId);
  const allowed = {
    matchesPlayed: 'matches_played', wins: 'wins', losses: 'losses', duelWins: 'duel_wins',
    teamWins: 'team_wins', botWins: 'bot_wins', challengesSolved: 'challenges_solved',
    successfulPatches: 'successful_patches', successfulAttempts: 'successful_attempts', totalAttempts: 'total_attempts'
  };
  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, column] of Object.entries(allowed)) {
    if (changes[key]) {
      sets.push(`${column}=${column}+$${i++}`);
      values.push(Number(changes[key]));
    }
  }
  if (changes.currentStreak !== undefined) {
    sets.push(`current_streak=$${i++}`);
    values.push(Number(changes.currentStreak));
  }
  if (changes.bestStreakAbsolute !== undefined) {
    sets.push(`best_streak=GREATEST(best_streak,$${i++})`);
    values.push(Number(changes.bestStreakAbsolute));
  }
  if (!sets.length) return;
  sets.push('updated_at=NOW()');
  values.push(userId);
  await db.query(`UPDATE player_stats SET ${sets.join(',')} WHERE user_id=$${i}`, values);
}

async function awardAchievement(userId, key, metadata = {}) {
  if (!ACHIEVEMENTS[key]) return null;
  if (!db.hasDb()) {
    const user = memUsersById.get(userId);
    if (!user || user.achievements.has(key)) return null;
    user.achievements.add(key);
    return { key, ...ACHIEVEMENTS[key], unlockedAt: new Date().toISOString(), metadata };
  }

  const q = await db.query(`
    INSERT INTO user_achievements(user_id,achievement_key,metadata)
    VALUES($1,$2,$3)
    ON CONFLICT(user_id,achievement_key) DO NOTHING
    RETURNING achievement_key,unlocked_at,metadata
  `, [userId, key, JSON.stringify(metadata)]);
  if (!q.rowCount) return null;
  return { key, ...ACHIEVEMENTS[key], unlockedAt: q.rows[0].unlocked_at, metadata: q.rows[0].metadata };
}

async function checkProgressAchievements(userId, { firstAttempt = false } = {}) {
  const profile = await loadProfile(userId);
  const unlocked = [];
  if (profile.stats.challengesSolved >= 1) unlocked.push(await awardAchievement(userId, 'FIRST_BREACH'));
  if (firstAttempt) unlocked.push(await awardAchievement(userId, 'PERFECT_LOGIC'));
  if (profile.stats.successfulPatches >= 5) unlocked.push(await awardAchievement(userId, 'PATCH_MASTER'));
  if (profile.stats.botWins >= 10) unlocked.push(await awardAchievement(userId, 'BOT_HUNTER'));
  if (profile.stats.teamWins >= 5) unlocked.push(await awardAchievement(userId, 'TEAM_PLAYER'));
  return unlocked.filter(Boolean);
}

async function persistRoomRecord(room) {
  if (!db.hasDb()) return;
  await db.query(`
    INSERT INTO rooms(room_id,room_name,instructor_id,mode,match_state,quick_match,bot_match,bot_difficulty)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT(room_id) DO UPDATE SET
      room_name=EXCLUDED.room_name,mode=EXCLUDED.mode,match_state=EXCLUDED.match_state,
      quick_match=EXCLUDED.quick_match,bot_match=EXCLUDED.bot_match,bot_difficulty=EXCLUDED.bot_difficulty,
      active_status=TRUE
  `, [room.roomId, room.roomName, room.instructorId, room.mode, room.matchState, room.quickMatch, room.botMatch, room.botDifficulty]);
}

async function persistHumanSession(room, player) {
  if (!db.hasDb() || player.isBot) return;
  await db.query(`
    INSERT INTO player_sessions(user_id,player_handle,current_room_id,active_score_xp,current_level,defensive_shield_status,connection_status,team)
    VALUES($1,$2,$3,$4,$5,$6,'online',$7)
    ON CONFLICT(current_room_id,player_handle)
    DO UPDATE SET user_id=EXCLUDED.user_id,active_score_xp=EXCLUDED.active_score_xp,current_level=EXCLUDED.current_level,
      defensive_shield_status=EXCLUDED.defensive_shield_status,connection_status='online',team=EXCLUDED.team,last_seen_at=NOW()
  `, [player.userId, player.handle, room.roomId, player.xp, player.level, player.shield, player.team]);
}

async function persistPlayer(room, player) {
  if (!db.hasDb() || player.isBot) return;
  await db.query(`
    UPDATE player_sessions SET active_score_xp=$1,current_level=$2,defensive_shield_status=$3,team=$4,last_seen_at=NOW()
    WHERE user_id=$5 AND current_room_id=$6
  `, [player.xp, player.level, player.shield, player.team, player.userId, room.roomId]);
}

async function persistChallenge(room, challenge, target) {
  if (!db.hasDb()) return;
  const hash = crypto.createHash('sha256').update(String(challenge.canonicalAnswer).trim().toLowerCase()).digest('hex');
  await db.query(`
    INSERT INTO vulnerability_profiles(
      vulnerability_id,room_id,target_key,vulnerability_key,display_name,mock_port,fictional_service,mock_version,
      description,safety_hint,challenge_type,challenge_prompt,expected_answer_hash,ai_payload
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    ON CONFLICT(vulnerability_id) DO NOTHING
  `, [
    challenge.challengeId, room.roomId, target.userId, `${target.userId}:${challenge.challengeType}`,
    challenge.displayName, challenge.mockPort, challenge.fictionalService, challenge.mockVersion,
    challenge.description, challenge.safetyHint, challenge.challengeType, challenge.challengePrompt, hash,
    JSON.stringify(challenge.aiPayload || {})
  ]);
}

async function recordAttempt(room, attacker, result) {
  if (!db.hasDb() || attacker.isBot) return;
  await db.query(`
    INSERT INTO exploit_attempts(room_id,attacker_id,target_key,vulnerability_id,success,xp_awarded)
    VALUES($1,$2,$3,$4,$5,$6)
  `, [room.roomId, attacker.userId, result.target.userId, result.challenge.challengeId, result.success, result.xp || 0]);
}

async function logDb(room, actor, target, type, payload) {
  if (!db.hasDb()) return;
  const actorUuid = actor && /^[0-9a-f-]{36}$/i.test(actor) ? actor : null;
  const targetUuid = target && /^[0-9a-f-]{36}$/i.test(target) ? target : null;
  await db.query(`
    INSERT INTO activity_log(room_id,actor_user_id,target_user_id,event_type,event_payload)
    VALUES($1,$2,$3,$4,$5)
  `, [room.roomId, actorUuid, targetUuid, type, JSON.stringify(payload || {})]);
}

async function persistMatchStart(room) {
  if (!db.hasDb()) return;
  await db.query(`
    INSERT INTO match_history(match_id,room_id,mode,quick_match,bot_match,bot_difficulty,started_at,participant_count,bot_count)
    VALUES($1,$2,$3,$4,$5,$6,NOW(),$7,$8)
    ON CONFLICT(match_id) DO NOTHING
  `, [room.matchId, room.roomId, room.mode, room.quickMatch, room.botMatch, room.botDifficulty, room.players.length, room.players.filter(p => p.isBot).length]);

  for (const p of room.players) {
    await db.query(`
      INSERT INTO match_participants(match_id,participant_key,user_id,player_handle,is_bot,team)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(match_id,participant_key) DO NOTHING
    `, [room.matchId, p.userId, p.isBot ? null : p.userId, p.handle, p.isBot, p.team]);
  }
}

function humanWon(room, player) {
  if (room.mode === 'teams') return player.team === room.winner;
  return player.userId === room.winner;
}

async function finalizeMatchIfNeeded(room) {
  if (room.matchState !== 'ended' || room.finalized || room._finalizing) return [];
  room._finalizing = true;
  stopBotLoop(room.roomId);
  const achievementEvents = [];
  const botPresent = room.players.some(p => p.isBot);

  try {
  if (db.hasDb()) {
    await db.query(`
      UPDATE match_history SET finished_at=NOW(),winner_user_id=$1,winner_team=$2,participant_count=$3,bot_count=$4
      WHERE match_id=$5
    `, [
      room.mode === 'teams' || String(room.winner || '').startsWith('bot-') ? null : room.winner,
      room.mode === 'teams' ? room.winner : null,
      room.players.length,
      room.players.filter(p => p.isBot).length,
      room.matchId
    ]);
    await db.query('UPDATE rooms SET match_state=$1,active_status=FALSE WHERE room_id=$2', ['ended', room.roomId]);
  }

  for (const p of room.players) {
    const won = humanWon(room, p);
    const result = won ? 'win' : 'loss';
    const bonus = won ? 250 : 80;

    if (!p.isBot) {
      const stats = { matchesPlayed: 1, wins: won ? 1 : 0, losses: won ? 0 : 1 };
      if (won && room.mode === 'duel') stats.duelWins = 1;
      if (won && room.mode === 'teams') stats.teamWins = 1;
      if (won && botPresent) stats.botWins = 1;
      await incrementStats(p.userId, stats);
      const profile = await addAccountXp(p.userId, bonus);
      p.accountXp = profile.accountXp;
      p.level = profile.accountLevel;
      p.rank = profile.rank;

      const newly = [];
      if (won && room.mode === 'duel' && p.shield > 75) newly.push(await awardAchievement(p.userId, 'UNTOUCHABLE'));
      if (won && p.shield === 100) newly.push(await awardAchievement(p.userId, 'DEFENDER'));
      newly.push(...await checkProgressAchievements(p.userId));
      achievementEvents.push(...newly.filter(Boolean).map(a => ({ userId: p.userId, achievement: a })));

      io.to(`user:${p.userId}`).emit('progress:update', { profile, levelUp: profile.levelUp || null });
      for (const a of newly.filter(Boolean)) io.to(`user:${p.userId}`).emit('achievement:unlocked', a);
    }

    if (db.hasDb()) {
      await db.query(`
        UPDATE match_participants SET result=$1,match_xp=$2,shield_end=$3,account_xp_awarded=$4
        WHERE match_id=$5 AND participant_key=$6
      `, [result, p.xp, p.shield, p.isBot ? 0 : bonus, room.matchId, p.userId]);
    }
  }

  room.finalized = true;
  return achievementEvents;
  } finally {
    room._finalizing = false;
  }
}

function detachUserFromOtherRooms(userId, keepRoomId = null) {
  for (const room of rooms.values()) {
    if (room.roomId === keepRoomId) continue;
    const idx = room.players.findIndex(p => p.userId === userId && !p.isBot);
    if (idx >= 0) {
      room.players.splice(idx, 1);
      if (!room.players.some(p => !p.isBot)) {
        stopBotLoop(room.roomId);
        rooms.delete(room.roomId);
      }
    }
  }
}

function broadcastRoom(room) {
  const payload = publicRoom(room);
  io.to(`room:${room.roomId}`).emit('room:state', payload);
  io.to(`room:${room.roomId}`).emit('leaderboard:update', payload.players.slice().sort((a, b) => b.xp - a.xp || b.level - a.level));
}

function botLoopEmitter(room) {
  return async (event, payload) => {
    io.to(`room:${room.roomId}`).emit(event, payload);
    broadcastRoom(room);
    if (room.matchState === 'ended') {
      await finalizeMatchIfNeeded(room);
      io.to(`room:${room.roomId}`).emit('match:state', matchEndPayload(room));
    }
  };
}

async function beginRoom(room) {
  startMatch(room);
  await persistRoomRecord(room);
  await persistMatchStart(room);
  for (const p of room.players) if (!p.isBot) await persistHumanSession(room, p);
  startBotLoop(room, botLoopEmitter(room));
  const feed = addFeed(room, `${room.mode.toUpperCase()} simulation initialized. All nodes are fictional classroom targets.`, 'start');
  io.to(`room:${room.roomId}`).emit('feed:event', feed);
  io.to(`room:${room.roomId}`).emit('match:state', {
    matchState: room.matchState,
    teamHealth: room.teamHealth,
    startedAt: room.startedAt,
    message: room.mode === 'duel' ? 'DUEL PROTOCOL INITIALIZED' : room.mode === 'teams' ? 'RED TEAM VS BLUE TEAM' : room.mode === 'solo' ? 'TRAINING NODE ONLINE' : 'NETWORK INITIALIZED'
  });
  broadcastRoom(room);
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

    let user;
    if (db.hasDb()) {
      try {
        const q = await db.query(`
          INSERT INTO users(username,password_hash,display_handle)
          VALUES($1,$2,$1)
          RETURNING user_id,username,display_handle,onboarding_completed,account_xp,account_level,created_at
        `, [username, passwordHash]);
        user = q.rows[0];
        await ensureStatsRow(user.user_id);
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Username already exists.' });
        throw err;
      }
    } else {
      const key = username.toLowerCase();
      if (memUsersByName.has(key)) return res.status(409).json({ error: 'Username already exists.' });
      user = {
        id: crypto.randomUUID(), username, password_hash: passwordHash, displayHandle: username,
        onboardingCompleted: false, accountXp: 0, accountLevel: 1, created_at: new Date().toISOString(),
        stats: { matchesPlayed: 0, wins: 0, losses: 0, duelWins: 0, teamWins: 0, botWins: 0, challengesSolved: 0, successfulPatches: 0, successfulAttempts: 0, totalAttempts: 0, bestStreak: 0 },
        achievements: new Set(), history: []
      };
      memUsersByName.set(key, user);
      memUsersById.set(user.id, user);
    }

    const id = user.user_id || user.id;
    const token = makeToken(user);
    const profile = await loadProfile(id);
    return res.status(201).json({ token, user: { id, username: user.username }, profile });
  } catch (err) { next(err); }
});

app.post('/api/auth/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = authSchema.safeParse(req.body);
    if (!parsed.success) return res.status(401).json({ error: 'Invalid credentials.' });
    const { username, password } = parsed.data;
    let user;

    if (db.hasDb()) {
      const q = await db.query('SELECT user_id,username,password_hash FROM users WHERE username=$1', [username]);
      user = q.rows[0];
    } else {
      user = memUsersByName.get(username.toLowerCase());
    }

    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Invalid credentials.' });
    const id = user.user_id || user.id;
    const token = makeToken(user);
    const profile = await loadProfile(id);
    return res.json({ token, user: { id, username: user.username }, profile });
  } catch (err) { next(err); }
});

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const profile = await loadProfile(req.user.sub);
    res.json({ user: { id: req.user.sub, username: req.user.username }, profile });
  } catch (err) { next(err); }
});

app.get('/api/profile', requireAuth, async (req, res, next) => {
  try { res.json({ profile: await loadProfile(req.user.sub) }); }
  catch (err) { next(err); }
});

app.post('/api/profile/onboarding-complete', requireAuth, async (req, res, next) => {
  try {
    await markOnboardingComplete(req.user.sub);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

app.post('/api/profile/handle', requireAuth, async (req, res, next) => {
  try {
    const parsed = z.object({ handle: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/) }).parse(req.body);
    await updateDisplayHandle(req.user.sub, parsed.handle);
    res.json({ ok: true, profile: await loadProfile(req.user.sub) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Handle must be 2–24 letters, numbers, _ or -.' });
    next(err);
  }
});

app.get('/api/rooms/current', requireAuth, async (req, res) => {
  const room = findUserRoom(req.user.sub);
  if (!room) return res.json({ room: null });
  res.json({ room: publicRoom(room), rematchAllowed: canRematch(room, req.user.sub) });
});

const createRoomSchema = z.object({
  roomName: z.string().trim().min(1).max(80),
  handle: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/),
  mode: z.enum(['classic', 'duel', 'teams'])
});

app.post('/api/rooms/create', requireAuth, async (req, res, next) => {
  try {
    const data = createRoomSchema.parse(req.body);
    const profile = await loadProfile(req.user.sub);
    detachUserFromOtherRooms(req.user.sub);
    await updateDisplayHandle(req.user.sub, data.handle);
    const room = createRoom({
      instructorId: req.user.sub,
      roomName: data.roomName,
      mode: data.mode,
      handle: data.handle,
      profile,
      quickMatch: false,
      botMatch: false
    });
    await persistRoomRecord(room);
    await persistHumanSession(room, room.players[0]);
    addFeed(room, `${data.handle} created private ${room.mode.toUpperCase()} match ${room.roomId}.`, 'room');
    res.status(201).json({ room: publicRoom(room), rematchAllowed: true });
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
    if (!room) return res.status(404).json({ error: 'Room not found on this game server.' });
    const profile = await loadProfile(req.user.sub);
    detachUserFromOtherRooms(req.user.sub, room.roomId);
    await updateDisplayHandle(req.user.sub, data.handle);
    const p = joinRoom(room, { userId: req.user.sub, handle: data.handle, profile });
    await persistHumanSession(room, p);
    const feed = addFeed(room, `${p.handle} connected to the arena.`, 'join');
    io.to(`room:${room.roomId}`).emit('feed:event', feed);
    broadcastRoom(room);
    io.to(`room:${room.roomId}`).emit('room:playerJoined', { handle: p.handle });
    res.json({ room: publicRoom(room), rematchAllowed: canRematch(room, req.user.sub) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid room code or handle.' });
    return res.status(400).json({ error: err.message || 'Could not join room.' });
  }
});

app.post('/api/rooms/:code/bots', requireAuth, async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  if (room.instructorId !== req.user.sub || room.quickMatch) return res.status(403).json({ error: 'Private-room instructor only.' });
  if (room.matchState !== 'lobby') return res.status(400).json({ error: 'Add bots before starting the match.' });

  const difficulty = String(req.body?.difficulty || room.botDifficulty).toLowerCase();
  if (!DIFFICULTY[difficulty]) return res.status(400).json({ error: 'Unknown bot difficulty.' });
  const added = addBots(room, Number(req.body?.count || 1), difficulty);
  await persistRoomRecord(room);
  const feed = addFeed(room, `${added} ${difficulty.toUpperCase()} training bot${added === 1 ? '' : 's'} entered the simulation.`, 'bot');
  io.to(`room:${room.roomId}`).emit('feed:event', feed);
  broadcastRoom(room);
  res.json({ ok: true, added, room: publicRoom(room) });
});

app.post('/api/rooms/:code/start', requireAuth, async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  if (room.instructorId !== req.user.sub || room.quickMatch) return res.status(403).json({ error: 'Private-room instructor only.' });
  try {
    await beginRoom(room);
    res.json({ ok: true, message: 'Match started.', room: publicRoom(room) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/rooms/:code/rematch', requireAuth, async (req, res) => {
  const room = getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  if (!canRematch(room, req.user.sub)) return res.status(403).json({ error: 'Rematch is not available for this match.' });
  room.matchId = crypto.randomUUID();
  try {
    await beginRoom(room);
    res.json({ ok: true, room: publicRoom(room) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bots/start', requireAuth, async (req, res, next) => {
  try {
    const parsed = z.object({
      mode: z.enum(['classic', 'duel', 'teams']),
      botCount: z.number().int().min(1).max(7),
      difficulty: z.enum(['rookie', 'standard', 'advanced', 'elite', 'nightmare'])
    }).parse(req.body);

    const profile = await loadProfile(req.user.sub);
    detachUserFromOtherRooms(req.user.sub);
    let count = parsed.botCount;
    if (parsed.mode === 'duel') count = 1;
    if (parsed.mode === 'teams') count = Math.max(3, count);

    const room = createRoom({
      instructorId: req.user.sub,
      roomName: 'AI Training Match',
      mode: parsed.mode,
      handle: profile.displayHandle,
      profile,
      quickMatch: false,
      botMatch: true,
      botDifficulty: parsed.difficulty
    });
    addBots(room, count, parsed.difficulty);
    await persistRoomRecord(room);
    await beginRoom(room);
    res.json({ room: publicRoom(room), rematchAllowed: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid bot-match settings.' });
    next(err);
  }
});

app.post('/api/solo/start', requireAuth, async (req, res, next) => {
  try {
    const parsed = z.object({ difficulty: z.enum(['rookie', 'standard', 'advanced', 'elite', 'nightmare']).default('standard') }).parse(req.body || {});
    const profile = await loadProfile(req.user.sub);
    detachUserFromOtherRooms(req.user.sub);
    const room = createRoom({
      instructorId: req.user.sub,
      roomName: 'Solo Training Protocol',
      mode: 'solo',
      handle: profile.displayHandle,
      profile,
      botMatch: true,
      botDifficulty: parsed.difficulty
    });
    addBots(room, 3, parsed.difficulty);
    await persistRoomRecord(room);
    await beginRoom(room);
    res.json({ room: publicRoom(room), rematchAllowed: true });
  } catch (err) { next(err); }
});

app.post('/api/game/scan', requireAuth, scanLimiter, async (req, res, next) => {
  try {
    const wait = checkCooldown(req.user.sub, 'scan', 1200);
    if (wait) return res.status(429).json({ error: `Scanner cooling down for ${Math.ceil(wait / 1000)}s.` });

    const room = getRoom(req.body?.roomCode);
    if (!room) return res.status(404).json({ error: 'Room not found.' });
    if (room.matchState !== 'running') return res.status(400).json({ error: 'Start the match before scanning.' });

    const attacker = room.players.find(p => p.userId === req.user.sub);
    const target = room.players.find(p => p.userId === req.body?.targetUserId);
    if (!attacker || !target) return res.status(403).json({ error: 'Player is not in this match.' });
    if (attacker.userId === target.userId) return res.status(400).json({ error: 'Select another synthetic node.' });
    if (room.mode === 'teams' && attacker.team === target.team) return res.status(400).json({ error: 'Offensive challenges target the opposing team only.' });

    const category = ['logic', 'sequence', 'decode', 'configuration'].includes(req.body?.category) ? req.body.category : 'logic';
    const challenge = await ensureChallenge(room, attacker, target, category);
    await persistChallenge(room, challenge, target);
    const feed = addFeed(room, `${attacker.handle} scanned synthetic node ${target.nodeId} (${target.handle}).`, 'scan', { actor: attacker.handle, target: target.handle });
    io.to(`room:${room.roomId}`).emit('feed:event', feed);

    res.json({
      target: { userId: target.userId, handle: target.handle, nodeId: target.nodeId },
      challenge: safeChallenge(challenge)
    });
  } catch (err) { next(err); }
});

app.post('/api/exploit/verify', requireAuth, answerLimiter, async (req, res) => {
  const wait = checkCooldown(req.user.sub, 'answer', 500);
  if (wait) return res.status(429).json({ error: 'Answer verifier is processing. Try again in a moment.' });
  const room = getRoom(req.body?.roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const attacker = room.players.find(p => p.userId === req.user.sub);
  if (!attacker) return res.status(403).json({ error: 'Not a combatant in this room.' });

  try {
    const result = verifyChallenge(room, attacker, req.body?.challengeId, req.body?.answer);
    await recordAttempt(room, attacker, result);
    await incrementStats(attacker.userId, {
      totalAttempts: 1,
      successfulAttempts: result.success ? 1 : 0,
      challengesSolved: result.success ? 1 : 0,
      currentStreak: attacker.matchStats.streak,
      bestStreakAbsolute: attacker.matchStats.bestStreak
    });

    let profile = await loadProfile(attacker.userId);
    let achievements = [];
    if (result.success) {
      profile = await addAccountXp(attacker.userId, result.accountXp);
      attacker.accountXp = profile.accountXp;
      attacker.level = profile.accountLevel;
      attacker.rank = profile.rank;
      achievements = await checkProgressAchievements(attacker.userId, { firstAttempt: result.firstAttempt });
      io.to(`user:${attacker.userId}`).emit('progress:update', { profile, levelUp: profile.levelUp || null });
      achievements.forEach(a => io.to(`user:${attacker.userId}`).emit('achievement:unlocked', a));
    }

    const feed = addFeed(
      room,
      result.success
        ? `${attacker.handle} solved a fictional vulnerability puzzle on ${result.target.handle} +${result.xp}XP.`
        : `${attacker.handle} attempted a classroom diagnostic puzzle.`,
      result.success ? 'exploit-success' : 'exploit-failed',
      { actor: attacker.handle, target: result.target.handle, xp: result.xp }
    );

    io.to(`room:${room.roomId}`).emit('feed:event', feed);
    io.to(`room:${room.roomId}`).emit('challenge:resolved', { userId: attacker.userId, success: result.success, message: result.message });
    io.to(`room:${room.roomId}`).emit('shield:update', { userId: result.target.userId, shield: result.target.shield });
    broadcastRoom(room);
    await persistPlayer(room, attacker);
    if (!result.target.isBot) await persistPlayer(room, result.target);
    await logDb(room, attacker.userId, result.target.userId, result.success ? 'exploit-success' : 'exploit-failed', { xp: result.xp, firstAttempt: result.firstAttempt });

    if (room.matchState === 'ended') {
      await finalizeMatchIfNeeded(room);
      io.to(`room:${room.roomId}`).emit('match:state', matchEndPayload(room));
    }

    res.json({
      success: result.success,
      xp: result.xp,
      accountXp: result.accountXp,
      message: result.message,
      levelUp: profile.levelUp || null,
      achievements
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/defense/patch', requireAuth, async (req, res) => {
  const room = getRoom(req.body?.roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const player = room.players.find(p => p.userId === req.user.sub);
  if (!player) return res.status(403).json({ error: 'Not in this room.' });

  try {
    const result = patchPlayer(room, player);
    await incrementStats(player.userId, { successfulPatches: 1 });
    const achievements = await checkProgressAchievements(player.userId);
    achievements.forEach(a => io.to(`user:${player.userId}`).emit('achievement:unlocked', a));
    const feed = addFeed(room, `${player.handle} compiled a defensive patch (-${result.cost}XP, shield ${result.shield}%).`, 'patch', { actor: player.handle });
    io.to(`room:${room.roomId}`).emit('feed:event', feed);
    io.to(`room:${room.roomId}`).emit('shield:update', { userId: player.userId, shield: player.shield });
    io.to(`room:${room.roomId}`).emit('match:state', { matchState: room.matchState, teamHealth: room.teamHealth });
    broadcastRoom(room);
    await persistPlayer(room, player);
    res.json({ ok: true, message: `Patch compiled. Shield restored to ${result.shield}%.`, achievements });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/ai/hint', requireAuth, aiLimiter, async (req, res) => {
  const room = getRoom(req.body?.roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const challenge = [...room.challenges.values()].find(c => c.challengeId === req.body?.challengeId);
  if (!challenge || challenge.attackerId !== req.user.sub) return res.status(404).json({ error: 'Challenge not found.' });
  const profile = await loadProfile(req.user.sub);
  const terminalHistory = Array.isArray(req.body?.terminalHistory) ? req.body.terminalHistory.map(x => String(x).slice(0, 120)).slice(-10) : [];
  const hint = await mentorHint({
    challenge,
    question: String(req.body?.question || 'Help me reason about this challenge.').slice(0, 500),
    attempts: challenge.attempts,
    playerLevel: profile.accountLevel,
    terminalHistory
  });
  res.json({ hint, aiOnline: ZAI_ENABLED });
});

app.post('/api/ai/debrief', requireAuth, aiLimiter, async (req, res) => {
  const room = getRoom(req.body?.roomCode);
  if (!room) return res.status(404).json({ error: 'Room not found.' });
  const challenge = [...room.challenges.values()].find(c => c.challengeId === req.body?.challengeId);
  if (!challenge || challenge.attackerId !== req.user.sub || !challenge.solved) return res.status(404).json({ error: 'Solved challenge not found.' });
  const debrief = await explainConcept({ challenge, attempts: challenge.attempts, success: true });
  res.json({ debrief, aiOnline: ZAI_ENABLED });
});

app.get('/api/matches/history', requireAuth, async (req, res, next) => {
  try {
    const profile = await loadProfile(req.user.sub);
    res.json({ matches: profile.recentMatches });
  } catch (err) { next(err); }
});

app.get('/api/achievements', requireAuth, async (req, res, next) => {
  try {
    const profile = await loadProfile(req.user.sub);
    res.json({ achievements: profile.achievements, catalog: ACHIEVEMENTS });
  } catch (err) { next(err); }
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    rooms: rooms.size,
    database: db.hasDb(),
    aiEnabled: ZAI_ENABLED,
    version: '2.0.0'
  });
});

// ---- Matchmaking ---------------------------------------------------------
const queues = { classic: [], duel: [], teams: [] };
const queueTargets = { classic: 4, duel: 2, teams: 4 };

function cleanQueues() {
  for (const mode of Object.keys(queues)) {
    queues[mode] = queues[mode].filter(entry => io.sockets.sockets.has(entry.socketId));
  }
}

function removeQueuedUser(userId) {
  for (const mode of Object.keys(queues)) queues[mode] = queues[mode].filter(x => x.userId !== userId);
}

function emitQueueStatus(mode) {
  const list = queues[mode];
  const target = queueTargets[mode];
  for (const entry of list) {
    const socket = io.sockets.sockets.get(entry.socketId);
    if (!socket) continue;
    socket.emit('matchmaking:status', {
      mode,
      playersFound: list.length,
      targetPlayers: target,
      waitedMs: Date.now() - entry.joinedAt,
      region: 'Auto'
    });
  }
}

async function createMatchedRoom(entries, mode, fillBots = false, botDifficulty = 'standard') {
  if (!entries.length) return null;
  const first = entries[0];
  detachUserFromOtherRooms(first.userId);
  const room = createRoom({
    instructorId: first.userId,
    roomName: mode === 'duel' ? 'Quick Duel' : mode === 'teams' ? 'Quick Team Battle' : 'Quick Match',
    mode,
    handle: first.handle,
    profile: first.profile,
    quickMatch: true,
    botMatch: fillBots,
    botDifficulty
  });

  for (const entry of entries.slice(1)) {
    detachUserFromOtherRooms(entry.userId);
    addExistingHuman(room, { userId: entry.userId, handle: entry.handle, profile: entry.profile });
  }

  if (fillBots) {
    const needed = Math.max(0, queueTargets[mode] - room.players.length);
    if (needed) addBots(room, needed, botDifficulty);
  }

  await persistRoomRecord(room);
  for (const p of room.players) if (!p.isBot) await persistHumanSession(room, p);

  for (const entry of entries) {
    const socket = io.sockets.sockets.get(entry.socketId);
    if (socket) {
      socket.join(`room:${room.roomId}`);
      socket.data.roomCode = room.roomId;
      socket.emit('matchmaking:found', { room: publicRoom(room), rematchAllowed: false });
    }
  }

  await beginRoom(room);
  return room;
}

async function processQueue(mode) {
  cleanQueues();
  const target = queueTargets[mode];
  while (queues[mode].length >= target) {
    const entries = queues[mode].splice(0, target);
    await createMatchedRoom(entries, mode, false);
  }
  emitQueueStatus(mode);
}

setInterval(() => {
  cleanQueues();
  for (const mode of Object.keys(queues)) {
    emitQueueStatus(mode);
    for (const entry of queues[mode]) {
      if (!entry.botOffered && Date.now() - entry.joinedAt >= 10_000) {
        entry.botOffered = true;
        io.sockets.sockets.get(entry.socketId)?.emit('matchmaking:botOffer', {
          mode,
          humansWaiting: queues[mode].length,
          botsNeeded: Math.max(0, queueTargets[mode] - queues[mode].length)
        });
      }
    }
  }
}, 1000).unref();

// ---- Socket authentication / realtime ----------------------------------
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

io.on('connection', async socket => {
  const userId = socket.data.user.sub;
  socket.join(`user:${userId}`);

  const current = findUserRoom(userId);
  if (current) {
    const player = current.players.find(p => p.userId === userId);
    if (player) {
      player.online = true;
      socket.join(`room:${current.roomId}`);
      socket.data.roomCode = current.roomId;
      socket.emit('room:state', publicRoom(current));
      socket.emit('leaderboard:update', publicRoom(current).players.slice().sort((a, b) => b.xp - a.xp));
    }
  }

  socket.on('room:join', ({ roomCode }) => {
    const room = getRoom(roomCode);
    if (!room) return;
    const player = room.players.find(p => p.userId === userId);
    if (!player) return;
    socket.join(`room:${room.roomId}`);
    socket.data.roomCode = room.roomId;
    player.online = true;
    socket.emit('room:state', publicRoom(room));
    socket.emit('leaderboard:update', publicRoom(room).players.slice().sort((a, b) => b.xp - a.xp));
    room.feed.slice().reverse().forEach(item => socket.emit('feed:event', item));
  });

  socket.on('matchmaking:join', async payload => {
    try {
      const mode = ['classic', 'duel', 'teams'].includes(payload?.mode) ? payload.mode : 'classic';
      const profile = await loadProfile(userId);
      const handle = String(payload?.handle || profile.displayHandle || socket.data.user.username).trim();
      if (!/^[A-Za-z0-9_-]{2,24}$/.test(handle)) return socket.emit('matchmaking:error', { error: 'Choose a valid 2–24 character handle.' });
      await updateDisplayHandle(userId, handle);
      removeQueuedUser(userId);
      queues[mode].push({ socketId: socket.id, userId, handle, profile, joinedAt: Date.now(), botOffered: false });
      emitQueueStatus(mode);
      await processQueue(mode);
    } catch (err) {
      socket.emit('matchmaking:error', { error: err.message || 'Could not join matchmaking.' });
    }
  });

  socket.on('matchmaking:leave', () => {
    removeQueuedUser(userId);
    socket.emit('matchmaking:cancelled', { ok: true });
    for (const mode of Object.keys(queues)) emitQueueStatus(mode);
  });

  socket.on('matchmaking:acceptBot', async payload => {
    try {
      const mode = ['classic', 'duel', 'teams'].includes(payload?.mode) ? payload.mode : 'classic';
      const queue = queues[mode];
      const mine = queue.find(x => x.userId === userId);
      if (!mine) return socket.emit('matchmaking:error', { error: 'You are no longer in this queue.' });
      const target = queueTargets[mode];
      const entries = queue.slice(0, target);
      if (!entries.some(x => x.userId === userId)) entries[entries.length - 1] = mine;
      const ids = new Set(entries.map(x => x.userId));
      queues[mode] = queue.filter(x => !ids.has(x.userId));
      const difficulty = DIFFICULTY[payload?.difficulty] ? payload.difficulty : 'standard';
      await createMatchedRoom(entries, mode, true, difficulty);
      emitQueueStatus(mode);
    } catch (err) {
      socket.emit('matchmaking:error', { error: err.message || 'Could not create bot-filled match.' });
    }
  });

  socket.on('disconnect', () => {
    removeQueuedUser(userId);
    for (const mode of Object.keys(queues)) emitQueueStatus(mode);
    const room = findUserRoom(userId);
    if (!room) return;
    const p = room.players.find(x => x.userId === userId);
    if (p) {
      p.online = false;
      const feed = addFeed(room, `${p.handle} connection interrupted.`, 'leave');
      io.to(`room:${room.roomId}`).emit('feed:event', feed);
      io.to(`room:${room.roomId}`).emit('room:playerLeft', { handle: p.handle });
      broadcastRoom(room);
    }
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err?.message === 'Origin not allowed') return res.status(403).json({ error: 'Origin not allowed.' });
  res.status(500).json({ error: 'Internal server error.' });
});

db.initDb()
  .then(() => server.listen(PORT, () => {
    console.log(`Cyber Arena v2 server listening on ${PORT}`);
    console.log(`Database: ${db.hasDb() ? 'enabled' : 'demo-memory'}`);
    console.log(`AI enabled: ${ZAI_ENABLED}`);
  }))
  .catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
