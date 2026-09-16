(() => {
  'use strict';

  const CFG = window.CYBER_ARENA_CONFIG || {};
  const SERVER = String(CFG.SERVER_URL || '').replace(/\/$/, '');
  const $ = id => document.getElementById(id);

  const state = {
    token: sessionStorage.getItem('cyberArenaToken') || '',
    user: null,
    room: null,
    socket: null,
    selectedMode: 'classic',
    activeTarget: null,
    activeChallenge: null,
    authMode: 'login'
  };

  const ui = {
    screens: {
      auth: $('authScreen'),
      home: $('homeScreen'),
      room: $('roomScreen')
    },
    connection: $('connectionState'),
    roomBadge: $('roomBadge'),
    logout: $('logoutBtn'),
    loginTab: $('loginTab'),
    signupTab: $('signupTab'),
    authForm: $('authForm'),
    authSubmit: $('authSubmit'),
    authError: $('authError'),
    username: $('username'),
    password: $('password'),
    roomName: $('roomName'),
    playerHandle: $('playerHandle'),
    joinCode: $('joinCode'),
    joinHandle: $('joinHandle'),
    createRoom: $('createRoomBtn'),
    joinRoom: $('joinRoomBtn'),
    homeError: $('homeError'),
    roomTitle: $('roomTitle'),
    modeBadge: $('modeBadge'),
    peerList: $('peerList'),
    leaderboard: $('leaderboard'),
    playerCount: $('playerCount'),
    feed: $('liveFeed'),
    terminalLog: $('terminalLog'),
    terminalForm: $('terminalForm'),
    terminalInput: $('terminalInput'),
    terminalContext: $('terminalContext'),
    challengeBox: $('challengeBox'),
    challengeTitle: $('challengeTitle'),
    challengeDescription: $('challengeDescription'),
    challengeService: $('challengeService'),
    challengePort: $('challengePort'),
    challengePrompt: $('challengePrompt'),
    answerForm: $('answerForm'),
    answerInput: $('answerInput'),
    hintBtn: $('hintBtn'),
    hintOutput: $('hintOutput'),
    shieldValue: $('shieldValue'),
    defenseShield: $('defenseShield'),
    patchBtn: $('patchBtn'),
    instructorControls: $('instructorControls'),
    botCount: $('botCount'),
    addBots: $('addBotsBtn'),
    startMatch: $('startMatchBtn'),
    teamHealth: $('teamHealth'),
    redHealth: $('redHealth'),
    blueHealth: $('blueHealth'),
    redHealthText: $('redHealthText'),
    blueHealthText: $('blueHealthText'),
    toast: $('toast')
  };

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[m]);
  }

  function show(screen) {
    Object.entries(ui.screens).forEach(([k, el]) => el.classList.toggle('active', k === screen));
  }

  function toast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ui.toast.classList.add('hidden'), 2600);
  }

  function log(message, kind = '') {
    const row = document.createElement('div');
    row.className = `line ${kind}`;
    row.textContent = message;
    ui.terminalLog.appendChild(row);
    ui.terminalLog.scrollTop = ui.terminalLog.scrollHeight;
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;

    const response = await fetch(`${SERVER}${path}`, {
      ...options,
      headers
    });

    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    ui.loginTab.classList.toggle('active', mode === 'login');
    ui.signupTab.classList.toggle('active', mode === 'signup');
    ui.authSubmit.textContent = mode === 'login' ? 'ENTER ARENA' : 'CREATE ACCOUNT';
    ui.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    ui.authError.textContent = '';
  }

  async function handleAuth(e) {
    e.preventDefault();
    ui.authError.textContent = '';
    try {
      const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
      const data = await api(path, {
        method: 'POST',
        body: JSON.stringify({
          username: ui.username.value.trim(),
          password: ui.password.value
        })
      });

      if (state.authMode === 'signup') {
        setAuthMode('login');
        toast('Account created. Log in now.');
        return;
      }

      state.token = data.token;
      state.user = data.user;
      sessionStorage.setItem('cyberArenaToken', state.token);
      ui.logout.classList.remove('hidden');
      show('home');
      connectSocket();
    } catch (err) {
      ui.authError.textContent = err.message;
    }
  }

  function connectSocket() {
    if (state.socket) state.socket.disconnect();
    if (!state.token || typeof io !== 'function') return;

    state.socket = io(SERVER, {
      auth: { token: state.token },
      transports: ['websocket', 'polling']
    });

    state.socket.on('connect', () => {
      ui.connection.textContent = 'ONLINE';
      ui.connection.className = 'status online';
      if (state.room?.roomId) state.socket.emit('room:join', { roomCode: state.room.roomId });
    });

    state.socket.on('disconnect', () => {
      ui.connection.textContent = 'OFFLINE';
      ui.connection.className = 'status offline';
    });

    state.socket.on('room:state', room => {
      state.room = room;
      renderRoom();
    });

    state.socket.on('room:playerJoined', data => {
      toast(`${data.handle} joined`);
    });

    state.socket.on('room:playerLeft', data => {
      toast(`${data.handle} left`);
    });

    state.socket.on('feed:event', item => {
      addFeed(item);
    });

    state.socket.on('leaderboard:update', list => {
      renderLeaderboard(list);
    });

    state.socket.on('match:state', data => {
      if (!state.room) return;
      state.room.matchState = data.matchState;
      state.room.teamHealth = data.teamHealth || state.room.teamHealth;
      renderRoom();
      if (data.message) log(data.message, 'system');
    });

    state.socket.on('shield:update', data => {
      if (!state.room) return;
      const p = state.room.players.find(x => x.userId === data.userId);
      if (p) p.shield = data.shield;
      renderRoom();
    });

    state.socket.on('challenge:resolved', data => {
      if (data.message) log(data.message, data.success ? 'success' : 'danger');
    });
  }

  async function createRoom() {
    ui.homeError.textContent = '';
    try {
      const handle = ui.playerHandle.value.trim();
      if (!handle) throw new Error('Enter a player handle.');
      const data = await api('/api/rooms/create', {
        method: 'POST',
        body: JSON.stringify({
          roomName: ui.roomName.value.trim() || 'Cyber Lab',
          handle,
          mode: state.selectedMode
        })
      });
      state.room = data.room;
      enterRoom();
    } catch (err) {
      ui.homeError.textContent = err.message;
    }
  }

  async function joinRoom() {
    ui.homeError.textContent = '';
    try {
      const code = ui.joinCode.value.trim().toUpperCase();
      const handle = ui.joinHandle.value.trim();
      if (!code || !handle) throw new Error('Enter both room code and handle.');
      const data = await api('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ roomCode: code, handle })
      });
      state.room = data.room;
      enterRoom();
    } catch (err) {
      ui.homeError.textContent = err.message;
    }
  }

  function enterRoom() {
    show('room');
    ui.roomBadge.classList.remove('hidden');
    ui.roomBadge.textContent = `ROOM ${state.room.roomId}`;
    renderRoom();
    connectSocket();
  }

  function renderRoom() {
    const room = state.room;
    if (!room) return;
    ui.roomTitle.textContent = `${room.roomName} · ${room.roomId}`;
    ui.modeBadge.textContent = String(room.mode || 'classic').toUpperCase().replaceAll('_', ' ');
    ui.playerCount.textContent = `${room.players?.length || 0}`;

    const me = room.players?.find(p => p.userId === state.user?.id);
    const instructor = room.instructorId === state.user?.id;

    ui.instructorControls.classList.toggle('hidden', !instructor);
    ui.startMatch.textContent = room.matchState === 'running' ? 'MATCH RUNNING' : 'START MATCH';
    ui.startMatch.disabled = room.matchState === 'running';

    const shield = me?.shield ?? 100;
    ui.shieldValue.textContent = `${shield}%`;
    ui.defenseShield.textContent = shield;

    const teamMode = room.mode === 'teams';
    ui.teamHealth.classList.toggle('hidden', !teamMode);
    if (teamMode) {
      const red = room.teamHealth?.red ?? 100;
      const blue = room.teamHealth?.blue ?? 100;
      ui.redHealth.style.width = `${red}%`;
      ui.blueHealth.style.width = `${blue}%`;
      ui.redHealthText.textContent = red;
      ui.blueHealthText.textContent = blue;
    }

    renderPeers(room.players || []);
    renderLeaderboard((room.players || []).slice().sort((a, b) => b.xp - a.xp));
  }

  function renderPeers(players) {
    const me = players.find(p => p.userId === state.user?.id);
    ui.peerList.innerHTML = players.map(p => {
      const enemy = state.room?.mode === 'teams' && me && p.team && me.team && p.team !== me.team;
      const classes = ['peer-card'];
      if (p.userId === state.user?.id) classes.push('me');
      if (enemy) classes.push('enemy');
      if (p.isBot) classes.push('bot');

      return `
        <div class="${classes.join(' ')}">
          <strong>${esc(p.handle)}</strong>
          <span class="meta">
            ${esc(p.nodeId)} · LVL ${p.level} · ${p.shield}% shield
            ${p.team ? ` · ${esc(p.team.toUpperCase())}` : ''}
          </span>
          ${p.userId !== state.user?.id ? `
            <div class="mini-actions">
              <button class="btn ghost scan-peer" data-id="${esc(p.userId)}">SCAN</button>
              ${state.room?.mode !== 'classic' ? `<button class="btn ghost duel-peer" data-id="${esc(p.userId)}">CHALLENGE</button>` : ''}
            </div>` : ''}
        </div>
      `;
    }).join('');

    ui.peerList.querySelectorAll('.scan-peer').forEach(btn => {
      btn.addEventListener('click', () => scanPeer(btn.dataset.id));
    });

    ui.peerList.querySelectorAll('.duel-peer').forEach(btn => {
      btn.addEventListener('click', () => scanPeer(btn.dataset.id, true));
    });
  }

  function renderLeaderboard(players) {
    ui.leaderboard.innerHTML = players.map((p, idx) => `
      <div class="rank">
        <span>#${idx + 1}</span>
        <span>${esc(p.handle)}${p.isBot ? ' [BOT]' : ''}</span>
        <span class="xp">${p.xp} XP</span>
      </div>
    `).join('');
  }

  function addFeed(item) {
    const div = document.createElement('div');
    div.className = 'feed-item';
    const time = new Date(item.at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<time>${esc(time)}</time><span>${esc(item.message || item.type || 'Activity')}</span>`;
    ui.feed.prepend(div);
    while (ui.feed.children.length > 60) ui.feed.lastChild.remove();
  }

  async function scanPeer(targetUserId, duelIntent = false) {
    try {
      const data = await api('/api/game/scan', {
        method: 'POST',
        body: JSON.stringify({ roomCode: state.room.roomId, targetUserId, duelIntent })
      });
      state.activeTarget = targetUserId;
      state.activeChallenge = data.challenge;
      ui.terminalContext.textContent = `Synthetic node ${data.target.handle} · ${data.target.nodeId}`;
      showChallenge(data.challenge);
      log(`scan ${data.target.nodeId}`, 'system');
      log(`Fictional service discovered: ${data.challenge.fictionalService} ${data.challenge.mockVersion} on port ${data.challenge.mockPort}`);
    } catch (err) {
      log(err.message, 'danger');
    }
  }

  function showChallenge(c) {
    ui.challengeBox.classList.remove('hidden');
    ui.challengeTitle.textContent = c.displayName;
    ui.challengeDescription.textContent = c.description;
    ui.challengeService.textContent = `${c.fictionalService} ${c.mockVersion}`;
    ui.challengePort.textContent = `PORT ${c.mockPort}`;
    ui.challengePrompt.textContent = c.challengePrompt;
    ui.answerInput.value = '';
    ui.hintOutput.classList.add('hidden');
  }

  async function submitAnswer(e) {
    e.preventDefault();
    if (!state.activeChallenge) return;
    try {
      const data = await api('/api/exploit/verify', {
        method: 'POST',
        body: JSON.stringify({
          roomCode: state.room.roomId,
          challengeId: state.activeChallenge.challengeId,
          answer: ui.answerInput.value
        })
      });
      log(data.message, data.success ? 'success' : 'danger');
      if (data.success) {
        ui.challengeBox.classList.add('hidden');
        state.activeChallenge = null;
      }
    } catch (err) {
      log(err.message, 'danger');
    }
  }

  async function requestHint() {
    if (!state.activeChallenge) return;
    ui.hintBtn.disabled = true;
    try {
      const data = await api('/api/ai/hint', {
        method: 'POST',
        body: JSON.stringify({
          roomCode: state.room.roomId,
          challengeId: state.activeChallenge.challengeId,
          question: 'Give me a Socratic hint for my current challenge.'
        })
      });
      ui.hintOutput.textContent = data.hint;
      ui.hintOutput.classList.remove('hidden');
    } catch (err) {
      ui.hintOutput.textContent = err.message;
      ui.hintOutput.classList.remove('hidden');
    } finally {
      ui.hintBtn.disabled = false;
    }
  }

  async function patchDefense() {
    try {
      const data = await api('/api/defense/patch', {
        method: 'POST',
        body: JSON.stringify({ roomCode: state.room.roomId })
      });
      toast(data.message);
    } catch (err) {
      toast(err.message);
    }
  }

  async function addBots() {
    try {
      const data = await api(`/api/rooms/${state.room.roomId}/bots`, {
        method: 'POST',
        body: JSON.stringify({ count: Number(ui.botCount.value) })
      });
      toast(`${data.added} bot(s) added`);
    } catch (err) {
      toast(err.message);
    }
  }

  async function startMatch() {
    try {
      const data = await api(`/api/rooms/${state.room.roomId}/start`, { method: 'POST' });
      toast(data.message);
    } catch (err) {
      toast(err.message);
    }
  }

  function handleTerminal(e) {
    e.preventDefault();
    const raw = ui.terminalInput.value.trim();
    ui.terminalInput.value = '';
    if (!raw) return;
    log(`> ${raw}`);

    const [cmd, ...args] = raw.split(/\s+/);
    switch (cmd.toLowerCase()) {
      case 'help':
        log('Commands: help, status, peers, scan <handle>, shield, clear', 'system');
        break;
      case 'status':
        log(`Room ${state.room?.roomId || '-'} · mode ${state.room?.mode || '-'} · state ${state.room?.matchState || 'lobby'}`);
        break;
      case 'peers':
        log((state.room?.players || []).map(p => `${p.handle} [${p.nodeId}]`).join('\n'));
        break;
      case 'scan': {
        const name = args.join(' ').toLowerCase();
        const p = (state.room?.players || []).find(x => x.handle.toLowerCase() === name);
        if (!p) log('Unknown classroom node.', 'danger');
        else scanPeer(p.userId);
        break;
      }
      case 'shield':
        log(`Defense shield: ${ui.defenseShield.textContent}%`);
        break;
      case 'clear':
        ui.terminalLog.innerHTML = '';
        break;
      default:
        log('Unknown simulator command. Type help.', 'danger');
    }
  }

  function logout() {
    state.token = '';
    state.user = null;
    state.room = null;
    sessionStorage.removeItem('cyberArenaToken');
    if (state.socket) state.socket.disconnect();
    ui.logout.classList.add('hidden');
    ui.roomBadge.classList.add('hidden');
    show('auth');
  }

  async function restoreSession() {
    if (!SERVER) {
      ui.authError.textContent = 'Set SERVER_URL in config.js before deploying.';
      return;
    }
    if (!state.token) return;
    try {
      const data = await api('/api/auth/me');
      state.user = data.user;
      ui.logout.classList.remove('hidden');
      show('home');
      connectSocket();
    } catch {
      logout();
    }
  }

  document.querySelectorAll('.mode-card').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedMode = btn.dataset.mode;
      document.querySelectorAll('.mode-card').forEach(x => x.classList.toggle('active', x === btn));
    });
  });

  ui.loginTab.addEventListener('click', () => setAuthMode('login'));
  ui.signupTab.addEventListener('click', () => setAuthMode('signup'));
  ui.authForm.addEventListener('submit', handleAuth);
  ui.createRoom.addEventListener('click', createRoom);
  ui.joinRoom.addEventListener('click', joinRoom);
  ui.terminalForm.addEventListener('submit', handleTerminal);
  ui.answerForm.addEventListener('submit', submitAnswer);
  ui.hintBtn.addEventListener('click', requestHint);
  ui.patchBtn.addEventListener('click', patchDefense);
  ui.addBots.addEventListener('click', addBots);
  ui.startMatch.addEventListener('click', startMatch);
  ui.logout.addEventListener('click', logout);

  restoreSession();
})();
