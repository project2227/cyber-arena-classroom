'use strict';

const crypto = require('crypto');

const ZAI_API_KEY = process.env.ZAI_API_KEY || '';
const ZAI_ENABLED = String(process.env.ZAI_ENABLED || 'false').toLowerCase() === 'true' && Boolean(ZAI_API_KEY);
const ZAI_BASE_URL = (process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4').replace(/\/$/, '');
const ZAI_MODEL = process.env.ZAI_MODEL || 'glm-5.2';

const SAFE_ACTIONS = new Set([
  'scan',
  'challenge',
  'patch',
  'wait',
  'focus_low_shield',
  'support_team'
]);

function randInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

function fallbackChallenge({ targetHandle, level = 1, category = 'logic' }) {
  const seed = randInt(12, 88);
  const mode = ['logic', 'sequence', 'decode', 'configuration'].includes(category) ? category : 'logic';

  if (mode === 'sequence') {
    const start = randInt(2, 9);
    const step = randInt(2, 7);
    const values = [start, start + step, start + step * 2, start + step * 3];
    return {
      displayName: 'Vector Sequence Integrity Check',
      mockPort: randInt(20000, 59000),
      fictionalService: 'VectorGate-Lab',
      mockVersion: `v${Math.max(1, Math.min(9, level))}.Sim`,
      description: `A fictional sequencing gate on ${targetHandle} requires the next diagnostic value before it accepts the classroom handshake.`,
      safetyHint: 'This is a synthetic number-sequence puzzle. No real network traffic is generated.',
      challengeType: 'sequence',
      challengePrompt: `Diagnostic sequence: ${values.join(' → ')} → ?\nEnter only the next integer.`,
      canonicalAnswer: String(start + step * 4),
      aiPayload: { source: 'fallback', seed, level }
    };
  }

  if (mode === 'decode') {
    const word = ['NOVA', 'SHIELD', 'VECTOR', 'ORBIT', 'CIPHER'][seed % 5];
    const shift = 1 + (level % 4);
    const encoded = [...word].map(ch => String.fromCharCode(((ch.charCodeAt(0) - 65 + shift) % 26) + 65)).join('');
    return {
      displayName: 'Cipher Relay Diagnostic',
      mockPort: randInt(20000, 59000),
      fictionalService: 'CipherRelay-Lab',
      mockVersion: `v${2 + (level % 6)}.Sim`,
      description: `A fictional classroom relay on ${targetHandle} stores a shifted diagnostic label. Reverse the stated shift to recover it.`,
      safetyHint: 'Treat this as a Caesar-style classroom puzzle only.',
      challengeType: 'decode',
      challengePrompt: `Encoded label: ${encoded}\nEach letter was shifted forward by ${shift}. Decode the original uppercase word.`,
      canonicalAnswer: word,
      aiPayload: { source: 'fallback', seed, level }
    };
  }

  if (mode === 'configuration') {
    const required = ['AUTH', 'TLS', 'LOG', 'SEGMENT'][seed % 4];
    return {
      displayName: 'Defense Policy Matrix',
      mockPort: randInt(20000, 59000),
      fictionalService: 'AegisPolicy-Lab',
      mockVersion: `v${1 + (level % 8)}.Sim`,
      description: `A fictional defense node on ${targetHandle} has one missing control in a training policy matrix.`,
      safetyHint: 'Choose the defensive concept requested by the simulated policy, not a real system setting.',
      challengeType: 'configuration',
      challengePrompt: `Policy requires the missing control named ${required}. Enter exactly: ${required}`,
      canonicalAnswer: required,
      aiPayload: { source: 'fallback', seed, level }
    };
  }

  const answer = String((seed * 7 + level * 13) % 997).padStart(3, '0');
  return {
    displayName: 'Orion Relay Integrity Puzzle',
    mockPort: randInt(20000, 59000),
    fictionalService: 'OrionRelay-Lab',
    mockVersion: `v${2 + Math.min(level, 7)}.Sim`,
    description: `A fictional classroom service on ${targetHandle} accepts a diagnostic token only when its integrity rule is satisfied.`,
    safetyHint: 'This is a synthetic arithmetic puzzle. Inspect the relationship instead of trying real network commands.',
    challengeType: 'logic',
    challengePrompt: `The simulator seed is ${seed}. Compute (seed × 7 + level × 13) mod 997 using level ${level}. Enter the result as a 3-digit value.`,
    canonicalAnswer: answer,
    aiPayload: { source: 'fallback', seed, level }
  };
}

async function callZai(messages, { temperature = 0.5, maxTokens = 700 } = {}) {
  if (!ZAI_ENABLED || !ZAI_API_KEY) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
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

    if (!response.ok) throw new Error(`Z.AI returned ${response.status}`);
    const body = await response.json();
    return body?.choices?.[0]?.message?.content || null;
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
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function cleanLine(value, max = 180) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

async function generateChallenge({ targetHandle, level = 1, category = 'logic' }) {
  const system = `You create fictional cybersecurity classroom challenges for a closed educational game.
Never provide real exploit payloads, real scanning instructions, real IP addresses, real organizations, credential theft, malware instructions, or steps for attacking actual systems.
Use only invented services, synthetic ports, and puzzle logic.
Return JSON only with keys:
displayName, mockPort, fictionalService, mockVersion, description, safetyHint, challengeType, challengePrompt, canonicalAnswer.
challengeType must be one of logic, sequence, decode, configuration.
canonicalAnswer must be a short safe puzzle answer that can be compared as text.`;

  const user = `Target handle: ${cleanLine(targetHandle, 24)}
Student level: ${Math.max(1, Number(level) || 1)}
Preferred challenge category: ${cleanLine(category, 20)}
Generate one engaging fictional diagnostic puzzle appropriate for this level. Do not reveal the answer in the prompt.`;

  const raw = await callZai([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 0.7, maxTokens: 760 });

  const data = parseJsonLoose(raw);
  if (!data) return fallbackChallenge({ targetHandle, level, category });

  const allowedTypes = new Set(['logic', 'sequence', 'decode', 'configuration']);
  const canonicalAnswer = cleanLine(data.canonicalAnswer, 200);
  if (!canonicalAnswer) return fallbackChallenge({ targetHandle, level, category });

  return {
    displayName: cleanLine(data.displayName || 'Synthetic Diagnostic Puzzle', 120),
    mockPort: Math.max(1024, Math.min(65535, Number(data.mockPort) || 31337)),
    fictionalService: cleanLine(data.fictionalService || 'NebulaGateway-Lab', 100),
    mockVersion: cleanLine(data.mockVersion || 'v1.Sim', 60),
    description: String(data.description || 'Synthetic classroom vulnerability profile.').slice(0, 800),
    safetyHint: String(data.safetyHint || 'Reason about the fictional puzzle only.').slice(0, 500),
    challengeType: allowedTypes.has(data.challengeType) ? data.challengeType : 'logic',
    challengePrompt: String(data.challengePrompt || 'Enter SAFE').slice(0, 1500),
    canonicalAnswer,
    aiPayload: { source: 'zai' }
  };
}

async function mentorHint({ challenge, question, attempts = 0, playerLevel = 1, terminalHistory = [] }) {
  const system = `You are Z-Shield AI, an ethical cybersecurity educator inside a fictional closed classroom simulation.
Never provide instructions for compromising real systems, exploit payloads, malware, credential theft, real target guidance, or the canonical answer.
Teach through Socratic reasoning. Be encouraging but concise. Keep the response under 150 words.`;

  const content = `Challenge type: ${challenge.challengeType}
Challenge: ${challenge.challengePrompt}
Student level: ${playerLevel}
Failed attempts: ${attempts}
Recent simulator commands: ${terminalHistory.slice(-6).join(' | ')}
Student question: ${cleanLine(question, 500)}`;

  const result = await callZai([
    { role: 'system', content: system },
    { role: 'user', content }
  ], { temperature: 0.45, maxTokens: 240 });

  return result || 'Break the puzzle into inputs, transformation, and required output format. Which part can you compute or verify first without guessing the final answer?';
}

async function explainConcept({ challenge, attempts = 0, success = false }) {
  const system = `You are Z-Shield AI, a cybersecurity educator in a fictional classroom game.
Explain only defensive concepts. Do not include exploit commands, real targets, payloads, or actionable intrusion steps.
Return JSON with keys: whatHappened, whyItWorked, defensiveConcept, enterpriseMitigation, keyLesson.
Keep each value under 70 words.`;

  const user = `Synthetic challenge type: ${challenge.challengeType}
Prompt: ${challenge.challengePrompt}
Student attempts: ${attempts}
Solved: ${Boolean(success)}
Explain the learning objective without revealing or reproducing any harmful real-world procedure.`;

  const raw = await callZai([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 0.35, maxTokens: 500 });

  const parsed = parseJsonLoose(raw);
  if (parsed) {
    return {
      whatHappened: String(parsed.whatHappened || '').slice(0, 450),
      whyItWorked: String(parsed.whyItWorked || '').slice(0, 450),
      defensiveConcept: String(parsed.defensiveConcept || '').slice(0, 450),
      enterpriseMitigation: String(parsed.enterpriseMitigation || '').slice(0, 450),
      keyLesson: String(parsed.keyLesson || '').slice(0, 450)
    };
  }

  return {
    whatHappened: 'You solved a synthetic validation problem and the simulator accepted the correct logical result.',
    whyItWorked: 'The challenge rewarded careful reasoning about how inputs are transformed and validated.',
    defensiveConcept: 'Real defensive systems should validate input and authorization decisions on trusted servers rather than trusting client state.',
    enterpriseMitigation: 'Organizations use layered validation, least privilege, segmentation, logging, monitoring, and secure configuration management.',
    keyLesson: 'Understand the rule, verify assumptions, and design systems so untrusted clients cannot decide security outcomes.'
  };
}

async function botDecision({ mode, bot, peers, room }) {
  const system = `You are the tactical brain of a bot in a fictional classroom cybersecurity game.
This is not a real hacking system. Choose only a game action from: scan, challenge, patch, wait, focus_low_shield, support_team.
Return compact JSON only: {"action":"...","targetHandle":"...","say":"...","reason":"..."}
Never provide real commands, payloads, IPs, malware advice, or real-world intrusion guidance.`;

  const user = JSON.stringify({
    mode,
    personality: bot.personality,
    difficulty: bot.difficulty,
    bot: {
      handle: bot.handle,
      shield: bot.shield,
      xp: bot.xp,
      team: bot.team,
      level: bot.level
    },
    peers: peers.map(p => ({
      handle: p.handle,
      shield: p.shield,
      xp: p.xp,
      team: p.team,
      level: p.level,
      isBot: p.isBot
    })),
    matchState: room.matchState,
    teamHealth: room.teamHealth
  });

  const raw = await callZai([
    { role: 'system', content: system },
    { role: 'user', content: user }
  ], { temperature: 0.62, maxTokens: 220 });

  const parsed = parseJsonLoose(raw) || {};
  const action = SAFE_ACTIONS.has(parsed.action) ? parsed.action : 'scan';
  return {
    action,
    targetHandle: cleanLine(parsed.targetHandle, 24),
    say: cleanLine(parsed.say, 120),
    reason: cleanLine(parsed.reason, 180)
  };
}

module.exports = {
  ZAI_ENABLED,
  generateChallenge,
  mentorHint,
  explainConcept,
  botDecision
};
