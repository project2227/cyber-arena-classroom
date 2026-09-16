const crypto = require('crypto');

const ZAI_ENABLED = String(process.env.ZAI_ENABLED || 'false').toLowerCase() === 'true';
const ZAI_API_KEY = process.env.ZAI_API_KEY || '';
const ZAI_BASE_URL = (process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4').replace(/\/$/, '');
const ZAI_MODEL = process.env.ZAI_MODEL || 'glm-5.2';

function fallbackChallenge({ targetHandle, level = 1 }) {
  const n = crypto.randomInt(10, 99);
  const port = 20000 + crypto.randomInt(1000, 35000);
  const answer = String((n * 7 + level * 13) % 997).padStart(3, '0');

  return {
    displayName: `Orion Relay Integrity Puzzle`,
    mockPort: port,
    fictionalService: 'OrionRelay-Lab',
    mockVersion: `v${2 + level}.Lab`,
    description: `A fictional classroom service on ${targetHandle} accepts a diagnostic token only when its integrity rule is satisfied.`,
    safetyHint: 'This is a synthetic puzzle. Inspect the arithmetic relationship instead of trying real network commands.',
    challengeType: 'logic',
    challengePrompt: `The simulator seed is ${n}. Compute (seed × 7 + level × 13) mod 997. Enter the result as a 3-digit value.`,
    canonicalAnswer: answer,
    aiPayload: { source: 'fallback', seed: n, level }
  };
}

async function callZai(messages, { temperature = 0.5, maxTokens = 700 } = {}) {
  if (!ZAI_ENABLED || !ZAI_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const r = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ZAI_API_KEY}`
      },
      body: JSON.stringify({
        model: ZAI_MODEL,
        temperature,
        max_tokens: maxTokens,
        messages
      })
    });

    if (!r.ok) throw new Error(`Z.AI returned ${r.status}`);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.warn('[ai] provider fallback:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonLoose(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try { return JSON.parse(trimmed); } catch {}
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function generateChallenge({ targetHandle, level }) {
  const system = `You create fictional cybersecurity classroom challenges for a closed educational game.
Never provide real exploit payloads, real scanning steps, real targets, or instructions for attacking actual systems.
Use only invented services and puzzle logic.
Return JSON only with keys:
displayName, mockPort, fictionalService, mockVersion, description, safetyHint, challengeType, challengePrompt, canonicalAnswer.
challengeType must be one of logic, sequence, decode, configuration.
canonicalAnswer must be a short safe puzzle answer.`;

  const user = `Target handle: ${targetHandle}
Student level: ${level}
Generate one engaging fictional diagnostic puzzle.`;

  const raw = await callZai([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 0.7, maxTokens: 700 });

  const data = parseJsonLoose(raw);
  if (!data) return fallbackChallenge({ targetHandle, level });

  const safe = {
    displayName: String(data.displayName || 'Synthetic Diagnostic Puzzle').slice(0, 120),
    mockPort: Math.max(1024, Math.min(65535, Number(data.mockPort) || 31337)),
    fictionalService: String(data.fictionalService || 'NebulaGateway-Lab').slice(0, 100),
    mockVersion: String(data.mockVersion || 'v1.Lab').slice(0, 60),
    description: String(data.description || 'Synthetic classroom vulnerability profile.').slice(0, 800),
    safetyHint: String(data.safetyHint || 'Reason about the fictional puzzle only.').slice(0, 500),
    challengeType: ['logic', 'sequence', 'decode', 'configuration'].includes(data.challengeType) ? data.challengeType : 'logic',
    challengePrompt: String(data.challengePrompt || 'Enter SAFE').slice(0, 1500),
    canonicalAnswer: String(data.canonicalAnswer || 'SAFE').slice(0, 200),
    aiPayload: { source: 'zai' }
  };

  return safe;
}

async function mentorHint({ challenge, question, attempts = 0 }) {
  const system = `You are Z-Shield AI, an ethical-hacking instructor inside a closed classroom simulation.
The challenge is fictional. Never provide real attack commands, exploit payloads, real target guidance, or the exact canonical answer.
Give a concise Socratic hint that helps the student reason toward the answer.
Keep the response under 140 words.`;

  const content = `Challenge:
${challenge.challengePrompt}

Student question:
${question}

Previous failed attempts: ${attempts}`;

  const result = await callZai([
    { role: 'system', content: system },
    { role: 'user', content }
  ], { temperature: 0.5, maxTokens: 220 });

  return result || 'Look for the transformation rule in the challenge. Which values are inputs, which operation happens first, and what final format is required?';
}

async function botDecision({ mode, bot, peers, room }) {
  const system = `You are the tactical brain of a bot in a fictional classroom cybersecurity game.
This is NOT a real hacking system. Choose only game actions from:
scan, challenge, patch, wait, focus_low_shield, support_team.
Return compact JSON only:
{"action":"...", "targetHandle":"...", "say":"...", "reason":"..."}
Never provide real commands, payloads, IPs, or real-world intrusion advice.`;

  const user = JSON.stringify({
    mode,
    bot: { handle: bot.handle, shield: bot.shield, xp: bot.xp, team: bot.team },
    peers: peers.map(p => ({ handle: p.handle, shield: p.shield, xp: p.xp, team: p.team, isBot: p.isBot })),
    matchState: room.matchState,
    teamHealth: room.teamHealth
  });

  const raw = await callZai([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 0.65, maxTokens: 180 });

  return parseJsonLoose(raw) || { action: 'scan', targetHandle: '', say: '', reason: 'fallback' };
}

module.exports = {
  ZAI_ENABLED,
  generateChallenge,
  mentorHint,
  botDecision
};
