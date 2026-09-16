'use strict';

const crypto = require('crypto');
const { botDecision, generateChallenge } = require('./ai');

const rooms = new Map();
const botTimers = new Map();

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const BOT_HANDLES = ['CipherFox', 'ByteKnight', 'NovaTrace', 'KernelKid', 'HexGhost', 'PacketPanda', 'NullVector', 'LogHawk', 'EchoRoot', 'BitRaven'];
const PERSONALITIES = ['Analyst', 'Hunter', 'Guardian', 'Chaos Agent', 'Strategist', 'Rookie'];
const DIFFICULTY = {
  rookie: { success: 0.38, minThink: 7200, maxThink: 12000, patchChance: 0.30, levelBoost: 0 },
  standard: { success: 0.54, minThink: 6000, maxThink: 10000, patchChance: 0.42, levelBoost: 1 },
  advanced: { success: 0.66, minThink: 5000, maxThink: 8500, patchChance: 0.50, levelBoost: 3 },
  elite: { success: 0.76, minThink: 4200, maxThink: 7200, patchChance: 0.62, levelBoost: 6 },
  nightmare: { success: 0.84, minThink: 3400, maxThink: 6200, patchChance: 0.70, levelBoost: 10 }
};

const CLASSIC_SCORE_TARGET = 600;
const SOLO_SOLVE_TARGET = 3;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function roomCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += ROOM_CHARS[bytes[i] % ROOM_CHARS.length];
  return code;
}

