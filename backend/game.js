const crypto = require('crypto');
const { botDecision, generateChallenge } = require('./ai');

const rooms = new Map();
const botTimers = new Map();

const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HANDLES = ['CipherFox', 'ByteKnight', 'NovaTrace', 'KernelKid', 'HexGhost', 'PacketPanda', 'NullVector', 'LogHawk', 'EchoRoot', 'BitRaven'];

function roomCode() {
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) code += ROOM_CHARS[bytes[i] % ROOM_CHARS.length];
  return code;
}

function nodeId() {
  return `NODE-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function publicPlayer(p) {
  return {
    userId: p.userId,
    handle: p.handle,
    nodeId: p.nodeId,
    xp: p.xp,
    level: p.level,
    shield: p.shield,
    online: p.online,
    team: p.team || null,
    isBot: Boolean(p.isBot)
  };
}

function publicRoom(room) {
  return {
    roomId: room.roomId,
    roomName: room.roomName,
    instructorId: room.instructorId,
    mode: room.mode,
    matchState: room.matchState,
    teamHealth: room.teamHealth,
    players: room.players.map(publicPlayer)
  };
}

function makeHuman({ userId, handle }) {
  return {
    userId,
    handle,
    nodeId: nodeId(),
    xp: 0,
    level: 1,
    shield: 100,
    online: true,
    isBot: false,
    team: null,
    attempts: 0
  };
}

function makeBot(index = 0) {
  return {
    userId: `bot-${crypto.randomUUID()}`,
    handle: `${HANDLES[index % HANDLES.length]}${crypto.randomInt(10, 99)}`,
    nodeId: nodeId(),
    xp: 0,
    level: 1 + crypto.randomInt(0, 4),
    shield: 100,
    online: true,
    isBot: true,
    team: null,
    attempts: 0,
    nextThinkAt: Date.now() + crypto.randomInt(1800, 5000)
  };
}

function assignTeams(room) {
  if (room.mode !== 'teams') {
    room.players.forEach(p => p.team = null);
    return;
  }
  let red = 0, blue = 0;
  for (const p of room.players) {
    if (red <= blue) { p.team = 'red'; red++; }
    else { p.team = 'blue'; blue++; }
  }
}

function createRoom({ instructorId, roomName, mode, handle }) {
  let code;
  do code = roomCode(); while (rooms.has(code));

  const room = {
    roomId: code,
    roomName,
    instructorId,
    mode: ['classic', 'duel', 'teams'].includes(mode) ? mode : 'classic',
    matchState: 'lobby',
    players: [makeHuman({ userId: instructorId, handle })],
    teamHealth: { red: 100, blue: 100 },
    feed: [],
    challenges: new Map(),
    createdAt: Date.now(),
    winner: null
  };

  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase()) || null;
}

function joinRoom(room, { userId, handle }) {
  if (room.matchState === 'ended') throw new Error('This match has ended.');
  const existing = room.players.find(p => p.userId === userId);
  if (existing) {
    existing.online = true;
    existing.handle = handle;
    return existing;
  }

  if (room.mode === 'duel' && room.players.length >= 2) {
    throw new Error('Duel rooms support two combatants.');
  }

  if (room.players.some(p => p.handle.toLowerCase() === handle.toLowerCase())) {
    throw new Error('That handle is already used in this room.');
  }

  const p = makeHuman({ userId, handle });
  room.players.push(p);
  assignTeams(room);
  return p;
}

function addBots(room, count) {
  const max = room.mode === 'duel' ? 2 : 16;
  const allowed = Math.max(0, max - room.players.length);
  const adding = Math.min(Math.max(1, Number(count) || 1), allowed);
  for (let i = 0; i < adding; i++) room.players.push(makeBot(i + room.players.length));
  assignTeams(room);
  return adding;
}

function startMatch(room) {
  if (room.mode === 'duel' && room.players.length !== 2) throw new Error('A duel needs exactly two combatants.');
  if (room.mode === 'teams' && room.players.length < 4) throw new Error('Team vs Team needs at least four combatants.');
  if (room.mode === 'classic' && room.players.length < 2) throw new Error('Add at least one classmate or bot.');

  room.matchState = 'running';
  room.winner = null;
  room.teamHealth = { red: 100, blue: 100 };
  room.players.forEach(p => {
    p.shield = 100;
    p.xp = 0;
    p.level = 1;
    p.attempts = 0;
  });
  assignTeams(room);
}

function awardXp(player, xp) {
  player.xp += xp;
  player.level = 1 + Math.floor(player.xp / 300);
}

function damageTarget(room, attacker, target, amount = 20) {
  if (room.mode === 'classic') return { damage: 0 };

  if (room.mode === 'teams') {
    if (!attacker.team || attacker.team === target.team) throw new Error('Choose an opposing team member.');
    const enemyTeam = target.team;
    room.teamHealth[enemyTeam] = Math.max(0, room.teamHealth[enemyTeam] - amount);
    if (room.teamHealth[enemyTeam] <= 0) {
      room.matchState = 'ended';
      room.winner = attacker.team;
    }
    return { damage: amount, team: enemyTeam };
  }

  target.shield = Math.max(0, target.shield - amount);
  if (target.shield <= 0) {
    room.matchState = 'ended';
    room.winner = attacker.userId;
  }
  return { damage: amount };
}

function patchPlayer(room, player) {
  const cost = 50;
  if (player.shield >= 100) throw new Error('Shield is already at full integrity.');
  if (player.xp < cost) throw new Error(`You need ${cost} XP to compile a patch.`);

  player.xp -= cost;
  player.shield = Math.min(100, player.shield + 25);

  if (room.mode === 'teams' && player.team) {
    room.teamHealth[player.team] = Math.min(100, room.teamHealth[player.team] + 5);
  }

  return { shield: player.shield, cost };
}

function addFeed(room, message, type = 'info') {
  const item = { id: crypto.randomUUID(), at: Date.now(), message, type };
  room.feed.unshift(item);
  room.feed = room.feed.slice(0, 100);
  return item;
}

async function ensureChallenge(room, attacker, target) {
  const key = `${attacker.userId}:${target.userId}`;
  const existing = room.challenges.get(key);
  if (existing && !existing.solved) return existing;

  const generated = await generateChallenge({
    targetHandle: target.handle,
    level: Math.max(attacker.level, target.level)
  });

  const challenge = {
    challengeId: crypto.randomUUID(),
    attackerId: attacker.userId,
    targetId: target.userId,
    ...generated,
    solved: false,
    attempts: 0
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
  const challenge = [...room.challenges.values()].find(c => c.challengeId === challengeId);
  if (!challenge || challenge.attackerId !== attacker.userId) throw new Error('Unknown or expired challenge.');
  if (challenge.solved) throw new Error('Challenge already completed.');

  const target = room.players.find(p => p.userId === challenge.targetId);
  if (!target) throw new Error('Target left the room.');

  challenge.attempts++;
  attacker.attempts++;

  const success = normalizeAnswer(answer) === normalizeAnswer(challenge.canonicalAnswer);
  if (!success) {
    return { success: false, xp: 0, target, challenge, message: 'Simulator rejected the answer. Re-check the puzzle logic.' };
  }

  challenge.solved = true;
  const xp = 100 + Math.min(150, target.level * 20);
  awardXp(attacker, xp);
  const impact = damageTarget(room, attacker, target, room.mode === 'duel' ? 25 : 14);

  return {
    success: true,
    xp,
    target,
    challenge,
    impact,
    message: room.mode === 'classic'
      ? `Challenge solved. +${xp} XP.`
      : `Challenge solved against ${target.handle}. +${xp} XP${impact.damage ? `, ${impact.damage} shield impact` : ''}.`
  };
}

function botTarget(room, bot) {
  let candidates = room.players.filter(p => p.userId !== bot.userId && p.shield > 0);
  if (room.mode === 'teams') candidates = candidates.filter(p => p.team !== bot.team);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.shield - b.shield || b.xp - a.xp);
  return candidates[0];
}

async function botTick(room, emit) {
  if (room.matchState !== 'running') return;

  const now = Date.now();
  const bots = room.players.filter(p => p.isBot && p.shield > 0);

  for (const bot of bots) {
    if (now < bot.nextThinkAt) continue;
    bot.nextThinkAt = now + crypto.randomInt(4500, 9000);

    const peers = room.players.filter(p => p.userId !== bot.userId);
    const ai = await botDecision({ mode: room.mode, bot, peers, room });
    let target = peers.find(p => p.handle === ai.targetHandle);
    if (!target || target.shield <= 0 || (room.mode === 'teams' && target.team === bot.team)) {
      target = botTarget(room, bot);
    }

    if (bot.shield <= 45 && bot.xp >= 50 && Math.random() < 0.55) {
      try {
        const patched = patchPlayer(room, bot);
        const feed = addFeed(room, `${bot.handle} [BOT] compiled a defensive patch and restored its shield.`, 'patch');
        emit('feed:event', feed);
        emit('shield:update', { userId: bot.userId, shield: patched.shield });
        continue;
      } catch {}
    }

    if (!target) continue;

    // Bots solve synthetic puzzles probabilistically. They never execute commands or know real systems.
    const successChance = Math.min(0.86, 0.42 + bot.level * 0.07);
    const success = Math.random() < successChance;

    if (ai.say) {
      const feed = addFeed(room, `${bot.handle} [BOT]: ${String(ai.say).slice(0, 120)}`, 'bot');
      emit('feed:event', feed);
    }

    if (success) {
      const xp = 80 + bot.level * 15;
      awardXp(bot, xp);
      let impact = { damage: 0 };
      try { impact = damageTarget(room, bot, target, room.mode === 'duel' ? 20 : 10); } catch {}
      const feed = addFeed(
        room,
        `${bot.handle} [BOT] solved a fictional diagnostic challenge on ${target.handle} +${xp}XP${impact.damage ? ` / ${impact.damage} shield impact` : ''}.`,
        'bot-success'
      );
      emit('feed:event', feed);
      emit('shield:update', { userId: target.userId, shield: target.shield });
    } else {
      const feed = addFeed(room, `${bot.handle} [BOT] failed a synthetic challenge against ${target.handle}.`, 'bot-fail');
      emit('feed:event', feed);
    }

    if (room.matchState === 'ended') {
      emit('match:state', {
        matchState: room.matchState,
        teamHealth: room.teamHealth,
        message: room.mode === 'teams'
          ? `${String(room.winner).toUpperCase()} TEAM wins the simulation.`
          : `${room.players.find(p => p.userId === room.winner)?.handle || 'A combatant'} wins the duel.`
      });
      break;
    }
  }
}

function startBotLoop(room, emit) {
  stopBotLoop(room.roomId);
  const timer = setInterval(() => botTick(room, emit).catch(err => console.warn('[bot]', err.message)), 1800);
  botTimers.set(room.roomId, timer);
}

function stopBotLoop(roomId) {
  const timer = botTimers.get(roomId);
  if (timer) clearInterval(timer);
  botTimers.delete(roomId);
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  joinRoom,
  addBots,
  startMatch,
  publicRoom,
  publicPlayer,
  awardXp,
  patchPlayer,
  addFeed,
  ensureChallenge,
  safeChallenge,
  verifyChallenge,
  startBotLoop,
  stopBotLoop
};
