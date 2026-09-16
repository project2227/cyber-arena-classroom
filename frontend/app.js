(() => {
  'use strict';

  const CFG = window.CYBER_ARENA_CONFIG || {};
  const SERVER = String(CFG.SERVER_URL || '').replace(/\/$/, '');
  const $ = id => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const COMMANDS = ['help','status','profile','peers','scan','shield','patch','leaderboard','match','team','hint','clear','whoami','missions','stats','achievements','tutorial'];
  const DIFFICULTY_COPY = {
    rookie: 'ROOKIE · slower decisions, more mistakes, lighter defensive pressure.',
    standard: 'STANDARD · balanced reasoning, defense, and target selection.',
    advanced: 'ADVANCED · faster decisions, better target selection, stronger defense.',
    elite: 'ELITE · tactical pressure, frequent patching, and disciplined target focus.',
    nightmare: 'NIGHTMARE · highly efficient simulated opponents with aggressive pressure.'
  };

  const state = {
    token: sessionStorage.getItem('cyberArenaToken') || '',
    user: null,
    profile: null,
    room: null,
    socket: null,
    authMode: 'login',
    activeTarget: null,
    activeChallenge: null,
    selectedNodeId: null,
    terminalHistory: [],
    historyIndex: 0,
    queueMode: null,
    queueStartedAt: 0,
    previousMatchState: null,
    introShownForMatchId: null,
    resultShownForMatchId: null,
    rematchAllowed: false,
    matchTimer: null,
    scanTimer: null,
    trainingStep: 0,
    replayingTraining: false,
    boardMode: 'individual',
    lastBotSettings: { mode: 'classic', botCount: 3, difficulty: 'standard' }
  };

  const ui = {
    topbar: $('topbar'), headerProfile: $('headerProfile'), headerHandle: $('headerHandle'), headerLevel: $('headerLevel'), headerRank: $('headerRank'),
    connection: $('connectionState'), roomBadge: $('roomBadge'), logout: $('logoutBtn'), sound: $('soundBtn'), help: $('helpBtn'), brandHome: $('brandHomeBtn'),
    screens: { auth: $('authScreen'), command: $('commandScreen'), room: $('roomScreen') },
    loginTab: $('loginTab'), signupTab: $('signupTab'), authForm: $('authForm'), authSubmit: $('authSubmit'), authProgress: $('authProgress'), authError: $('authError'), username: $('username'), password: $('password'),
    welcomeHandle: $('welcomeHandle'), welcomeSubtitle: $('welcomeSubtitle'), commandLevel: $('commandLevel'), commandRank: $('commandRank'), commandXpBar: $('commandXpBar'), commandXpText: $('commandXpText'), commandTotalXp: $('commandTotalXp'),
    profileOrbLevel: $('profileOrbLevel'), profileSummaryHandle: $('profileSummaryHandle'), profileSummaryRank: $('profileSummaryRank'), statWins: $('statWins'), statMatches: $('statMatches'), statSolved: $('statSolved'), statStreak: $('statStreak'), achievementCount: $('achievementCount'), recentMatches: $('recentMatches'),
    quickMatch: $('quickMatchBtn'), botsMatch: $('botsMatchBtn'), duelMatch: $('duelMatchBtn'), teamMatch: $('teamMatchBtn'), soloTraining: $('soloTrainingBtn'), privateMatch: $('privateMatchBtn'), profileBtn: $('profileBtn'), achievementsBtn: $('achievementsBtn'), tutorialBtn: $('tutorialBtn'), historyBtn: $('historyBtn'),
    roomTitle: $('roomTitle'), matchProtocolLabel: $('matchProtocolLabel'), modeBadge: $('modeBadge'), matchStateBadge: $('matchStateBadge'), matchTimer: $('matchTimer'), leaveView: $('leaveViewBtn'), playerCount: $('playerCount'), networkMap: $('networkMap'), nodeInspector: $('nodeInspector'),
    instructorControls: $('instructorControls'), botCount: $('botCount'), lobbyBotDifficulty: $('lobbyBotDifficulty'), addBots: $('addBotsBtn'), startMatch: $('startMatchBtn'),
    terminalContext: $('terminalContext'), shieldValue: $('shieldValue'), streakValue: $('streakValue'), terminalLog: $('terminalLog'), commandSuggestions: $('commandSuggestions'), terminalForm: $('terminalForm'), terminalInput: $('terminalInput'),
    challengeBox: $('challengeBox'), challengeTitle: $('challengeTitle'), challengeType: $('challengeType'), challengeDescription: $('challengeDescription'), challengeService: $('challengeService'), challengePort: $('challengePort'), challengePrompt: $('challengePrompt'), answerForm: $('answerForm'), answerInput: $('answerInput'), hintBtn: $('hintBtn'), closeChallenge: $('closeChallengeBtn'), hintOutput: $('hintOutput'),
    leaderboard: $('leaderboard'), leaderboardToggle: $('leaderboardToggle'), defenseShield: $('defenseShield'), shieldArc: $('shieldArc'), patch: $('patchBtn'), teamHealth: $('teamHealth'), redHealth: $('redHealth'), blueHealth: $('blueHealth'), redHealthText: $('redHealthText'), blueHealthText: $('blueHealthText'), feed: $('liveFeed'), zFab: $('zShieldFab'),
    onboarding: $('onboardingOverlay'), trainingContent: $('trainingContent'), trainingStepLabel: $('trainingStepLabel'), trainingProgress: $('trainingProgress'), trainingBack: $('trainingBackBtn'), trainingNext: $('trainingNextBtn'), skipTraining: $('skipTrainingBtn'),
    matchmaking: $('matchmakingOverlay'), matchmakingTitle: $('matchmakingTitle'), queuePlayers: $('queuePlayers'), queueTime: $('queueTime'), queueRegion: $('queueRegion'), botOffer: $('botOffer'), cancelMatchmaking: $('cancelMatchmakingBtn'), keepSearching: $('keepSearchingBtn'), acceptBot: $('acceptBotBtn'),
    modeModal: $('modeModal'), botsModal: $('botsModal'), botsMode: $('botsMode'), botsCount: $('botsCount'), botsDifficulty: $('botsDifficulty'), difficultyInfo: $('difficultyInfo'), launchBotMatch: $('launchBotMatchBtn'),
    privateModal: $('privateModal'), createPrivateForm: $('createPrivateForm'), joinPrivateForm: $('joinPrivateForm'), roomName: $('roomName'), playerHandle: $('playerHandle'), privateMode: $('privateMode'), joinCode: $('joinCode'), joinHandle: $('joinHandle'), privateError: $('privateError'),
    profileModal: $('profileModal'), profileModalLevel: $('profileModalLevel'), profileModalHandle: $('profileModalHandle'), profileModalRank: $('profileModalRank'), profileXpText: $('profileXpText'), profileXpBar: $('profileXpBar'), profileHandleInput: $('profileHandleInput'), handleForm: $('handleForm'), profileStatsGrid: $('profileStatsGrid'), achievementGrid: $('achievementGrid'), historyList: $('historyList'),
    guideModal: $('guideModal'), commandGuide: $('commandGuide'), scanOverlay: $('scanOverlay'), scanTargetLabel: $('scanTargetLabel'), scanPercent: $('scanPercent'), scanProgressBar: $('scanProgressBar'), scanStatus: $('scanStatus'),
    introOverlay: $('introOverlay'), introContent: $('introContent'), resultOverlay: $('resultOverlay'), resultTitle: $('resultTitle'), resultSubtitle: $('resultSubtitle'), resultStats: $('resultStats'), resultXpBar: $('resultXpBar'), resultXpText: $('resultXpText'), rematch: $('rematchBtn'), resultQuick: $('resultQuickBtn'), resultHome: $('resultHomeBtn'),
    zDrawer: $('zShieldDrawer'), closeZ: $('closeZShieldBtn'), zContext: $('zShieldContext'), zMessages: $('zShieldMessages'), zForm: $('zShieldForm'), zInput: $('zShieldInput'),
    debriefModal: $('debriefModal'), debriefContent: $('debriefContent'), levelUp: $('levelUpOverlay'), levelUpNumber: $('levelUpNumber'), levelUpRank: $('levelUpRank'), achievementToast: $('achievementToast'), achievementToastName: $('achievementToastName'), achievementToastDesc: $('achievementToastDesc'), toast: $('toast')
  };

  const trainingSlides = [
    {
      title: 'INITIALIZING CYBER ARENA',
      body: 'Your operator ID is now connected to a closed classroom simulation. Every node, service, port, vulnerability, and challenge is fictional game state.',
      demo: '<div class="training-terminal"><b>&gt; initializing operator identity...</b><br>&gt; loading defensive matrix...<br>&gt; simulated network boundary: LOCKED<br><b>&gt; access granted.</b></div>'
    },
    {
      title: 'IDENTITY • XP • LEVELS',
      body: 'Match XP helps during the current operation. Account XP persists across matches and increases your operator level and rank.',
      demo: '<div class="training-list"><div>ACCOUNT XP<br><b>Persistent progression</b></div><div>MATCH XP<br><b>Current operation</b></div><div>LEVEL<br><b>Server calculated</b></div><div>RANK<br><b>Unlocks as you progress</b></div></div>'
    },
    {
      title: 'DEFENSE MATRIX',
      body: 'Your shield represents simulated system integrity. In Duel and Team Battle, successful puzzle solves reduce defensive integrity. Spend match XP to compile a patch before your shield collapses.',
      demo: '<div class="training-demo"><b style="color:#22d3ee">SHIELD 74%</b><div class="xp-track"><i style="width:74%"></i></div><p style="font-size:9px;color:#7891a8">TRICK: patch before entering the critical zone, but remember that patches cost match XP.</p></div>'
    },
    {
      title: 'SYNTHETIC NETWORK NODES',
      body: 'The topology map shows classmates and AI operators as synthetic nodes. Click a node to inspect it, then scan it to receive a fictional vulnerability profile.',
      demo: '<div class="training-demo" style="text-align:center"><b>NODE-A7F2</b><br><span style="color:#7891a8">TRAINING-BOT · LVL 3 · 100% SHIELD</span><br><br><span class="btn primary">SCAN NODE</span></div>'
    },
    {
      title: 'SCANNING & CHALLENGES',
      body: 'A scan never touches a real classroom machine. The server creates a fictional service and a logic, sequence, decode, or configuration puzzle. The answer is validated on the backend.',
      demo: '<div class="training-terminal">PORT ENUMERATION [SIMULATED] ... 100%<br>SERVICE: NebulaRelay-Lab v3.1<br>PORT: 28441<br><b>CHALLENGE READY</b></div>'
    },
    {
      title: 'TERMINAL COMMANDS',
      body: 'The terminal is a safe game command parser, not an operating-system shell. Use keyboard history with ↑/↓ and Tab completion.',
      demo: '<div class="training-terminal"><b>&gt; help</b><br>&gt; status<br>&gt; peers<br>&gt; scan TrainingBot<br>&gt; shield<br>&gt; patch<br>&gt; leaderboard<br>&gt; hint<br>&gt; clear</div>'
    },
    {
      title: 'Z-SHIELD AI MENTOR',
      body: 'Z-Shield receives only challenge context, your simulated attempts, level, and relevant terminal history. It gives Socratic hints without revealing the canonical answer.',
      demo: '<div class="training-demo"><b style="color:#c084fc">◉ Z-SHIELD</b><p style="font-size:9px;color:#9b8bac">“Which transformation happens before the final formatting step? Try verifying that part first.”</p></div>'
    },
    {
      title: 'DUELS & TEAM BATTLES',
      body: 'Duel is a 1v1 shield battle. Team Battle balances Red and Blue operators by account level and XP. In team mode, offensive challenges can only target opponents.',
      demo: '<div class="training-list"><div>DUEL<br><b>Human vs Human / Bot</b></div><div>TEAM BATTLE<br><b>Balanced Red vs Blue</b></div><div>QUICK MATCH<br><b>No room code</b></div><div>PRIVATE ROOM<br><b>Optional class code</b></div></div>'
    },
    {
      title: 'AI OPERATORS & MATCHMAKING',
      body: 'Quick Match searches for real operators first. If the lobby is incomplete after a short wait, you can keep searching or fill remaining positions with AI operators. Bots use deterministic rules plus optional Z.AI strategy.',
      demo: '<div class="training-terminal">SEARCHING FOR OPERATORS...<br>PLAYERS FOUND: 2 / 4<br>QUEUE: 00:08<br><b>&gt; AI fallback becomes available when needed</b></div>'
    },
    {
      title: 'OPERATOR TRICKS',
      body: 'Click nodes for speed, watch low-shield opponents in Duel, coordinate targets in Team mode, use patches strategically, and open the Command Library any time with the ? button.',
      demo: '<div class="training-list"><div>TIP 01<br><b>Use Tab completion</b></div><div>TIP 02<br><b>Watch shield integrity</b></div><div>TIP 03<br><b>Build challenge streaks</b></div><div>TIP 04<br><b>Use Z-Shield when stuck</b></div></div>'
    },
    {
      title: 'TRAINING COMPLETE',
      body: 'Your operator profile is ready. Enter the Cyber Command Center and choose Quick Match, Play vs Bots, Solo Training, Duel, Team Battle, or a private classroom room.',
      demo: '<div class="training-demo" style="text-align:center"><p class="kicker">OPERATOR STATUS</p><h2 style="color:#22d3ee">READY</h2></div>',
      final: true
    }
  ];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[m]);
  }

  function friendlyError(err) {
    const text = String(err?.message || err || 'Unknown error');
    if (/Failed to fetch|NetworkError|fetch/i.test(text)) return 'CONNECTION LOST — match server unreachable.';
    if (/401|Session expired|Authentication/i.test(text)) return 'AUTHENTICATION EXPIRED — sign in again.';
    if (/429|cooling down|Too many/i.test(text)) return `RATE LIMIT — ${text}`;
    return text;
  }

  async function api(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    let response;
    try {
      response = await fetch(`${SERVER}${path}`, { ...options, headers });
    } catch (err) {
      console.error('[api]', err);
      throw new Error('CONNECTION LOST — match server unreachable.');
    }
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function showScreen(name) {
    Object.entries(ui.screens).forEach(([key, el]) => el.classList.toggle('active', key === name));
    ui.topbar.classList.toggle('hidden', name === 'auth');
    if (name !== 'room') ui.zFab.classList.add('hidden');
    else ui.zFab.classList.remove('hidden');
  }

  function openOverlay(el) { el.classList.remove('hidden'); }
  function closeOverlay(el) { el.classList.add('hidden'); }

  function toast(message, ms = 2600) {
    ui.toast.textContent = message;
    ui.toast.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => ui.toast.classList.add('hidden'), ms);
  }

  function terminalLog(message, kind = '') {
    const row = document.createElement('div');
    row.className = `line ${kind}`;
    row.textContent = String(message);
    ui.terminalLog.appendChild(row);
    ui.terminalLog.scrollTop = ui.terminalLog.scrollHeight;
  }

  function updateHeader() {
    if (!state.profile) return;
    ui.headerProfile.classList.remove('hidden');
    ui.headerHandle.textContent = state.profile.displayHandle;
    ui.headerLevel.textContent = `LVL ${state.profile.accountLevel}`;
    ui.headerRank.textContent = state.profile.rank;
  }

  function percentIntoLevel(profile = state.profile) {
    if (!profile) return 0;
    return Math.max(0, Math.min(100, Math.round((profile.xpIntoLevel / Math.max(1, profile.xpForNextLevel)) * 100)));
  }

  function renderCommandCenter() {
    const p = state.profile;
    if (!p) return;
    ui.welcomeHandle.textContent = p.displayHandle;
    ui.commandLevel.textContent = `LEVEL ${p.accountLevel}`;
    ui.commandRank.textContent = p.rank;
    ui.commandXpBar.style.width = `${percentIntoLevel(p)}%`;
    ui.commandXpText.textContent = `${p.xpIntoLevel} / ${p.xpForNextLevel} XP`;
    ui.commandTotalXp.textContent = `${p.accountXp} TOTAL`;
    ui.profileOrbLevel.textContent = String(p.accountLevel).padStart(2, '0');
    ui.profileSummaryHandle.textContent = p.displayHandle;
    ui.profileSummaryRank.textContent = p.rank;
    ui.statWins.textContent = p.stats.wins;
    ui.statMatches.textContent = p.stats.matchesPlayed;
    ui.statSolved.textContent = p.stats.challengesSolved;
    ui.statStreak.textContent = p.stats.bestStreak;
    ui.achievementCount.textContent = p.achievements.length;
    ui.playerHandle.value = p.displayHandle;
    ui.joinHandle.value = p.displayHandle;
    renderRecentMatches(p.recentMatches || []);
    updateHeader();
  }

  function renderRecentMatches(matches) {
    if (!matches.length) {
      ui.recentMatches.innerHTML = '<div class="empty-state">No completed matches yet.</div>';
      return;
    }
    ui.recentMatches.innerHTML = matches.slice(0, 4).map(m => `
      <div class="recent-item"><div><b>${escapeHtml(String(m.mode).toUpperCase())}</b><span>${escapeHtml(String(m.result || '—').toUpperCase())}</span></div><div><small>${formatDate(m.finishedAt || m.startedAt)}</small><small>+${Number(m.accountXpAwarded || 0)} XP</small></div></div>
    `).join('');
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    ui.loginTab.classList.toggle('active', mode === 'login');
    ui.signupTab.classList.toggle('active', mode === 'signup');
    ui.authSubmit.querySelector('span').textContent = mode === 'login' ? 'AUTHENTICATE' : 'CREATE OPERATOR ID';
    ui.password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    ui.authError.textContent = '';
  }

  async function animateAuthProgress(isSignup) {
    const lines = isSignup
      ? ['GENERATING OPERATOR ID...', 'HASHING ACCESS KEY...', 'REGISTERING SECURE PROFILE...', 'ACCESS GRANTED.']
      : ['AUTHENTICATING IDENTITY...', 'VERIFYING ACCESS TOKEN...', 'ESTABLISHING SECURE SESSION...', 'ACCESS GRANTED.'];
    ui.authProgress.classList.remove('hidden');
    ui.authProgress.textContent = lines[0];
    for (let i = 1; i < lines.length; i++) {
      await delay(180);
      ui.authProgress.textContent += `\n${lines[i]}`;
    }
  }

  async function handleAuth(e) {
    e.preventDefault();
    ui.authError.textContent = '';
    ui.authSubmit.disabled = true;
    ui.authProgress.classList.add('hidden');
    const isSignup = state.authMode === 'signup';
    const progressPromise = animateAuthProgress(isSignup);
    try {
      const data = await api(isSignup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: ui.username.value.trim(), password: ui.password.value })
      });
      await progressPromise;
      state.token = data.token;
      state.user = data.user;
      state.profile = data.profile;
      sessionStorage.setItem('cyberArenaToken', state.token);
      await afterAuthentication({ newAccount: isSignup });
    } catch (err) {
      ui.authError.textContent = friendlyError(err);
      ui.authProgress.classList.add('hidden');
    } finally {
      ui.authSubmit.disabled = false;
    }
  }

  async function afterAuthentication({ newAccount = false } = {}) {
    ui.logout.classList.remove('hidden');
    updateHeader();
    connectSocket();
    if (!state.profile.onboardingCompleted || newAccount) {
      startTraining(false);
      return;
    }
    showScreen('command');
    renderCommandCenter();
    try {
      const current = await api('/api/rooms/current');
      if (current.room?.matchState === 'running') {
        state.rematchAllowed = Boolean(current.rematchAllowed);
        enterRoom(current.room, { resumed: true });
        toast('CONNECTION RESTORED — active operation resumed.');
      }
    } catch (err) {
      console.warn('[resume]', err);
    }
  }

  async function restoreSession() {
    if (!SERVER || /YOUR-RENDER/i.test(SERVER)) {
      ui.authError.textContent = 'CONFIGURATION ERROR — set your real Render URL in config.js.';
      return;
    }
    if (!state.token) return;
    try {
      const data = await api('/api/auth/me');
      state.user = data.user;
      state.profile = data.profile;
      await afterAuthentication();
    } catch (err) {
      console.warn('[session]', err);
      logout(false);
    }
  }

  function logout(showMessage = true) {
    state.token = '';
    state.user = null;
    state.profile = null;
    state.room = null;
    sessionStorage.removeItem('cyberArenaToken');
    state.socket?.disconnect();
    state.socket = null;
    ui.logout.classList.add('hidden');
    ui.roomBadge.classList.add('hidden');
    ui.headerProfile.classList.add('hidden');
    showScreen('auth');
    if (showMessage) toast('SESSION CLOSED');
  }

  function connectSocket() {
    if (!state.token || typeof io !== 'function') return;
    if (state.socket) state.socket.disconnect();
    state.socket = io(SERVER, { auth: { token: state.token }, transports: ['websocket','polling'], reconnection: true });

    state.socket.on('connect', () => {
      ui.connection.innerHTML = '<i></i>ONLINE';
      ui.connection.className = 'status online';
      if (state.room?.roomId) state.socket.emit('room:join', { roomCode: state.room.roomId });
    });

    state.socket.on('disconnect', () => {
      ui.connection.innerHTML = '<i></i>RECONNECTING';
      ui.connection.className = 'status offline';
      if (state.room) toast('CONNECTION INTERRUPTED — reconnecting...', 3500);
    });

    state.socket.on('connect_error', err => {
      console.error('[socket]', err);
      ui.connection.innerHTML = '<i></i>OFFLINE';
      ui.connection.className = 'status offline';
    });

    state.socket.on('room:state', room => {
      const before = state.room?.matchState;
      state.room = room;
      renderRoom();
      if (room.matchState === 'running' && before !== 'running') showMatchIntro(room);
      if (room.matchState === 'ended' && state.resultShownForMatchId !== room.matchId) showResults({ matchState: 'ended', winner: room.winner });
    });

    state.socket.on('feed:event', addFeed);
    state.socket.on('leaderboard:update', renderLeaderboard);
    state.socket.on('room:playerJoined', data => { sound.play('join'); toast(`${data.handle} CONNECTED`); });
    state.socket.on('room:playerLeft', data => toast(`${data.handle} DISCONNECTED`));

    state.socket.on('match:state', data => {
      if (!state.room) return;
      const previous = state.room.matchState;
      state.room.matchState = data.matchState || state.room.matchState;
      if (data.teamHealth) state.room.teamHealth = data.teamHealth;
      if (data.winner !== undefined) state.room.winner = data.winner;
      renderRoom();
      if (data.message) terminalLog(`[MATCH] ${data.message}`, data.matchState === 'ended' ? 'warning' : 'system');
      if (state.room.matchState === 'running' && previous !== 'running') showMatchIntro(state.room);
      if (state.room.matchState === 'ended') showResults(data);
    });

    state.socket.on('shield:update', data => {
      const p = state.room?.players?.find(x => x.userId === data.userId);
      if (p) p.shield = data.shield;
      if (data.userId === state.user?.id) sound.play('impact');
      renderRoom();
    });

    state.socket.on('challenge:resolved', data => {
      if (data.userId === state.user?.id && data.message) terminalLog(data.message, data.success ? 'success' : 'danger');
    });

    state.socket.on('progress:update', data => {
      if (data.profile) {
        state.profile = data.profile;
        updateHeader();
        renderCommandCenter();
      }
      if (data.levelUp) showLevelUp(data.levelUp);
    });

    state.socket.on('achievement:unlocked', showAchievement);
    state.socket.on('matchmaking:status', updateQueueStatus);
    state.socket.on('matchmaking:botOffer', data => {
      ui.botOffer.classList.remove('hidden');
      sound.play('warning');
      ui.matchmakingTitle.textContent = data.botsNeeded ? 'HUMAN LOBBY INCOMPLETE' : 'OPERATOR FOUND';
    });
    state.socket.on('matchmaking:found', data => {
      closeOverlay(ui.matchmaking);
      ui.botOffer.classList.add('hidden');
      state.rematchAllowed = Boolean(data.rematchAllowed);
      state.queueMode = null;
      sound.play('match');
      enterRoom(data.room);
    });
    state.socket.on('matchmaking:cancelled', () => {
      closeOverlay(ui.matchmaking);
      state.queueMode = null;
    });
    state.socket.on('matchmaking:error', data => {
      toast(`MATCHMAKING ERROR — ${data.error}`);
      closeOverlay(ui.matchmaking);
      state.queueMode = null;
    });
  }

  function startTraining(replay = false) {
    state.trainingStep = 0;
    state.replayingTraining = replay;
    openOverlay(ui.onboarding);
    renderTrainingStep();
    sound.unlock();
  }

  function renderTrainingStep() {
    const s = trainingSlides[state.trainingStep];
    ui.trainingStepLabel.textContent = `${String(state.trainingStep + 1).padStart(2,'0')} / ${String(trainingSlides.length).padStart(2,'0')}`;
    ui.trainingProgress.style.width = `${((state.trainingStep + 1) / trainingSlides.length) * 100}%`;
    ui.trainingContent.innerHTML = `<p class="kicker">${state.trainingStep === 0 ? 'SYSTEM BOOT' : 'TRAINING MODULE'}</p><h1>${escapeHtml(s.title)}</h1><p>${escapeHtml(s.body)}</p>${s.demo || ''}`;
    ui.trainingBack.disabled = state.trainingStep === 0;
    ui.trainingNext.textContent = s.final ? 'ENTER CYBER ARENA' : 'CONTINUE';
  }

  async function finishTraining() {
    closeOverlay(ui.onboarding);
    if (!state.replayingTraining || !state.profile.onboardingCompleted) {
      try { await api('/api/profile/onboarding-complete', { method: 'POST', body: '{}' }); } catch (err) { console.warn(err); }
      if (state.profile) state.profile.onboardingCompleted = true;
    }
    state.replayingTraining = false;
    showScreen('command');
    renderCommandCenter();
  }

  function nextTraining() {
    if (state.trainingStep >= trainingSlides.length - 1) return finishTraining();
    state.trainingStep += 1;
    sound.play('ui');
    renderTrainingStep();
  }

  function previousTraining() {
    if (state.trainingStep > 0) state.trainingStep -= 1;
    renderTrainingStep();
  }

  async function refreshProfile() {
    const data = await api('/api/profile');
    state.profile = data.profile;
    renderCommandCenter();
    updateHeader();
    return state.profile;
  }

  function showCommandCenter() {
    closeOverlay(ui.resultOverlay);
    showScreen('command');
    refreshProfile().catch(err => console.warn(err));
    renderCommandCenter();
  }

  function openQuickMode() { openOverlay(ui.modeModal); }

  function startMatchmaking(mode) {
    if (!state.socket?.connected) return toast('MATCH SERVER RECONNECTING — try again in a moment.');
    state.queueMode = mode;
    state.queueStartedAt = Date.now();
    ui.matchmakingTitle.textContent = 'SEARCHING FOR OPERATORS';
    ui.queuePlayers.textContent = `1 / ${mode === 'duel' ? 2 : 4}`;
    ui.queueTime.textContent = '00:00';
    ui.queueRegion.textContent = 'AUTO';
    ui.botOffer.classList.add('hidden');
    openOverlay(ui.matchmaking);
    state.socket.emit('matchmaking:join', { mode, handle: state.profile.displayHandle });
  }

  function updateQueueStatus(data) {
    if (data.mode !== state.queueMode) return;
    ui.queuePlayers.textContent = `${data.playersFound} / ${data.targetPlayers}`;
    ui.queueTime.textContent = formatDuration(Math.floor(data.waitedMs / 1000));
    ui.queueRegion.textContent = String(data.region || 'AUTO').toUpperCase();
  }

  function cancelMatchmaking() {
    state.socket?.emit('matchmaking:leave');
    closeOverlay(ui.matchmaking);
    state.queueMode = null;
  }

  function acceptBotFill() {
    if (!state.queueMode) return;
    state.socket?.emit('matchmaking:acceptBot', { mode: state.queueMode, difficulty: ui.botsDifficulty.value || 'standard' });
    ui.botOffer.classList.add('hidden');
    ui.matchmakingTitle.textContent = 'DEPLOYING AI OPERATORS';
  }

  async function launchBotMatch() {
    ui.launchBotMatch.disabled = true;
    try {
      const settings = {
        mode: ui.botsMode.value,
        botCount: Number(ui.botsCount.value),
        difficulty: ui.botsDifficulty.value
      };
      state.lastBotSettings = settings;
      const data = await api('/api/bots/start', { method: 'POST', body: JSON.stringify(settings) });
      state.rematchAllowed = true;
      closeOverlay(ui.botsModal);
      enterRoom(data.room);
      sound.play('match');
    } catch (err) { toast(friendlyError(err)); }
    finally { ui.launchBotMatch.disabled = false; }
  }

  async function launchSolo() {
    try {
      toast('INITIALIZING SOLO TRAINING...');
      const data = await api('/api/solo/start', { method: 'POST', body: JSON.stringify({ difficulty: 'standard' }) });
      state.rematchAllowed = true;
      enterRoom(data.room);
    } catch (err) { toast(friendlyError(err)); }
  }

  async function createPrivate(e) {
    e.preventDefault();
    ui.privateError.textContent = '';
    try {
      const data = await api('/api/rooms/create', {
        method: 'POST',
        body: JSON.stringify({ roomName: ui.roomName.value.trim() || 'Cyber Lab', handle: ui.playerHandle.value.trim(), mode: ui.privateMode.value })
      });
      state.rematchAllowed = true;
      closeOverlay(ui.privateModal);
      enterRoom(data.room);
      toast(`PRIVATE ROOM ${data.room.roomId} READY`);
    } catch (err) { ui.privateError.textContent = friendlyError(err); }
  }

  async function joinPrivate(e) {
    e.preventDefault();
    ui.privateError.textContent = '';
    try {
      const data = await api('/api/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ roomCode: ui.joinCode.value.trim().toUpperCase(), handle: ui.joinHandle.value.trim() })
      });
      state.rematchAllowed = Boolean(data.rematchAllowed);
      closeOverlay(ui.privateModal);
      enterRoom(data.room);
    } catch (err) { ui.privateError.textContent = friendlyError(err); }
  }

  function enterRoom(room, { resumed = false } = {}) {
    state.room = room;
    state.previousMatchState = room.matchState;
    state.activeChallenge = null;
    state.activeTarget = null;
    state.selectedNodeId = null;
    ui.challengeBox.classList.add('hidden');
    showScreen('room');
    ui.roomBadge.classList.remove('hidden');
    ui.roomBadge.textContent = room.quickMatch || room.botMatch || room.solo ? String(room.mode).toUpperCase() : `ROOM ${room.roomId}`;
    state.socket?.emit('room:join', { roomCode: room.roomId });
    renderRoom();
    if (room.matchState === 'running' && !resumed) showMatchIntro(room);
    startMatchClock();
  }

  function renderRoom() {
    const room = state.room;
    if (!room) return;
    const me = room.players.find(p => p.userId === state.user?.id);
    ui.roomTitle.textContent = room.roomName;
    ui.matchProtocolLabel.textContent = room.quickMatch ? 'QUICK MATCH' : room.botMatch ? 'AI TRAINING PROTOCOL' : room.solo ? 'SOLO TRAINING' : `PRIVATE ROOM ${room.roomId}`;
    ui.modeBadge.textContent = String(room.mode).toUpperCase().replaceAll('_',' ');
    ui.matchStateBadge.textContent = String(room.matchState).toUpperCase();
    ui.matchStateBadge.style.color = room.matchState === 'running' ? 'var(--green)' : room.matchState === 'ended' ? 'var(--amber)' : 'var(--cyan)';
    ui.playerCount.textContent = `${room.players.length} NODES`;

    const instructor = room.instructorId === state.user?.id && !room.quickMatch && !room.botMatch && !room.solo;
    ui.instructorControls.classList.toggle('hidden', !instructor || room.matchState !== 'lobby');
    ui.startMatch.disabled = room.matchState !== 'lobby';

    const shield = me?.shield ?? 100;
    ui.shieldValue.textContent = `${shield}%`;
    ui.defenseShield.textContent = shield;
    ui.streakValue.textContent = me?.streak || 0;
    updateShieldArc(shield);

    const teamMode = room.mode === 'teams';
    ui.teamHealth.classList.toggle('hidden', !teamMode);
    ui.leaderboardToggle.classList.toggle('hidden', !teamMode);
    if (teamMode) {
      const red = room.teamHealth?.red ?? 100;
      const blue = room.teamHealth?.blue ?? 100;
      ui.redHealth.style.width = `${red}%`;
      ui.blueHealth.style.width = `${blue}%`;
      ui.redHealthText.textContent = red;
      ui.blueHealthText.textContent = blue;
      if (red <= 25 || blue <= 25) sound.play('warning');
    }

    renderNetworkMap();
    renderNodeInspector();
    renderLeaderboard(room.players.slice().sort((a,b) => b.xp - a.xp));
    updateZContext();
  }

  function updateShieldArc(value) {
    const circumference = 301.6;
    ui.shieldArc.style.strokeDashoffset = String(circumference * (1 - value / 100));
    ui.shieldArc.style.stroke = value <= 25 ? 'var(--red)' : value <= 50 ? 'var(--amber)' : 'var(--cyan)';
  }

  function renderNetworkMap() {
    const room = state.room;
    if (!room) return;
    while (ui.networkMap.firstChild) ui.networkMap.removeChild(ui.networkMap.firstChild);
    const me = room.players.find(p => p.userId === state.user?.id);
    const others = room.players.filter(p => p.userId !== state.user?.id);
    const center = { x: 300, y: 210 };

    others.forEach((p, i) => {
      const angle = (i / Math.max(1, others.length)) * Math.PI * 2 - Math.PI / 2;
      const radius = others.length > 8 ? 155 : 135;
      p.__pos = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', center.x); line.setAttribute('y1', center.y); line.setAttribute('x2', p.__pos.x); line.setAttribute('y2', p.__pos.y); line.setAttribute('class','network-line');
      ui.networkMap.appendChild(line);
    });

    const positions = [{ p: me, pos: center }, ...others.map(p => ({ p, pos: p.__pos }))].filter(x => x.p);
    positions.forEach(({ p, pos }) => {
      const g = document.createElementNS(SVG_NS, 'g');
      const classes = ['network-node'];
      if (p.userId === state.user?.id) classes.push('me');
      if (p.isBot) classes.push('bot');
      if (p.userId === state.selectedNodeId) classes.push('selected');
      if (p.team === 'red') classes.push('team-red');
      if (p.team === 'blue') classes.push('team-blue');
      g.setAttribute('class', classes.join(' '));
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
      g.dataset.id = p.userId;
      const circle = document.createElementNS(SVG_NS,'circle'); circle.setAttribute('r', p.userId === state.user?.id ? '28' : '23');
      const t1 = document.createElementNS(SVG_NS,'text'); t1.setAttribute('y','4'); t1.textContent = p.userId === state.user?.id ? 'YOU' : p.handle.slice(0,12);
      const t2 = document.createElementNS(SVG_NS,'text'); t2.setAttribute('y','39'); t2.setAttribute('class','node-sub'); t2.textContent = `${p.shield}% · L${p.level}`;
      g.append(circle,t1,t2);
      g.addEventListener('click', () => { state.selectedNodeId = p.userId; renderNetworkMap(); renderNodeInspector(); sound.play('ui'); });
      ui.networkMap.appendChild(g);
    });
  }

  function renderNodeInspector() {
    const room = state.room;
    if (!room) return;
    const p = room.players.find(x => x.userId === state.selectedNodeId);
    if (!p) {
      ui.nodeInspector.innerHTML = '<span class="muted">SELECT A SYNTHETIC NODE</span>';
      return;
    }
    const self = p.userId === state.user?.id;
    ui.nodeInspector.innerHTML = `
      <strong>${escapeHtml(p.handle)} ${p.isBot ? '<span style="color:#c084fc">[BOT]</span>' : ''}</strong>
      <div class="node-details"><span>${escapeHtml(p.nodeId)}</span><span>LVL ${p.level}</span><span>${escapeHtml(p.rank)}</span><span>${p.shield}% SHIELD</span>${p.team ? `<span>${escapeHtml(p.team.toUpperCase())} TEAM</span>` : ''}</div>
      <div class="node-actions">${self ? '<button class="btn ghost" id="inspectSelfBtn" type="button">PROFILE</button>' : `<button class="btn primary" id="scanSelectedBtn" type="button">SCAN NODE</button>`}</div>`;
    $('scanSelectedBtn')?.addEventListener('click', () => scanPeer(p.userId));
    $('inspectSelfBtn')?.addEventListener('click', openProfile);
  }

  function renderLeaderboard(players) {
    if (!Array.isArray(players)) return;
    if (state.room?.mode === 'teams' && state.boardMode === 'team') {
      const red = players.filter(p => p.team === 'red').reduce((s,p) => s+p.xp,0);
      const blue = players.filter(p => p.team === 'blue').reduce((s,p) => s+p.xp,0);
      ui.leaderboard.innerHTML = `<div class="rank"><span>#1</span><b>RED TEAM</b><span class="xp">${red} XP</span></div><div class="rank"><span>#2</span><b>BLUE TEAM</b><span class="xp">${blue} XP</span></div>`;
      return;
    }
    ui.leaderboard.innerHTML = players.map((p, idx) => `
      <div class="rank ${p.userId === state.user?.id ? 'me' : ''}"><span>#${idx+1}</span><div><b>${escapeHtml(p.handle)}${p.isBot ? ' [BOT]' : ''}</b><div class="rank-meta">L${p.level} · ${escapeHtml(p.rank)} · ${p.shield}% shield · streak ${p.streak || 0}</div></div><span class="xp">${p.xp} XP</span></div>
    `).join('');
  }

  function addFeed(item) {
    if (!item) return;
    const div = document.createElement('div');
    div.className = 'feed-item';
    const time = new Date(item.at || Date.now()).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    div.innerHTML = `<time>${escapeHtml(time)}</time><span>${escapeHtml(item.message || item.type || 'Activity')}</span><span class="feed-xp">${item.xp ? `+${item.xp} XP` : ''}</span>`;
    ui.feed.prepend(div);
    while (ui.feed.children.length > 70) ui.feed.lastChild.remove();
  }

  async function addPrivateBots() {
    try {
      const data = await api(`/api/rooms/${state.room.roomId}/bots`, { method:'POST', body:JSON.stringify({ count:Number(ui.botCount.value), difficulty:ui.lobbyBotDifficulty.value }) });
      toast(`${data.added} AI OPERATOR${data.added === 1 ? '' : 'S'} DEPLOYED`);
    } catch (err) { toast(friendlyError(err)); }
  }

  async function startPrivateMatch() {
    try {
      ui.startMatch.disabled = true;
      const data = await api(`/api/rooms/${state.room.roomId}/start`, { method:'POST', body:'{}' });
      state.room = data.room;
      renderRoom();
    } catch (err) { toast(friendlyError(err)); ui.startMatch.disabled = false; }
  }

  async function scanPeer(targetUserId) {
    if (!state.room || state.room.matchState !== 'running') return toast('START THE PROTOCOL BEFORE SCANNING.');
    const target = state.room.players.find(p => p.userId === targetUserId);
    if (!target) return;
    state.activeTarget = targetUserId;
    startScanAnimation(target);
    const started = performance.now();
    try {
      const data = await api('/api/game/scan', { method:'POST', body:JSON.stringify({ roomCode:state.room.roomId, targetUserId, category:preferredCategory() }) });
      const remaining = Math.max(0, 850 - (performance.now() - started));
      await delay(remaining);
      finishScanAnimation();
      state.activeChallenge = data.challenge;
      ui.terminalContext.textContent = `${data.target.nodeId} · ${data.target.handle}`;
      showChallenge(data.challenge);
      terminalLog(`scan ${data.target.nodeId}`, 'system');
      terminalLog(`Fictional service discovered: ${data.challenge.fictionalService} ${data.challenge.mockVersion} on simulated port ${data.challenge.mockPort}.`);
      sound.play('scan');
    } catch (err) {
      stopScanAnimation();
      terminalLog(friendlyError(err), 'danger');
      toast(friendlyError(err));
    }
  }

  function preferredCategory() {
    const solved = state.profile?.stats?.challengesSolved || 0;
    return ['logic','sequence','decode','configuration'][solved % 4];
  }

  function startScanAnimation(target) {
    openOverlay(ui.scanOverlay);
    ui.scanTargetLabel.textContent = `SCANNING ${target.nodeId}`;
    ui.scanStatus.textContent = 'Initializing synthetic diagnostic profile...';
    let pct = 3;
    ui.scanPercent.textContent = '3%';
    ui.scanProgressBar.style.width = '3%';
    clearInterval(state.scanTimer);
    state.scanTimer = setInterval(() => {
      pct = Math.min(91, pct + Math.ceil(Math.random() * 8));
      ui.scanPercent.textContent = `${pct}%`;
      ui.scanProgressBar.style.width = `${pct}%`;
      ui.scanStatus.textContent = pct < 35 ? 'Mapping simulated node...' : pct < 68 ? 'Enumerating fictional services...' : 'Generating challenge profile...';
    }, 130);
  }

  function finishScanAnimation() {
    clearInterval(state.scanTimer);
    ui.scanPercent.textContent = '100%';
    ui.scanProgressBar.style.width = '100%';
    ui.scanStatus.textContent = 'CHALLENGE PROFILE READY';
    setTimeout(() => closeOverlay(ui.scanOverlay), 220);
  }

  function stopScanAnimation() {
    clearInterval(state.scanTimer);
    closeOverlay(ui.scanOverlay);
  }

  function showChallenge(c) {
    ui.challengeBox.classList.remove('hidden');
    ui.challengeTitle.textContent = c.displayName;
    ui.challengeType.textContent = String(c.challengeType).toUpperCase();
    ui.challengeDescription.textContent = c.description;
    ui.challengeService.textContent = `${c.fictionalService} ${c.mockVersion}`;
    ui.challengePort.textContent = `PORT ${c.mockPort}`;
    ui.challengePrompt.textContent = c.challengePrompt;
    ui.answerInput.value = '';
    ui.hintOutput.classList.add('hidden');
    updateZContext();
  }

  async function submitAnswer(e) {
    e.preventDefault();
    if (!state.activeChallenge) return;
    const challengeId = state.activeChallenge.challengeId;
    const answer = ui.answerInput.value;
    try {
      const data = await api('/api/exploit/verify', { method:'POST', body:JSON.stringify({ roomCode:state.room.roomId, challengeId, answer }) });
      terminalLog(data.message, data.success ? 'success' : 'danger');
      if (data.success) {
        sound.play('success');
        if (data.levelUp) showLevelUp(data.levelUp);
        (data.achievements || []).forEach(showAchievement);
        ui.challengeBox.classList.add('hidden');
        state.activeChallenge = null;
        requestDebrief(challengeId);
        refreshProfile().catch(()=>{});
      } else {
        sound.play('error');
      }
    } catch (err) { terminalLog(friendlyError(err), 'danger'); }
  }

  async function requestDebrief(challengeId) {
    try {
      const data = await api('/api/ai/debrief', { method:'POST', body:JSON.stringify({ roomCode:state.room.roomId, challengeId }) });
      const d = data.debrief;
      const sections = [
        ['WHAT HAPPENED',d.whatHappened],['WHY THE LOGIC WORKED',d.whyItWorked],['DEFENSIVE CONCEPT',d.defensiveConcept],['ENTERPRISE MITIGATION',d.enterpriseMitigation],['KEY LESSON',d.keyLesson]
      ];
      ui.debriefContent.innerHTML = sections.map(([title,text]) => `<div class="debrief-section"><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div>`).join('');
      openOverlay(ui.debriefModal);
    } catch (err) { console.warn('[debrief]', err); }
  }

  async function requestHint(question = 'Give me a Socratic hint for my current challenge.') {
    if (!state.activeChallenge) {
      addZMessage('Select or scan a synthetic node first so I have challenge context.', 'ai');
      return;
    }
    ui.hintBtn.disabled = true;
    try {
      const data = await api('/api/ai/hint', { method:'POST', body:JSON.stringify({ roomCode:state.room.roomId, challengeId:state.activeChallenge.challengeId, question, terminalHistory:state.terminalHistory.slice(-10) }) });
      ui.hintOutput.textContent = data.hint;
      ui.hintOutput.classList.remove('hidden');
      addZMessage(data.hint, 'ai');
    } catch (err) {
      const msg = friendlyError(err);
      ui.hintOutput.textContent = msg;
      ui.hintOutput.classList.remove('hidden');
      addZMessage(msg, 'ai');
    } finally { ui.hintBtn.disabled = false; }
  }

  async function compilePatch() {
    if (!state.room) return;
    try {
      const data = await api('/api/defense/patch', { method:'POST', body:JSON.stringify({ roomCode:state.room.roomId }) });
      terminalLog(data.message, 'success');
      sound.play('patch');
      (data.achievements || []).forEach(showAchievement);
    } catch (err) { terminalLog(friendlyError(err), 'danger'); }
  }

  function handleTerminal(e) {
    e.preventDefault();
    const raw = ui.terminalInput.value.trim();
    ui.terminalInput.value = '';
    if (!raw) return;
    state.terminalHistory.push(raw);
    state.terminalHistory = state.terminalHistory.slice(-60);
    state.historyIndex = state.terminalHistory.length;
    terminalLog(`operator@arena:~$ ${raw}`);
    sound.play('terminal');
    const [cmdRaw, ...args] = raw.split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const room = state.room;
    const me = room?.players?.find(p => p.userId === state.user?.id);

    switch (cmd) {
      case 'help': openGuide(); terminalLog(`Commands: ${COMMANDS.join(', ')}`, 'system'); break;
      case 'status': terminalLog(room ? `Protocol ${room.mode.toUpperCase()} · state ${room.matchState.toUpperCase()} · ${room.players.length} synthetic nodes.` : 'No active operation.'); break;
      case 'profile': openProfile(); break;
      case 'peers': terminalLog((room?.players || []).map(p => `${p.handle} [${p.nodeId}] L${p.level} ${p.shield}%${p.isBot ? ' BOT' : ''}`).join('\n') || 'No nodes visible.'); break;
      case 'scan': {
        const name = args.join(' ').toLowerCase();
        const target = room?.players?.find(p => p.handle.toLowerCase() === name || p.nodeId.toLowerCase() === name);
        if (!target) terminalLog('Unknown synthetic node. Use peers to list valid handles.', 'danger');
        else if (target.userId === state.user?.id) terminalLog('Self-scan is not an offensive action.', 'warning');
        else scanPeer(target.userId);
        break;
      }
      case 'shield': terminalLog(`Defense shield: ${me?.shield ?? 100}%${me?.xp !== undefined ? ` · Match XP: ${me.xp}` : ''}.`, 'system'); break;
      case 'patch': compilePatch(); break;
      case 'leaderboard': terminalLog((room?.players || []).slice().sort((a,b)=>b.xp-a.xp).map((p,i)=>`#${i+1} ${p.handle} — ${p.xp} XP`).join('\n')); break;
      case 'match': terminalLog(room ? `${room.roomName} · ${room.mode.toUpperCase()} · ${room.matchState.toUpperCase()} · ${formatDuration(matchElapsedSeconds())}` : 'No active match.'); break;
      case 'team': terminalLog(room?.mode === 'teams' ? `RED ${room.teamHealth.red}% · BLUE ${room.teamHealth.blue}% · You: ${String(me?.team || 'none').toUpperCase()}` : 'Team integrity is only active in Team Battle.'); break;
      case 'hint': requestHint('What should I focus on next? Give a Socratic hint without the answer.'); break;
      case 'clear': ui.terminalLog.innerHTML = ''; break;
      case 'whoami': terminalLog(`${state.profile.displayHandle} · LEVEL ${state.profile.accountLevel} · ${state.profile.rank} · ${state.profile.accountXp} account XP.`, 'system'); break;
      case 'missions': terminalLog(room?.mode === 'classic' ? 'Mission: reach 600 match XP first.' : room?.mode === 'solo' ? 'Mission: solve three training-node challenges.' : room?.mode === 'duel' ? 'Mission: reduce your rival shield to 0%.' : room?.mode === 'teams' ? 'Mission: reduce opposing team integrity to 0%.' : 'Choose a protocol from Command Center.'); break;
      case 'stats': terminalLog(`Matches ${state.profile.stats.matchesPlayed} · Wins ${state.profile.stats.wins} · Solved ${state.profile.stats.challengesSolved} · Best streak ${state.profile.stats.bestStreak}.`); break;
      case 'achievements': openProfile('achievements'); break;
      case 'tutorial': startTraining(true); break;
      default: terminalLog('Unknown simulator command. Type help. No operating-system shell is available.', 'danger');
    }
  }

  function terminalKeydown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!state.terminalHistory.length) return;
      state.historyIndex = Math.max(0, state.historyIndex - 1);
      ui.terminalInput.value = state.terminalHistory[state.historyIndex] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.historyIndex = Math.min(state.terminalHistory.length, state.historyIndex + 1);
      ui.terminalInput.value = state.terminalHistory[state.historyIndex] || '';
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const token = ui.terminalInput.value.trim().split(/\s+/)[0].toLowerCase();
      const match = COMMANDS.find(c => c.startsWith(token));
      if (match) ui.terminalInput.value = match + (match === 'scan' ? ' ' : '');
    }
  }

  function renderCommandSuggestions() {
    ui.commandSuggestions.innerHTML = ['help','peers','shield','patch','leaderboard','hint'].map(cmd => `<button type="button" data-command="${cmd}">${cmd}</button>`).join('');
    ui.commandSuggestions.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => { ui.terminalInput.value = btn.dataset.command; ui.terminalInput.focus(); }));
  }

  function openGuide() {
    const guide = [
      ['help','Open this command library.'],['status','Show the current simulated protocol and node count.'],['profile','Open persistent account progression and statistics.'],['peers','List visible synthetic classroom nodes.'],['scan <handle>','Open a server-generated fictional challenge for a selected node.'],['shield','Show current shield integrity and match XP.'],['patch','Spend 50 match XP to restore simulated shield integrity.'],['leaderboard','Print current match standings.'],['match','Show active protocol, state, and elapsed time.'],['team','Show Red/Blue integrity in Team Battle.'],['hint','Ask Z-Shield for a Socratic hint.'],['whoami','Show operator level, rank, and persistent XP.'],['missions','Explain the current match objective.'],['stats','Show persistent operator statistics.'],['achievements','Open the achievement dossier.'],['tutorial','Replay Operator Training.'],['clear','Clear local terminal output.']
    ];
    ui.commandGuide.innerHTML = guide.map(([cmd,desc]) => `<div class="guide-command"><code>&gt; ${escapeHtml(cmd)}</code><span>${escapeHtml(desc)}</span></div>`).join('') + '<div class="guide-command"><code>TRICK</code><span>Use ↑/↓ for command history and Tab for completion. This terminal is a fixed simulator command parser and never executes OS commands.</span></div>';
    openOverlay(ui.guideModal);
  }

  async function openProfile(section = '') {
    try {
      const [profileData, achievementData] = await Promise.all([api('/api/profile'), api('/api/achievements')]);
      state.profile = profileData.profile;
      renderCommandCenter();
      const p = state.profile;
      ui.profileModalLevel.textContent = String(p.accountLevel).padStart(2,'0');
      ui.profileModalHandle.textContent = p.displayHandle;
      ui.profileModalRank.textContent = p.rank;
      ui.profileXpText.textContent = `${p.xpIntoLevel} / ${p.xpForNextLevel} · ${p.accountXp} TOTAL`;
      ui.profileXpBar.style.width = `${percentIntoLevel(p)}%`;
      ui.profileHandleInput.value = p.displayHandle;
      const stats = [
        ['MATCHES',p.stats.matchesPlayed],['WINS',p.stats.wins],['LOSSES',p.stats.losses],['DUEL WINS',p.stats.duelWins],['TEAM WINS',p.stats.teamWins],['BOT WINS',p.stats.botWins],['SOLVED',p.stats.challengesSolved],['PATCHES',p.stats.successfulPatches],['BEST STREAK',p.stats.bestStreak],['ACCURACY',p.stats.totalAttempts ? `${Math.round((p.stats.successfulAttempts/p.stats.totalAttempts)*100)}%` : '—']
      ];
      ui.profileStatsGrid.innerHTML = stats.map(([label,value]) => `<div class="profile-stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join('');
      const unlocked = new Map(p.achievements.map(a => [a.key,a]));
      ui.achievementGrid.innerHTML = Object.entries(achievementData.catalog).map(([key,a]) => `<div class="achievement-card ${unlocked.has(key) ? 'unlocked' : ''}"><b>${escapeHtml(a.name)}</b><span>${escapeHtml(a.description)}</span><span>${unlocked.has(key) ? 'UNLOCKED' : 'LOCKED'}</span></div>`).join('');
      ui.historyList.innerHTML = p.recentMatches.length ? p.recentMatches.map(m => `<div class="history-item"><div><b>${escapeHtml(String(m.mode).toUpperCase())}</b><span>${escapeHtml(String(m.result || '—').toUpperCase())}</span></div><div><small>${formatDate(m.finishedAt || m.startedAt)}</small><small>${m.matchXp} match XP</small></div></div>`).join('') : '<div class="empty-state">No completed operations.</div>';
      openOverlay(ui.profileModal);
      if (section === 'achievements') setTimeout(() => ui.achievementGrid.scrollIntoView({ behavior:'smooth', block:'center' }), 120);
    } catch (err) { toast(friendlyError(err)); }
  }

  async function updateHandle(e) {
    e.preventDefault();
    try {
      const data = await api('/api/profile/handle', { method:'POST', body:JSON.stringify({ handle:ui.profileHandleInput.value.trim() }) });
      state.profile = data.profile;
      renderCommandCenter();
      ui.profileModalHandle.textContent = state.profile.displayHandle;
      toast('DISPLAY HANDLE UPDATED');
    } catch (err) { toast(friendlyError(err)); }
  }

  function openZShield() { ui.zDrawer.classList.add('open'); ui.zDrawer.setAttribute('aria-hidden','false'); updateZContext(); }
  function closeZShield() { ui.zDrawer.classList.remove('open'); ui.zDrawer.setAttribute('aria-hidden','true'); }
  function updateZContext() {
    ui.zContext.textContent = state.activeChallenge ? `${state.activeChallenge.displayName} · ${String(state.activeChallenge.challengeType).toUpperCase()} · Z-Shield will not reveal the canonical answer.` : 'Select a challenge to activate contextual mentoring.';
  }
  function addZMessage(text, who) {
    const div = document.createElement('div'); div.className = `z-message ${who}`; div.textContent = text; ui.zMessages.appendChild(div); ui.zMessages.scrollTop = ui.zMessages.scrollHeight;
  }
  async function sendZQuestion(question) {
    const q = String(question || '').trim(); if (!q) return;
    addZMessage(q,'user');
    await requestHint(q);
  }

  function showMatchIntro(room) {
    if (!room?.matchId || state.introShownForMatchId === room.matchId) return;
    state.introShownForMatchId = room.matchId;
    openOverlay(ui.introOverlay);
    const me = room.players.find(p => p.userId === state.user?.id);
    let html = '';
    if (room.mode === 'duel') {
      const other = room.players.find(p => p.userId !== state.user?.id);
      html = `<div class="intro-vs"><div class="intro-player">${escapeHtml(me?.handle || 'YOU')}<small>${escapeHtml(me?.nodeId || '')}</small></div><div class="intro-vs-mark">VS</div><div class="intro-player">${escapeHtml(other?.handle || 'RIVAL')}<small>${escapeHtml(other?.nodeId || '')}</small></div></div>`;
    } else if (room.mode === 'teams') {
      html = `<div class="intro-title"><span style="color:#ef6479">RED TEAM</span><br><span style="font-size:.35em;color:#708aa0">VS</span><br><span style="color:#5d96ff">BLUE TEAM</span></div>`;
    } else if (room.mode === 'solo') {
      html = `<div class="intro-title">TRAINING NODE ONLINE</div><p class="kicker">DIFFICULTY ${escapeHtml(String(room.botDifficulty).toUpperCase())}</p>`;
    } else {
      html = `<div class="intro-title">NETWORK INITIALIZED</div><p class="kicker">${room.players.length} NODES DETECTED</p>`;
    }
    ui.introContent.innerHTML = html;
    sound.play('match');
    let count = 3;
    const counter = document.createElement('div'); counter.className = 'intro-count'; counter.textContent = count; ui.introContent.appendChild(counter);
    const timer = setInterval(() => {
      count -= 1;
      if (count > 0) { counter.textContent = count; sound.play('ui'); }
      else if (count === 0) { counter.textContent = room.mode === 'duel' ? 'BREACH' : 'BEGIN'; }
      else { clearInterval(timer); closeOverlay(ui.introOverlay); }
    }, 650);
  }

  async function showResults(data = {}) {
    if (!state.room?.matchId || state.resultShownForMatchId === state.room.matchId) return;
    state.resultShownForMatchId = state.room.matchId;
    const me = state.room.players.find(p => p.userId === state.user?.id);
    const winner = data.winner ?? state.room.winner;
    const won = state.room.mode === 'teams' ? me?.team === winner : me?.userId === winner;
    const neutral = !winner;
    ui.resultTitle.textContent = neutral ? 'MISSION COMPLETE' : won ? 'VICTORY' : 'SYSTEM BREACHED';
    ui.resultTitle.style.color = won ? 'var(--cyan)' : neutral ? 'var(--amber)' : 'var(--red)';
    ui.resultSubtitle.textContent = state.room.mode === 'teams' ? `${String(winner || '—').toUpperCase()} TEAM NETWORK DOMINATED` : data.message || (won ? `${me?.handle} secured the operation.` : 'Opponent secured the operation.');
    const resultMe = data.results?.find(p => p.userId === state.user?.id) || me || {};
    ui.resultStats.innerHTML = [
      ['MATCH XP',resultMe.xp || 0],['SOLVED',resultMe.solved ?? '—'],['ACCURACY',resultMe.accuracy !== undefined ? `${resultMe.accuracy}%` : '—'],['PATCHES',resultMe.patches ?? '—']
    ].map(([label,value]) => `<div><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join('');
    await delay(250);
    try { await refreshProfile(); } catch {}
    ui.resultXpBar.style.width = `${percentIntoLevel()}%`;
    ui.resultXpText.textContent = state.profile ? `LEVEL ${state.profile.accountLevel} · ${state.profile.xpIntoLevel}/${state.profile.xpForNextLevel} XP` : '';
    ui.rematch.classList.toggle('hidden', !state.rematchAllowed);
    openOverlay(ui.resultOverlay);
    sound.play(won ? 'victory' : 'warning');
  }

  async function rematch() {
    if (!state.room) return;
    try {
      closeOverlay(ui.resultOverlay);
      state.resultShownForMatchId = null;
      state.introShownForMatchId = null;
      const data = await api(`/api/rooms/${state.room.roomId}/rematch`, { method:'POST', body:'{}' });
      state.room = data.room;
      renderRoom();
    } catch (err) { toast(friendlyError(err)); }
  }

  function showLevelUp(levelUp) {
    if (!levelUp) return;
    ui.levelUpNumber.textContent = `LEVEL ${levelUp.to}`;
    ui.levelUpRank.textContent = levelUp.rank;
    ui.levelUp.classList.remove('hidden');
    sound.play('level');
    setTimeout(() => ui.levelUp.classList.add('hidden'), 2600);
  }

  function showAchievement(a) {
    if (!a) return;
    ui.achievementToastName.textContent = a.name || a.key;
    ui.achievementToastDesc.textContent = a.description || '';
    ui.achievementToast.classList.remove('hidden');
    sound.play('achievement');
    clearTimeout(showAchievement.timer);
    showAchievement.timer = setTimeout(() => ui.achievementToast.classList.add('hidden'), 4200);
  }

  function startMatchClock() {
    clearInterval(state.matchTimer);
    const tick = () => { ui.matchTimer.textContent = formatDuration(matchElapsedSeconds()); };
    tick(); state.matchTimer = setInterval(tick, 1000);
  }

  function matchElapsedSeconds() {
    if (!state.room?.startedAt) return 0;
    const end = state.room.endedAt || Date.now();
    return Math.max(0, Math.floor((end - state.room.startedAt) / 1000));
  }

  function formatDuration(total) {
    const m = Math.floor(total / 60); const s = total % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, ms || 0))); }

  const sound = (() => {
    let ctx = null;
    let muted = localStorage.getItem('cyberArenaMuted') === '1';
    function unlock() { if (!ctx) try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} }
    function tone(freq, duration=.08, type='sine', gain=.025, slide=0) {
      if (muted) return; unlock(); if (!ctx) return;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime); if (slide) o.frequency.linearRampToValueAtTime(freq+slide, ctx.currentTime+duration);
      g.gain.setValueAtTime(gain, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime+duration);
      o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime+duration);
    }
    function play(name) {
      if (muted) return;
      const map = {
        ui:()=>tone(520,.045,'square',.012,50), terminal:()=>tone(660,.025,'square',.008,-80), scan:()=>{tone(260,.12,'sine',.02,300);setTimeout(()=>tone(720,.08,'sine',.016),100)},
        success:()=>{tone(480,.08,'sine',.02,120);setTimeout(()=>tone(720,.12,'sine',.02,120),70)}, error:()=>tone(150,.16,'sawtooth',.018,-40), impact:()=>tone(110,.12,'square',.025,-30),
        patch:()=>{tone(350,.08,'triangle',.015,100);setTimeout(()=>tone(520,.08,'triangle',.015,80),80)}, match:()=>{tone(220,.11,'sine',.02,100);setTimeout(()=>tone(440,.13,'sine',.02,140),120)},
        warning:()=>tone(190,.18,'square',.015,0), victory:()=>{tone(440,.12,'sine',.02,120);setTimeout(()=>tone(660,.14,'sine',.022,120),120);setTimeout(()=>tone(880,.2,'sine',.02),250)},
        level:()=>{tone(330,.1,'triangle',.02,200);setTimeout(()=>tone(660,.16,'triangle',.02,250),110)}, achievement:()=>{tone(740,.07,'sine',.016);setTimeout(()=>tone(980,.12,'sine',.018),80)}, join:()=>tone(580,.07,'sine',.012,80)
      };
      map[name]?.();
    }
    function toggle() { muted = !muted; localStorage.setItem('cyberArenaMuted', muted ? '1':'0'); ui.sound.textContent = muted ? '×' : '♪'; toast(muted ? 'AUDIO MUTED' : 'AUDIO ONLINE'); if (!muted) play('ui'); }
    function init() { ui.sound.textContent = muted ? '×' : '♪'; }
    return { unlock, play, toggle, init };
  })();

  function initBackground() {
    const canvas = $('cyberBg');
    const ctx = canvas.getContext('2d');
    let w=0,h=0,dpr=1,raf=0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const particles = Array.from({ length: reduced ? 20 : 58 }, () => ({ x:Math.random(), y:Math.random(), vx:(Math.random()-.5)*.00011, vy:(Math.random()-.5)*.00011, r:Math.random()*1.3+.3 }));
    function resize(){dpr=Math.min(2,devicePixelRatio||1);w=innerWidth;h=innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.setTransform(dpr,0,0,dpr,0,0)}
    function draw(){
      ctx.clearRect(0,0,w,h);
      ctx.strokeStyle='rgba(34,211,238,.035)';ctx.lineWidth=1;
      const grid=48;for(let x=0;x<w;x+=grid){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}for(let y=0;y<h;y+=grid){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
      particles.forEach(p=>{if(!reduced){p.x+=p.vx;p.y+=p.vy;if(p.x<0)p.x=1;if(p.x>1)p.x=0;if(p.y<0)p.y=1;if(p.y>1)p.y=0}ctx.fillStyle='rgba(34,211,238,.25)';ctx.beginPath();ctx.arc(p.x*w,p.y*h,p.r,0,Math.PI*2);ctx.fill()});
      for(let i=0;i<particles.length;i++)for(let j=i+1;j<particles.length;j++){const a=particles[i],b=particles[j],dx=(a.x-b.x)*w,dy=(a.y-b.y)*h,d=Math.hypot(dx,dy);if(d<125){ctx.strokeStyle=`rgba(34,211,238,${(1-d/125)*.06})`;ctx.beginPath();ctx.moveTo(a.x*w,a.y*h);ctx.lineTo(b.x*w,b.y*h);ctx.stroke()}}
      if(!reduced && !document.hidden) raf=requestAnimationFrame(draw);
    }
    addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!reduced){cancelAnimationFrame(raf);draw()}});resize();draw();
  }

  function bindEvents() {
    ui.loginTab.addEventListener('click',()=>setAuthMode('login')); ui.signupTab.addEventListener('click',()=>setAuthMode('signup')); ui.authForm.addEventListener('submit',handleAuth);
    ui.logout.addEventListener('click',()=>logout()); ui.sound.addEventListener('click',sound.toggle); ui.help.addEventListener('click',openGuide); ui.brandHome.addEventListener('click',showCommandCenter);
    ui.quickMatch.addEventListener('click',openQuickMode); ui.botsMatch.addEventListener('click',()=>openOverlay(ui.botsModal)); ui.duelMatch.addEventListener('click',()=>startMatchmaking('duel')); ui.teamMatch.addEventListener('click',()=>startMatchmaking('teams')); ui.soloTraining.addEventListener('click',launchSolo); ui.privateMatch.addEventListener('click',()=>openOverlay(ui.privateModal));
    ui.profileBtn.addEventListener('click',()=>openProfile()); ui.achievementsBtn.addEventListener('click',()=>openProfile('achievements')); ui.historyBtn.addEventListener('click',()=>openProfile('history')); ui.tutorialBtn.addEventListener('click',()=>startTraining(true));
    document.querySelectorAll('[data-queue-mode]').forEach(btn=>btn.addEventListener('click',()=>{closeOverlay(ui.modeModal);startMatchmaking(btn.dataset.queueMode)}));
    document.querySelectorAll('.close-modal').forEach(btn=>btn.addEventListener('click',()=>closeOverlay($(btn.dataset.close))));
    ui.cancelMatchmaking.addEventListener('click',cancelMatchmaking); ui.keepSearching.addEventListener('click',()=>ui.botOffer.classList.add('hidden')); ui.acceptBot.addEventListener('click',acceptBotFill);
    ui.botsDifficulty.addEventListener('change',()=>ui.difficultyInfo.textContent=DIFFICULTY_COPY[ui.botsDifficulty.value]); ui.botsMode.addEventListener('change',()=>{if(ui.botsMode.value==='duel')ui.botsCount.value='1';if(ui.botsMode.value==='teams'&&Number(ui.botsCount.value)<3)ui.botsCount.value='3'}); ui.launchBotMatch.addEventListener('click',launchBotMatch);
    ui.createPrivateForm.addEventListener('submit',createPrivate); ui.joinPrivateForm.addEventListener('submit',joinPrivate); ui.handleForm.addEventListener('submit',updateHandle);
    ui.addBots.addEventListener('click',addPrivateBots); ui.startMatch.addEventListener('click',startPrivateMatch); ui.leaveView.addEventListener('click',showCommandCenter);
    ui.terminalForm.addEventListener('submit',handleTerminal); ui.terminalInput.addEventListener('keydown',terminalKeydown); ui.answerForm.addEventListener('submit',submitAnswer); ui.hintBtn.addEventListener('click',()=>{openZShield();requestHint()}); ui.closeChallenge.addEventListener('click',()=>ui.challengeBox.classList.add('hidden')); ui.patch.addEventListener('click',compilePatch);
    ui.leaderboardToggle.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{state.boardMode=btn.dataset.board;ui.leaderboardToggle.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b===btn));renderLeaderboard(state.room?.players?.slice().sort((a,b)=>b.xp-a.xp)||[])}));
    ui.trainingNext.addEventListener('click',nextTraining); ui.trainingBack.addEventListener('click',previousTraining); ui.skipTraining.addEventListener('click',finishTraining);
    ui.zFab.addEventListener('click',openZShield); ui.closeZ.addEventListener('click',closeZShield); ui.zDrawer.querySelectorAll('[data-z-action]').forEach(btn=>btn.addEventListener('click',()=>{const q={hint:'Give me a Socratic hint without the answer.',concept:'Explain the defensive concept behind this puzzle without giving the answer.',attempts:'Review my attempts and tell me what reasoning pattern I may be missing.',look:'What should I inspect or calculate next? Do not reveal the answer.'}[btn.dataset.zAction];sendZQuestion(q)}));
    ui.zForm.addEventListener('submit',e=>{e.preventDefault();const q=ui.zInput.value.trim();ui.zInput.value='';sendZQuestion(q)});
    ui.rematch.addEventListener('click',rematch); ui.resultQuick.addEventListener('click',()=>{closeOverlay(ui.resultOverlay);showCommandCenter();openQuickMode()}); ui.resultHome.addEventListener('click',showCommandCenter);
    document.addEventListener('pointerdown',sound.unlock,{once:true});
  }

  function init() {
    sound.init(); initBackground(); renderCommandSuggestions(); bindEvents(); setAuthMode('login'); restoreSession();
  }

  init();
})();