function nodeId() {
  return `NODE-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function normalizeDifficulty(value) {
  const key = String(value || 'standard').toLowerCase();
  return DIFFICULTY[key] ? key : 'standard';
}

function rankTitle(level) {
  const n = Math.max(1, Number(level) || 1);
  if (n >= 50) return 'GHOST PROTOCOL';
  if (n >= 40) return 'CYBER COMMANDER';
  if (n >= 30) return 'SECURITY ARCHITECT';
  if (n >= 20) return 'RED TEAM OPERATOR';
  if (n >= 15) return 'THREAT HUNTER';
  if (n >= 10) return 'CYBER ANALYST';
  if (n >= 5) return 'PACKET SCOUT';
  return 'SCRIPT KIDDIE';
}

function publicPlayer(p) {
  return {
    userId: p.userId,
    handle: p.handle,
    nodeId: p.nodeId,
    xp: p.xp,
    matchXp: p.xp,
    level: p.level,
    accountLevel: p.level,
    accountXp: p.accountXp || 0,
    rank: p.rank || rankTitle(p.level),
    shield: p.shield,
    online: p.online,
    team: p.team || null,
    isBot: Boolean(p.isBot),
    personality: p.isBot ? p.personality : null,
    difficulty: p.isBot ? p.difficulty : null,
    streak: p.matchStats?.streak || 0
  };
}

function publicRoom(room) {
  return {
    roomId: room.roomId,
    roomName: room.roomName,
    instructorId: room.instructorId,
    mode: room.mode,
    matchState: room.matchState,
    quickMatch: Boolean(room.quickMatch),
    botMatch: Boolean(room.botMatch),
    solo: room.mode === 'solo',
    botDifficulty: room.botDifficulty,
    teamHealth: room.teamHealth,
    players: room.players.map(publicPlayer),
    startedAt: room.startedAt,
    endedAt: room.endedAt,
    winner: room.winner,
    goal: room.mode === 'classic' ? CLASSIC_SCORE_TARGET : room.mode === 'solo' ? SOLO_SOLVE_TARGET : null,
    matchId: room.matchId
  };
}

function makeHuman({ userId, handle, profile = {} }) {
  const level = Math.max(1, Number(profile.accountLevel || profile.account_level || 1));
  return {
    userId,
    handle,
    nodeId: nodeId(),
    xp: 0,
    accountXp: Number(profile.accountXp || profile.account_xp || 0),
    level,
    rank: profile.rank || rankTitle(level),
    shield: 100,
    online: true,
    isBot: false,
    team: null,
    matchStats: { solved: 0, attempts: 0, patches: 0, streak: 0, bestStreak: 0 },
    joinedAt: Date.now()
  };
}

function makeBot(index = 0, difficulty = 'standard') {
  const diff = normalizeDifficulty(difficulty);
  const cfg = DIFFICULTY[diff];
  const level = 1 + cfg.levelBoost + crypto.randomInt(0, 4);
  return {
    userId: `bot-${crypto.randomUUID()}`,
    handle: `${BOT_HANDLES[index % BOT_HANDLES.length]}${crypto.randomInt(10, 99)}`,
    nodeId: nodeId(),
    xp: 0,
    accountXp: 0,
    level,
    rank: rankTitle(level),
    shield: 100,
    online: true,
    isBot: true,
    team: null,
    personality: PERSONALITIES[index % PERSONALITIES.length],
    difficulty: diff,
    nextThinkAt: Date.now() + crypto.randomInt(cfg.minThink, cfg.maxThink + 1),
    matchStats: { solved: 0, attempts: 0, patches: 0, streak: 0, bestStreak: 0 },
    joinedAt: Date.now()
  };
}

function assignTeams(room) {
  if (room.mode !== 'teams') {
    room.players.forEach(p => { p.team = null; });
    return;
  }

  const ordered = room.players.slice().sort((a, b) => b.level - a.level || b.accountXp - a.accountXp);
  let redPower = 0;
  let bluePower = 0;
  for (const p of ordered) {
    if (redPower <= bluePower) {
      p.team = 'red';
      redPower += p.level + p.accountXp / 1000;
    } else {
      p.team = 'blue';
      bluePower += p.level + p.accountXp / 1000;
    }
  }
}

function createRoom({
  instructorId,
  roomName,
  mode = 'classic',
  handle,
  profile = {},
  quickMatch = false,
  botMatch = false,
  botDifficulty = 'standard'
}) {
  let code;
  do code = roomCode(); while (rooms.has(code));

  const safeMode = ['classic', 'duel', 'teams', 'solo'].includes(mode) ? mode : 'classic';
  const room = {
    roomId: code,
    roomName: String(roomName || 'Cyber Arena').slice(0, 80),
    instructorId,
    mode: safeMode,
    matchState: 'lobby',
    quickMatch: Boolean(quickMatch),
    botMatch: Boolean(botMatch),
    botDifficulty: normalizeDifficulty(botDifficulty),
    teamHealth: { red: 100, blue: 100 },
    players: [makeHuman({ userId: instructorId, handle, profile })],
    feed: [],
    challenges: new Map(),
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    winner: null,
    matchId: crypto.randomUUID(),
    finalized: false
  };

  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase()) || null;
}

function findUserRoom(userId) {
  for (const room of rooms.values()) {
    const p = room.players.find(x => x.userId === userId);
    if (p) return room;
  }
  return null;
}

function joinRoom(room, { userId, handle, profile = {} }) {
  if (room.matchState === 'ended') throw new Error('This match has ended.');
  const existing = room.players.find(p => p.userId === userId);
  if (existing) {
    existing.online = true;
    existing.handle = handle || existing.handle;
    return existing;
  }

  if (room.mode === 'duel' && room.players.length >= 2) throw new Error('Duel rooms support two combatants.');
  if (room.players.length >= 16) throw new Error('This room is full.');
  if (room.players.some(p => p.handle.toLowerCase() === String(handle).toLowerCase())) throw new Error('That handle is already used in this room.');

  const player = makeHuman({ userId, handle, profile });
  room.players.push(player);
  assignTeams(room);
  return player;
}

function addExistingHuman(room, { userId, handle, profile = {} }) {
  if (room.players.some(p => p.userId === userId)) return room.players.find(p => p.userId === userId);
  const player = makeHuman({ userId, handle, profile });
  room.players.push(player);
  assignTeams(room);
  return player;
}

function addBots(room, count, difficulty = room.botDifficulty) {
  const max = room.mode === 'duel' ? 2 : 16;
  const allowed = Math.max(0, max - room.players.length);
  const adding = Math.min(Math.max(1, Number(count) || 1), allowed);
  const diff = normalizeDifficulty(difficulty);
  room.botDifficulty = diff;
  for (let i = 0; i < adding; i++) room.players.push(makeBot(i + room.players.length, diff));
  assignTeams(room);
  return adding;
}

function startMatch(room) {
  if (room.mode === 'duel' && room.players.length !== 2) throw new Error('A duel needs exactly two combatants.');
  if (room.mode === 'teams' && room.players.length < 4) throw new Error('Team vs Team needs at least four combatants.');
  if (room.mode === 'classic' && room.players.length < 2) throw new Error('Add at least one classmate or bot.');
  if (room.mode === 'solo' && room.players.length < 2) throw new Error('Training needs at least one simulated training node.');

  room.matchState = 'running';
  room.startedAt = Date.now();
  room.endedAt = null;
  room.winner = null;
  room.finalized = false;
  room.teamHealth = { red: 100, blue: 100 };
  room.challenges.clear();

  room.players.forEach(p => {
    p.shield = 100;
    p.xp = 0;
    p.matchStats = { solved: 0, attempts: 0, patches: 0, streak: 0, bestStreak: 0 };
  });
  assignTeams(room);
  return room;
}

function awardMatchXp(player, xp) {
  player.xp += Math.max(0, Number(xp) || 0);
}

function endRoom(room, winner) {
  if (room.matchState === 'ended') return;
  room.matchState = 'ended';
  room.endedAt = Date.now();
  room.winner = winner;
}

function damageTarget(room, attacker, target, amount = 20) {
  if (room.mode === 'classic' || room.mode === 'solo') return { damage: 0 };

  if (room.mode === 'teams') {
    if (!attacker.team || attacker.team === target.team) throw new Error('Choose an opposing team member.');
    const enemyTeam = target.team;
    room.teamHealth[enemyTeam] = Math.max(0, room.teamHealth[enemyTeam] - amount);
    target.shield = Math.max(0, target.shield - Math.ceil(amount * 0.35));
    if (room.teamHealth[enemyTeam] <= 0) endRoom(room, attacker.team);
    return { damage: amount, team: enemyTeam };
  }

  target.shield = Math.max(0, target.shield - amount);
  if (target.shield <= 0) endRoom(room, attacker.userId);
  return { damage: amount };
}

function patchPlayer(room, player) {
  const cost = 50;
  if (room.matchState !== 'running') throw new Error('Patching is available during a running match.');
  if (player.shield >= 100 && room.mode !== 'teams') throw new Error('Shield is already at full integrity.');
  if (player.xp < cost) throw new Error(`You need ${cost} match XP to compile a patch.`);

  player.xp -= cost;
  player.shield = Math.min(100, player.shield + 25);
  player.matchStats.patches += 1;

  if (room.mode === 'teams' && player.team) {
    room.teamHealth[player.team] = Math.min(100, room.teamHealth[player.team] + 8);
  }

  return { shield: player.shield, cost, teamHealth: room.teamHealth };
}

function addFeed(room, message, type = 'info', meta = {}) {
  const item = {
    id: crypto.randomUUID(),
    at: Date.now(),
    message: String(message).slice(0, 500),
    type,
    ...meta
  };
  room.feed.unshift(item);
  room.feed = room.feed.slice(0, 100);
  return item;
}

async function ensureChallenge(room, attacker, target, category = 'logic') {
  const key = `${attacker.userId}:${target.userId}`;
  const existing = room.challenges.get(key);
  if (existing && !existing.solved) return existing;

  const generated = await generateChallenge({
    targetHandle: target.handle,
    level: Math.max(attacker.level, target.level),
    category
  });

  const challenge = {
    challengeId: crypto.randomUUID(),
    attackerId: attacker.userId,
    targetId: target.userId,
    ...generated,
    solved: false,
    attempts: 0,
    createdAt: Date.now()
  };

  room.challenges.set(key, challenge);
  return challenge;
}

function safeChallenge(c) {
  return {
    challengeId: c.challengeId,
    displayName: c.displayName,
    mockPort: c.mockPort,
    fictionalService: c.fictionalService,
    mockVersion: c.mockVersion,
    description: c.description,
    safetyHint: c.safetyHint,
    challengeType: c.challengeType,
    challengePrompt: c.challengePrompt
  };
}

function normalizeAnswer(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function verifyChallenge(room, attacker, challengeId, answer) {
  if (room.matchState !== 'running') throw new Error('The match is not running.');
  const challenge = [...room.challenges.values()].find(c => c.challengeId === challengeId);
  if (!challenge || challenge.attackerId !== attacker.userId) throw new Error('Unknown or expired challenge.');
  if (challenge.solved) throw new Error('Challenge already completed.');

  const target = room.players.find(p => p.userId === challenge.targetId);
  if (!target) throw new Error('Target left the match.');
  if (room.mode === 'teams' && attacker.team === target.team) throw new Error('You cannot challenge your own team.');

  challenge.attempts += 1;
  attacker.matchStats.attempts += 1;

  const success = normalizeAnswer(answer) === normalizeAnswer(challenge.canonicalAnswer);
  if (!success) {
    attacker.matchStats.streak = 0;
    return {
      success: false,
      xp: 0,
      accountXp: 0,
      target,
      challenge,
      firstAttempt: false,
      message: 'Simulator rejected the answer. Re-check the puzzle logic.'
    };
  }

  challenge.solved = true;
  attacker.matchStats.solved += 1;
  attacker.matchStats.streak += 1;
  attacker.matchStats.bestStreak = Math.max(attacker.matchStats.bestStreak, attacker.matchStats.streak);

  const firstAttempt = challenge.attempts === 1;
  const xp = 100 + Math.min(180, target.level * 20) + (firstAttempt ? 30 : 0);
  const accountXp = Math.floor(xp * 0.75);
  awardMatchXp(attacker, xp);

  const impact = damageTarget(room, attacker, target, room.mode === 'duel' ? 25 : 14);

  if (room.mode === 'classic' && attacker.xp >= CLASSIC_SCORE_TARGET) endRoom(room, attacker.userId);
  if (room.mode === 'solo' && attacker.matchStats.solved >= SOLO_SOLVE_TARGET) endRoom(room, attacker.userId);

  return {
    success: true,
    xp,
    accountXp,
    target,
    challenge,
    impact,
    firstAttempt,
    message: room.mode === 'classic' || room.mode === 'solo'
      ? `Challenge solved. +${xp} match XP.`
      : `Challenge solved against ${target.handle}. +${xp} match XP${impact.damage ? `, ${impact.damage} integrity impact` : ''}.`
  };
}

function botTarget(room, bot) {
  let candidates = room.players.filter(p => p.userId !== bot.userId && p.shield > 0);
  if (room.mode === 'teams') candidates = candidates.filter(p => p.team !== bot.team);
  if (room.mode === 'solo') candidates = candidates.filter(p => !p.isBot);
  if (!candidates.length) return null;

  if (bot.personality === 'Hunter') candidates.sort((a, b) => a.shield - b.shield || b.xp - a.xp);
  else if (bot.personality === 'Strategist') candidates.sort((a, b) => b.xp - a.xp || a.shield - b.shield);
  else candidates.sort((a, b) => a.shield - b.shield || a.level - b.level);
  return candidates[0];
}

function botSuccessChance(bot) {
  const cfg = DIFFICULTY[normalizeDifficulty(bot.difficulty)];
  let chance = cfg.success;
  if (bot.personality === 'Analyst') chance += 0.05;
  if (bot.personality === 'Rookie') chance -= 0.08;
  if (bot.personality === 'Chaos Agent') chance += (Math.random() - 0.5) * 0.18;
  return clamp(chance, 0.2, 0.92);
}

async function botTick(room, emit) {
  if (room.matchState !== 'running') return;

  const now = Date.now();
  const bots = room.players.filter(p => p.isBot && p.shield > 0);

  for (const bot of bots) {
    const cfg = DIFFICULTY[normalizeDifficulty(bot.difficulty)];
    if (now < bot.nextThinkAt) continue;
    bot.nextThinkAt = now + crypto.randomInt(cfg.minThink, cfg.maxThink + 1);

    const peers = room.players.filter(p => p.userId !== bot.userId);
    const ai = await botDecision({ mode: room.mode, bot, peers, room });
    let target = peers.find(p => p.handle === ai.targetHandle);
    if (!target || target.shield <= 0 || (room.mode === 'teams' && target.team === bot.team)) target = botTarget(room, bot);

    const shouldPatch = bot.shield <= 50 && bot.xp >= 50 && (ai.action === 'patch' || Math.random() < cfg.patchChance);
    if (shouldPatch) {
      try {
        const patched = patchPlayer(room, bot);
        emit('feed:event', addFeed(room, `${bot.handle} [BOT] compiled a defensive patch.`, 'patch', { actor: bot.handle }));
        emit('shield:update', { userId: bot.userId, shield: patched.shield });
        continue;
      } catch {}
    }

    if (!target) continue;

    if (ai.say && Math.random() < 0.55) {
      emit('feed:event', addFeed(room, `${bot.handle} [BOT]: ${ai.say}`, 'bot-chat', { actor: bot.handle }));
    }

    bot.matchStats.attempts += 1;
    const success = Math.random() < botSuccessChance(bot);

    if (success) {
      bot.matchStats.solved += 1;
      bot.matchStats.streak += 1;
      bot.matchStats.bestStreak = Math.max(bot.matchStats.bestStreak, bot.matchStats.streak);
      const xp = 80 + bot.level * 15;
      awardMatchXp(bot, xp);
      let impact = { damage: 0 };
      try { impact = damageTarget(room, bot, target, room.mode === 'duel' ? 20 : 10); } catch {}
      emit('feed:event', addFeed(
        room,
        `${bot.handle} [BOT] solved a synthetic diagnostic challenge on ${target.handle} +${xp}XP${impact.damage ? ` / ${impact.damage} integrity impact` : ''}.`,
        'bot-success',
        { actor: bot.handle, target: target.handle, xp }
      ));
      emit('shield:update', { userId: target.userId, shield: target.shield });

      if (room.mode === 'classic' && bot.xp >= CLASSIC_SCORE_TARGET) endRoom(room, bot.userId);
    } else {
      bot.matchStats.streak = 0;
      emit('feed:event', addFeed(room, `${bot.handle} [BOT] failed a synthetic challenge against ${target.handle}.`, 'bot-fail', { actor: bot.handle, target: target.handle }));
    }

    if (room.matchState === 'ended') {
      emit('match:state', matchEndPayload(room));
      break;
    }
  }
}

function matchEndPayload(room) {
  let message = 'MATCH COMPLETE';
  if (room.mode === 'teams') message = `${String(room.winner).toUpperCase()} TEAM WINS`;
  else if (room.winner) {
    const winner = room.players.find(p => p.userId === room.winner);
    message = `${winner?.handle || 'OPERATOR'} WINS`;
  }

  return {
    matchState: room.matchState,
    teamHealth: room.teamHealth,
    winner: room.winner,
    message,
    results: room.players.map(p => ({
      ...publicPlayer(p),
      solved: p.matchStats.solved,
      attempts: p.matchStats.attempts,
      accuracy: p.matchStats.attempts ? Math.round((p.matchStats.solved / p.matchStats.attempts) * 100) : 0,
      patches: p.matchStats.patches
    }))
  };
}

function startBotLoop(room, emit) {
  stopBotLoop(room.roomId);
  if (!room.players.some(p => p.isBot)) return;
  const timer = setInterval(() => botTick(room, emit).catch(err => console.warn('[bot]', err.message)), 1500);
  botTimers.set(room.roomId, timer);
}

function stopBotLoop(roomId) {
  const timer = botTimers.get(roomId);
  if (timer) clearInterval(timer);
  botTimers.delete(roomId);
}

function canRematch(room, userId) {
  return room.botMatch || (!room.quickMatch && room.instructorId === userId);
}

module.exports = {
  rooms,
  DIFFICULTY,
  CLASSIC_SCORE_TARGET,
  SOLO_SOLVE_TARGET,
  rankTitle,
  createRoom,
  getRoom,
  findUserRoom,
  joinRoom,
  addExistingHuman,
  addBots,
  startMatch,
  publicRoom,
  publicPlayer,
  patchPlayer,
  addFeed,
  ensureChallenge,
  safeChallenge,
  verifyChallenge,
  startBotLoop,
  stopBotLoop,
  matchEndPayload,
  canRematch,
  assignTeams
};
