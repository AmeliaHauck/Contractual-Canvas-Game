// Drawing Game Client
const socket = io();
let canvas, ctx;
let isDrawing = false;
let isEraser = false;
let currentColor = '#ef4444';
const pencilCursorSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cg transform='rotate(-45 16 16)'%3E%3Crect x='14' y='4' width='4' height='18' rx='1' fill='%23f4c430' stroke='%23333' stroke-width='1'/%3E%3Cpolygon points='14,4 18,4 16,1' fill='%23f8d7a8' stroke='%23333' stroke-width='1'/%3E%3Cpolygon points='14,22 18,22 16,28' fill='%23333' stroke='%23333' stroke-width='1'/%3E%3Crect x='14' y='22' width='4' height='2' fill='%23d97706'/%3E%3Crect x='14' y='24' width='4' height='2' fill='%23fbbf24'/%3E%3Crect x='14' y='26' width='4' height='2' fill='%23111827'/%3E%3C/g%3E%3C/svg%3E";
const eraserCursorSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cg transform='rotate(-35 16 16)'%3E%3Cpath d='M10 7h10a2 2 0 0 1 2 2v11H8V9a2 2 0 0 1 2-2Z' fill='%23f59e0b' stroke='%23333' stroke-width='1.5'/%3E%3Cpath d='M8 18h14v5a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-5Z' fill='%23fde68a' stroke='%23333' stroke-width='1.5'/%3E%3Cpath d='M8 18h14' stroke='%23333' stroke-width='1.5'/%3E%3C/g%3E%3C/svg%3E";

// Cursor hotspots (SVG origin for tip)
const pencilHotspot = { x: 16, y: 28 };
const eraserHotspot = { x: 14, y: 20 };
const pencilCursor = `url("${pencilCursorSvg}") ${pencilHotspot.x} ${pencilHotspot.y}, crosshair`;
const eraserCursor = `url("${eraserCursorSvg}") ${eraserHotspot.x} ${eraserHotspot.y}, cell`;

socket.on('connect', () => {
  playerId = socket.id;
  console.log('Connected with socket id', playerId);
});
let currentSize = 3;
let eraserSize = 10;
let gameId = null;
let playerId = socket.id;
let teamId = null;
let playerName = null;
let currentDrawer = null;
let currentDrawerName = null;
let drawingHistory = [];
let promptChoices = null;
let promptChoiceTimeout = null;
let promptChoiceInterval = null;
let currentPromptOptions = [];
let currentPromptHintLevel = 0;
let finalGuessers = {};
let finalGuessActive = false;
let canDraw = false;
let activePrompt = '';
let preRoundCountdownInterval = null;
let intermissionCountdownInterval = null;
let liveRoundTimerInterval = null;
let lastDrawPoint = null;
let remoteDrawerCursor = null;
let lastCursorEmitAt = 0;
let fitViewportFrame = 0;
let hostGameStarted = false;
let bypassPromptSelection = false; // set true for drawing-board-only mode (now false to enable manual prompt buttons)
let gameJoined = false;
const allowedStarters = new Set(['amelia', 'marlene']);
const DEFAULT_ROUND_DURATION = 90;
const PROMPT_CHOICE_DURATION_SECONDS = 20;
const PROMPT_CHOICE_FALLBACK_MS = 25000;

function canUseHostControls() {
  return allowedStarters.has((playerName || '').trim().toLowerCase());
}

function fitGameToViewport() {
  const shellFrame = document.getElementById('appShellFrame');
  const appShell = document.getElementById('appShell');
  if (!shellFrame || !appShell) return;

  appShell.style.transform = 'scale(1)';

  const availableWidth = Math.max(shellFrame.clientWidth - 8, 1);
  const availableHeight = Math.max(shellFrame.clientHeight - 8, 1);
  const requiredWidth = Math.max(appShell.scrollWidth, 1);
  const requiredHeight = Math.max(appShell.scrollHeight, 1);
  const nextScale = Math.min(1, availableWidth / requiredWidth, availableHeight / requiredHeight);

  appShell.style.transform = `scale(${nextScale})`;
}

function scheduleFitGameToViewport() {
  if (fitViewportFrame) {
    cancelAnimationFrame(fitViewportFrame);
  }

  fitViewportFrame = requestAnimationFrame(() => {
    fitViewportFrame = 0;
    fitGameToViewport();

    if (canvas) {
      resizeCanvas();
    }
  });
}

// Initialize canvas
window.addEventListener('DOMContentLoaded', () => {
  // Ensure setup modal is visible and game is hidden
  document.getElementById('setupModal').style.display = 'flex';
  document.getElementById('gameContainer').style.display = 'none';
  document.getElementById('promptChoiceModal').classList.add('hidden');
  document.getElementById('intermissionModal').classList.add('hidden');
  
  canvas = document.getElementById('drawingCanvas');
  if (!canvas) {
    console.log('[DEBUG] Canvas element not found!');
    return;
  }
  ctx = canvas.getContext('2d');
  remoteDrawerCursor = document.createElement('div');
  remoteDrawerCursor.id = 'remoteDrawerCursor';
  remoteDrawerCursor.className = 'remote-drawer-cursor';
  document.body.appendChild(remoteDrawerCursor);
  
  // Set canvas size
  resizeCanvas();
  setTimeout(() => {
    scheduleFitGameToViewport();
    console.log('[DEBUG] Forced resize after DOMContentLoaded. Canvas size:', canvas.width, canvas.height);
  }, 200);
  window.addEventListener('resize', scheduleFitGameToViewport);

  // Canvas drawing events
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mousemove', handleCanvasHover);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', handleCanvasLeave);
  canvas.addEventListener('pointerdown', startDrawing);
  canvas.addEventListener('pointermove', draw);
  canvas.addEventListener('pointermove', handleCanvasHover);
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointerleave', handleCanvasLeave);
  canvas.style.touchAction = 'none';

  // Touch events for mobile
  canvas.addEventListener('touchstart', handleTouchStart);
  canvas.addEventListener('touchmove', handleTouchMove);
  canvas.addEventListener('touchend', stopDrawing);

  // Brush controls
  document.getElementById('colorPicker').addEventListener('change', (e) => {
    selectColor(e.target.value);
  });

  document.getElementById('brushSize').addEventListener('input', (e) => {
    currentSize = parseInt(e.target.value);
  });

  document.getElementById('eraserSize').addEventListener('input', (e) => {
    eraserSize = parseInt(e.target.value);
  });

  updateToolButtons();
  updateDrawingControlsVisibility();
  scheduleFitGameToViewport();

  const gameContainer = document.getElementById('gameContainer');
  if (gameContainer && window.MutationObserver) {
    const viewportObserver = new MutationObserver(() => {
      scheduleFitGameToViewport();
    });

    viewportObserver.observe(gameContainer, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }
});

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.floor(rect.width));
  const nextHeight = Math.max(1, Math.floor(rect.height));

  if (canvas.width === nextWidth && canvas.height === nextHeight) {
    return;
  }

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  redrawCanvas();
}

function normalizeName(value) {
  return (value || '').trim().toLowerCase();
}

function hasDrawAccess() {
  return canDraw;
}

function setGuessInputVisibility(isVisible) {
  const guessInput = document.getElementById('guessInput');
  if (!guessInput) return;
  guessInput.style.display = isVisible ? 'block' : 'none';
}

function setPromptHighlight(isHighlighted) {
  const promptText = document.getElementById('promptText');
  if (!promptText) return;
  promptText.classList.toggle('drawer-prompt', isHighlighted);
}

function clearGuessHistory() {
  const guessHistoryList = document.getElementById('guessHistoryList');
  if (!guessHistoryList) return;
  guessHistoryList.innerHTML = '';
}

function renderGuessHistory(entries) {
  clearGuessHistory();
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (entry?.type === 'hint') {
      appendGuessHistoryHint(entry.text || '');
      continue;
    }

    appendGuessHistoryEntry(entry?.player || 'Player', entry?.guess || '');
  }
}

function normalizePromptOption(option, difficulty) {
  if (typeof option === 'string') {
    return {
      text: option,
      difficulty,
      drawerHint: 'Draw the most recognizable symbols or scene for this concept.',
      guesserHints: []
    };
  }

  return {
    text: option.text,
    difficulty,
    drawerHint: option.drawerHint || 'Draw the most recognizable symbols or scene for this concept.',
    guesserHints: Array.isArray(option.guesserHints) ? option.guesserHints : []
  };
}

function hideGuesserHintModal() {
  const modal = document.getElementById('guesserHintModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function clearPromptChoiceTimers() {
  if (promptChoiceTimeout) {
    clearTimeout(promptChoiceTimeout);
    promptChoiceTimeout = null;
  }

  if (promptChoiceInterval) {
    clearInterval(promptChoiceInterval);
    promptChoiceInterval = null;
  }
}

function hidePromptChoiceModal() {
  clearPromptChoiceTimers();
  currentPromptOptions = [];

  const modal = document.getElementById('promptChoiceModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function stopLiveRoundTimer() {
  if (liveRoundTimerInterval) {
    clearInterval(liveRoundTimerInterval);
    liveRoundTimerInterval = null;
  }
}

function resetTimerDisplay(duration = DEFAULT_ROUND_DURATION) {
  const timerEl = document.getElementById('timer');
  if (!timerEl) return;

  timerEl.textContent = `${duration} seconds`;
  timerEl.classList.remove('warning');
}

function clearRoundUiState() {
  clearPromptChoiceTimers();

  if (preRoundCountdownInterval) {
    clearInterval(preRoundCountdownInterval);
    preRoundCountdownInterval = null;
  }

  stopLiveRoundTimer();
  hideIntermissionModal();
}

function applyCanvasSnapshot(snapshot) {
  redrawCanvas();
  drawingHistory = [];

  if (!snapshot) {
    return;
  }

  const image = new Image();
  image.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  };
  image.src = snapshot;
}

function sendCanvasSnapshot() {
  if (!gameId || !canvas) return;
  socket.emit('canvas_snapshot', {
    gameId,
    snapshot: canvas.toDataURL('image/png')
  });
}

function startSyncedPreRoundCountdown(remainingSeconds) {
  let remaining = Math.max(0, remainingSeconds || 0);

  if (preRoundCountdownInterval) {
    clearInterval(preRoundCountdownInterval);
  }

  document.getElementById('guessInput').disabled = true;
  setGuessInputVisibility(true);
  setPromptHighlight(true);
  setCanvasStatus(`${currentDrawerName || 'The drawer'} is drawing this round.`, 'locked');

  const updateCountdown = () => {
    if (remaining > 0) {
      document.getElementById('promptText').textContent = `Get ready to start guessing in ${remaining}...`;
      remaining -= 1;
      return;
    }

    clearInterval(preRoundCountdownInterval);
    preRoundCountdownInterval = null;
    document.getElementById('promptText').textContent = 'Get ready to start guessing... GO';
  };

  updateCountdown();
  if (remaining >= 0) {
    preRoundCountdownInterval = setInterval(updateCountdown, 1000);
  }
}

function showIntermissionState(data) {
  hostGameStarted = true;
  const modal = document.getElementById('intermissionModal');
  const title = document.getElementById('intermissionTitle');
  const message = document.getElementById('intermissionMessage');
  const prompt = document.getElementById('intermissionPrompt');
  const countdown = document.getElementById('intermissionCountdown');
  let remaining = data.seconds ?? 10;

  if (!modal || !title || !message || !prompt || !countdown) return;

  hideIntermissionModal();
  hideRemoteDrawerCursor();
  hideGuesserHintModal();
  modal.querySelector('.intermission-card')?.classList.remove('success');

  if (data.reason === 'correct_guess') {
    modal.querySelector('.intermission-card')?.classList.add('success');
    title.innerHTML = [
      '<span class="intermission-title-celebration">',
      '<span class="intermission-title-trophy" aria-hidden="true">🏆</span>',
      '<span class="intermission-title-main">Nice one!</span>',
      '<span class="intermission-title-trophy" aria-hidden="true">🏆</span>',
      '<span class="intermission-title-confetti" aria-hidden="true"></span>',
      '</span>'
    ].join('');
    const awardedPoints = Number(data.pointsAwarded) || 0;
    const pointLabel = awardedPoints === 1 ? 'point' : 'points';
    const teamLabel = data.teamName || 'A team';
    message.innerHTML = [
      `${data.player || 'A player'} guessed the word.`,
      `${teamLabel} has earned ${awardedPoints} ${pointLabel}!`,
      'The prompt was:'
    ].join('<br>');
  } else {
    title.textContent = 'Shucks...';
    message.innerHTML = [
      'No one could guess the answer!',
      'The prompt was:'
    ].join('<br>');
  }

  prompt.textContent = data.prompt ? `"${data.prompt}"` : '';
  countdown.textContent = `Next round starts in ${remaining}...`;
  modal.classList.remove('hidden');

  intermissionCountdownInterval = setInterval(() => {
    remaining -= 1;

    if (remaining <= 0) {
      countdown.textContent = 'Starting next round...';
      clearInterval(intermissionCountdownInterval);
      intermissionCountdownInterval = null;
      return;
    }

    countdown.textContent = `Next round starts in ${remaining}...`;
  }, 1000);

  updateHostControls();
}

function hideGameOverModal() {
  const modal = document.getElementById('gameOverModal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

function getPodiumTeams(data) {
  const teams = Object.entries(data?.teams || {}).map(([teamId, team]) => ({
    teamId,
    teamName: team.name,
    score: team.score || 0
  }));

  teams.sort((left, right) => right.score - left.score);
  return teams.slice(0, 3);
}

function buildPodiumMarkup(teams) {
  const slots = [
    { className: 'second', team: teams[1] || null, label: 'Second Place' },
    { className: 'first', team: teams[0] || null, label: 'First Place', crown: true },
    { className: 'third', team: teams[2] || null, label: 'Third Place' }
  ];

  return slots.map((slot) => {
    if (!slot.team) {
      return `
        <div class="podium-tier ${slot.className}">
          ${slot.crown ? '<div class="podium-crown" aria-hidden="true">👑</div>' : ''}
          <div class="podium-rank">${slot.label}</div>
          <div class="podium-team">-</div>
          <div class="podium-score">No team</div>
        </div>
      `;
    }

    return `
      <div class="podium-tier ${slot.className}">
        ${slot.crown ? '<div class="podium-crown" aria-hidden="true">👑</div>' : ''}
        <div class="podium-rank">${slot.label}</div>
        <div class="podium-team">${slot.team.teamName}</div>
        <div class="podium-score">${slot.team.score} point${slot.team.score === 1 ? '' : 's'}</div>
      </div>
    `;
  }).join('');
}

function showGameOverCelebration(data) {
  const modal = document.getElementById('gameOverModal');
  const title = document.getElementById('gameOverTitle');
  const subtitle = document.getElementById('gameOverSubtitle');
  const winnerLine = document.getElementById('gameOverWinnerLine');
  const podium = document.getElementById('gameOverPodium');
  const footer = document.getElementById('gameOverFooter');
  if (!modal || !title || !subtitle || !winnerLine || !podium || !footer) return;

  const podiumTeams = getPodiumTeams(data);
  const winner = data?.winner;
  const tiedTeams = Array.isArray(data?.tiedTeams) ? data.tiedTeams : [];

  if (winner?.teamName) {
    title.textContent = 'Champions!';
    subtitle.innerHTML = 'The final standings are in.<br>First place goes to...';
    winnerLine.innerHTML = [
      '<span class="game-over-trophy" aria-hidden="true">🏆</span>',
      '<span class="game-over-winner-team">',
      winner.teamName,
      '</span>',
      '<span class="game-over-trophy" aria-hidden="true">🏆</span>'
    ].join('');
  } else if (tiedTeams.length > 1) {
    title.textContent = 'Photo Finish!';
    subtitle.innerHTML = 'The game ended in a tie between:';
    winnerLine.innerHTML = tiedTeams.map((team) => `<span class="game-over-winner-team">${team.teamName}</span>`).join(' &nbsp; ');
  } else {
    title.textContent = 'Game Over';
    subtitle.textContent = 'The final standings are in.';
    winnerLine.textContent = 'No winner this time.';
  }

  podium.innerHTML = buildPodiumMarkup(podiumTeams);
  footer.textContent = 'Restart the game to crown the next winner.';
  modal.classList.remove('hidden');
}

function syncJoinedPlayerState(state) {
  if (!state) return;

  clearRoundUiState();
  hidePromptChoiceModal();
  hideRemoteDrawerCursor();
  hideGuesserHintModal();
  hideGameOverModal();
  stopDrawing();

  currentDrawer = state.currentDrawer || null;
  currentDrawerName = state.currentDrawerName || null;
  if (state.assignedTeam) {
    teamId = state.assignedTeam;
  }

  if (state.teams) {
    updateTeamsDisplay(state.teams);
  }

  renderGuessHistory(state.guessHistory || []);
  applyCanvasSnapshot(state.canvasSnapshot);

  finalGuessActive = false;
  canDraw = false;
  activePrompt = '';
  updateDrawingControlsVisibility();

  const drawingTeamName = state.currentDrawingTeam && state.teams?.[state.currentDrawingTeam]?.name
    ? state.teams[state.currentDrawingTeam].name
    : 'A team';
  const remainingSeconds = Math.max(0, Number(state.remainingSeconds) || 0);

  switch (state.phase) {
    case 'prompt_selection':
      hostGameStarted = true;
      setGuessInputVisibility(true);
      setPromptHighlight(false);
      setCanvasStatus(`${state.currentDrawerName || 'The drawer'} is drawing this round.`, 'locked');
      document.getElementById('promptText').textContent = `${drawingTeamName} is drawing. ${state.currentDrawerName || 'A player'} is selecting a prompt...`;
      document.getElementById('guessInput').disabled = true;
      resetTimerDisplay(state.roundDuration ?? DEFAULT_ROUND_DURATION);
      break;
    case 'countdown':
      hostGameStarted = true;
      resetTimerDisplay(state.roundDuration ?? DEFAULT_ROUND_DURATION);
      startSyncedPreRoundCountdown(remainingSeconds);
      break;
    case 'live':
      hostGameStarted = true;
      setGuessInputVisibility(true);
      setPromptHighlight(true);
      setCanvasStatus(`${state.currentDrawerName || 'The drawer'} is drawing this round.`, 'locked');
      document.getElementById('promptText').textContent = '🧠 GO! Start guessing now.';
      document.getElementById('guessInput').disabled = false;
      resetTimerDisplay(remainingSeconds || state.roundDuration || DEFAULT_ROUND_DURATION);
      break;
    case 'intermission':
      setGuessInputVisibility(true);
      setPromptHighlight(false);
      document.getElementById('guessInput').disabled = false;
      setCanvasStatus('Round ended. Waiting for the next round.', 'waiting');
      document.getElementById('promptText').textContent = state.currentPrompt ? `"${state.currentPrompt}"` : 'Round ended.';
      showIntermissionState({ ...(state.intermission || {}), seconds: remainingSeconds, prompt: state.currentPrompt });
      break;
    case 'game_over':
      hostGameStarted = false;
      setGuessInputVisibility(true);
      setPromptHighlight(false);
      document.getElementById('guessInput').disabled = false;
      setCanvasStatus('Game ended. Waiting for the host to start the next game.', 'waiting');
      if (state.gameOverPayload?.winner?.teamName) {
        document.getElementById('promptText').textContent = `${state.gameOverPayload.winner.teamName} wins the game.`;
      } else {
        document.getElementById('promptText').textContent = 'Game over.';
      }
      showGameOverCelebration(state.gameOverPayload || { teams: state.teams || {} });
      break;
    case 'lobby':
    default:
      hostGameStarted = false;
      setGuessInputVisibility(true);
      setPromptHighlight(false);
      document.getElementById('guessInput').disabled = false;
      document.getElementById('promptText').textContent = 'Waiting for game to start...';
      resetTimerDisplay();
      setCanvasStatus('Waiting for the host to start the game.', 'waiting');
      break;
  }

  updateHostControls();
}

function showGuesserHintModal(hintNumber, hintText) {
  const modal = document.getElementById('guesserHintModal');
  const title = document.getElementById('guesserHintTitle');
  const body = document.getElementById('guesserHintBody');
  if (!modal || !title || !body) return;

  title.textContent = `Hint ${hintNumber}`;
  body.textContent = hintText;
  modal.classList.remove('hidden');

  window.setTimeout(() => {
    hideGuesserHintModal();
  }, 6000);
}

function appendGuessHistoryEntry(player, guess) {
  const guessHistoryList = document.getElementById('guessHistoryList');
  if (!guessHistoryList) return;

  const entry = document.createElement('li');
  entry.innerHTML = `<strong>${player}</strong>: <span class="guess-history-word">${guess}</span>`;
  // Insert at the top
  guessHistoryList.insertBefore(entry, guessHistoryList.firstChild);
}

function appendGuessHistoryHint(hintText) {
  const guessHistoryList = document.getElementById('guessHistoryList');
  if (!guessHistoryList) return;

  const entry = document.createElement('li');
  entry.innerHTML = `<span class="guess-history-hint">HINT: ${String(hintText || '').toUpperCase()}</span>`;
  guessHistoryList.insertBefore(entry, guessHistoryList.firstChild);
}

function updateDrawingControlsVisibility() {
  const toolActions = document.querySelector('.tool-actions');
  const toolSettings = document.querySelector('.tool-settings');

  if (toolActions) {
    toolActions.style.display = hasDrawAccess() ? 'flex' : 'none';
  }

  if (toolSettings) {
    toolSettings.style.display = hasDrawAccess() ? 'flex' : 'none';
  }
}

function hideRemoteDrawerCursor() {
  if (!remoteDrawerCursor) return;
  remoteDrawerCursor.classList.remove('visible');
}

function showRemoteDrawerCursor(x, y, useEraser) {
  if (!remoteDrawerCursor || !canvas || canDraw) return;

  const rect = canvas.getBoundingClientRect();
  remoteDrawerCursor.style.left = `${rect.left + x}px`;
  remoteDrawerCursor.style.top = `${rect.top + y}px`;
  remoteDrawerCursor.style.backgroundImage = `url("${useEraser ? eraserCursorSvg : pencilCursorSvg}")`;
  remoteDrawerCursor.classList.add('visible');
}

function getCanvasSizeBasis() {
  return Math.max(Math.min(canvas?.width || 0, canvas?.height || 0), 1);
}

function normalizeCanvasPoint(x, y) {
  return {
    xRatio: canvas?.width ? x / canvas.width : 0,
    yRatio: canvas?.height ? y / canvas.height : 0
  };
}

function denormalizeCanvasPoint(xRatio, yRatio, fallbackX, fallbackY) {
  if (typeof xRatio === 'number' && typeof yRatio === 'number' && canvas) {
    return {
      x: xRatio * canvas.width,
      y: yRatio * canvas.height
    };
  }

  return {
    x: fallbackX,
    y: fallbackY
  };
}

function normalizeToolSize(size) {
  return size / getCanvasSizeBasis();
}

function denormalizeToolSize(sizeRatio, fallbackSize) {
  if (typeof sizeRatio === 'number') {
    return Math.max(1, sizeRatio * getCanvasSizeBasis());
  }

  return fallbackSize;
}

function emitCursorPosition(x, y) {
  if (!hasDrawAccess() || !gameId) return;

  const now = Date.now();
  if (now - lastCursorEmitAt < 16) {
    return;
  }

  lastCursorEmitAt = now;
  const { xRatio, yRatio } = normalizeCanvasPoint(x, y);
  socket.emit('cursor_move', {
    gameId,
    x,
    y,
    xRatio,
    yRatio,
    isEraser
  });
}

function emitCursorHide() {
  if (!gameId) return;
  socket.emit('cursor_hide', { gameId });
}

function getCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  // Offset by cursor hotspot so drawing is from the tip
  let offset = isEraser ? eraserHotspot : pencilHotspot;
  return {
    x: clientX - rect.left - offset.x + 1, // +1 for pixel-perfect alignment
    y: clientY - rect.top - offset.y + 1
  };
}

function drawLocalSegment(startX, startY, endX, endY, erasing, toolSize = erasing ? eraserSize : currentSize) {
  if (erasing) {
    ctx.clearRect(endX - toolSize / 2, endY - toolSize / 2, toolSize, toolSize);
    return;
  }

  ctx.lineWidth = toolSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = currentColor;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
}

function drawLocalDot(x, y, erasing, toolSize = erasing ? eraserSize : currentSize) {
  if (erasing) {
    ctx.clearRect(x - toolSize / 2, y - toolSize / 2, toolSize, toolSize);
    return;
  }

  ctx.fillStyle = currentColor;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(toolSize / 2, 1), 0, Math.PI * 2);
  ctx.fill();
}

function startDrawing(e) {
  if (!hasDrawAccess()) {
    console.log('[DEBUG] No draw access. canDraw:', canDraw, 'gameId:', gameId);
    return;
  }
  // Only start drawing for left mouse button or primary pointer
  if ((e.type === 'mousedown' && e.button !== 0) || (e.type === 'pointerdown' && e.button !== 0)) {
    console.log('[DEBUG] Not left mouse button or primary pointer:', e.type, e.button);
    return;
  }
  isDrawing = true;
  const { x, y } = getCanvasPoint(e.clientX, e.clientY);
  lastDrawPoint = { x, y };
  saveDrawingState();
  drawLocalDot(x, y, isEraser);
  emitCursorPosition(x, y);
  const startPoint = normalizeCanvasPoint(x, y);
  const toolSize = isEraser ? eraserSize : currentSize;
  const toolSizeRatio = normalizeToolSize(toolSize);

  console.log('[DEBUG] Emitting draw (start):', { gameId, x, y, color: currentColor, size: currentSize, isEraser });
  socket.emit('draw', {
    gameId,
    x0: x,
    y0: y,
    x1: x,
    y1: y,
    x0Ratio: startPoint.xRatio,
    y0Ratio: startPoint.yRatio,
    x1Ratio: startPoint.xRatio,
    y1Ratio: startPoint.yRatio,
    color: currentColor,
    size: toolSize,
    sizeRatio: toolSizeRatio,
    isEraser
  });
}

function draw(e) {
  const { x, y } = getCanvasPoint(e.clientX, e.clientY);

  if (hasDrawAccess()) {
    emitCursorPosition(x, y);
  }

  // Only draw if left mouse button is pressed (for mouse events)
  if ((e.type === 'mousemove' && e.buttons !== undefined && (e.buttons & 1) === 0)) {
    //console.log('[DEBUG] Mousemove but left button not pressed.');
    return;
  }
  if (!isDrawing || !hasDrawAccess()) {
    //console.log('[DEBUG] Not drawing or no draw access.', { isDrawing, canDraw });
    return;
  }

  const startX = lastDrawPoint ? lastDrawPoint.x : x;
  const startY = lastDrawPoint ? lastDrawPoint.y : y;

  drawLocalSegment(startX, startY, x, y, isEraser);
  lastDrawPoint = { x, y };
  const startPoint = normalizeCanvasPoint(startX, startY);
  const endPoint = normalizeCanvasPoint(x, y);
  const toolSize = isEraser ? eraserSize : currentSize;
  const toolSizeRatio = normalizeToolSize(toolSize);

  // Send drawing to others
  console.log('[DEBUG] Emitting draw (move):', { gameId, startX, startY, x, y, color: currentColor, size: currentSize, isEraser });
  socket.emit('draw', {
    gameId,
    x0: startX,
    y0: startY,
    x1: x,
    y1: y,
    x0Ratio: startPoint.xRatio,
    y0Ratio: startPoint.yRatio,
    x1Ratio: endPoint.xRatio,
    y1Ratio: endPoint.yRatio,
    color: currentColor,
    size: toolSize,
    sizeRatio: toolSizeRatio,
    isEraser
  });
}

function stopDrawing() {
  const wasDrawing = isDrawing;
  isDrawing = false;
  lastDrawPoint = null;
  try {
    ctx.closePath();
  } catch (err) {
    console.log('[DEBUG] ctx.closePath error:', err);
  }

  if (wasDrawing && hasDrawAccess()) {
    sendCanvasSnapshot();
  }
}

function handleCanvasHover(e) {
  if (!hasDrawAccess()) return;
  const { x, y } = getCanvasPoint(e.clientX, e.clientY);
  emitCursorPosition(x, y);
}

function handleCanvasLeave() {
  stopDrawing();
  if (hasDrawAccess()) {
    emitCursorHide();
  }
}

function handleTouchStart(e) {
  if (!hasDrawAccess()) return;
  const touch = e.touches[0];
  const { x, y } = getCanvasPoint(touch.clientX, touch.clientY);

  isDrawing = true;
  lastDrawPoint = { x, y };
  saveDrawingState();
  drawLocalDot(x, y, isEraser);
  emitCursorPosition(x, y);
  const startPoint = normalizeCanvasPoint(x, y);
  const toolSize = isEraser ? eraserSize : currentSize;
  const toolSizeRatio = normalizeToolSize(toolSize);

  console.log('[DEBUG] Emitting draw (touch start):', { gameId, x, y, color: currentColor, size: currentSize, isEraser });
  socket.emit('draw', {
    gameId,
    x0: x,
    y0: y,
    x1: x,
    y1: y,
    x0Ratio: startPoint.xRatio,
    y0Ratio: startPoint.yRatio,
    x1Ratio: startPoint.xRatio,
    y1Ratio: startPoint.yRatio,
    color: currentColor,
    size: toolSize,
    sizeRatio: toolSizeRatio,
    isEraser
  });
}

function handleTouchMove(e) {
  if (!isDrawing || !hasDrawAccess()) return;
  e.preventDefault();
    const previousState = drawingHistory.pop();
    if (previousState) {
      ctx.putImageData(previousState, 0, 0);
    } else {
      redrawCanvas();
    }
    socket.emit('undo', {
      gameId,
      snapshot: canvas.toDataURL('image/png')
    });
  emitCursorPosition(x, y);
  const startX = lastDrawPoint ? lastDrawPoint.x : x;
  const startY = lastDrawPoint ? lastDrawPoint.y : y;

  drawLocalSegment(startX, startY, x, y, isEraser);
  lastDrawPoint = { x, y };
  const startPoint = normalizeCanvasPoint(startX, startY);
  const endPoint = normalizeCanvasPoint(x, y);
  const toolSize = isEraser ? eraserSize : currentSize;
  const toolSizeRatio = normalizeToolSize(toolSize);

  socket.emit('draw', {
    gameId,
    x0: startX,
    y0: startY,
    x1: x,
    y1: y,
    x0Ratio: startPoint.xRatio,
    y0Ratio: startPoint.yRatio,
    x1Ratio: endPoint.xRatio,
    y1Ratio: endPoint.yRatio,
    color: currentColor,
    size: toolSize,
    sizeRatio: toolSizeRatio,
    isEraser
  });
}

function toggleEraser() {
  if (!hasDrawAccess()) return;
  isEraser = !isEraser;
  updateToolButtons();
}

function selectColor(color) {
  if (!hasDrawAccess()) return;
  currentColor = color;
  isEraser = false;
  updateToolButtons();
}

function selectBrush() {
  if (!hasDrawAccess()) return;
  isEraser = false;
  updateToolButtons();
}

function updateToolButtons() {
  const eraserBtn = document.getElementById('eraserBtn');
  const brushBtn = document.getElementById('brushBtn');
  const colorPicker = document.getElementById('colorPicker');
  const swatches = document.querySelectorAll('.color-swatch');

  if (brushBtn) {
    brushBtn.classList.toggle('active-tool', !isEraser);
    brushBtn.classList.toggle('inactive-tool', isEraser);
    brushBtn.textContent = isEraser ? 'Brush' : 'Brush Selected';
  }

  if (eraserBtn) {
    eraserBtn.classList.toggle('active-tool', isEraser);
    eraserBtn.classList.toggle('inactive-tool', !isEraser);
    eraserBtn.textContent = isEraser ? 'Eraser Selected' : 'Eraser';
  }

  if (colorPicker) {
    colorPicker.value = currentColor;
  }

  swatches.forEach((swatch) => {
    swatch.classList.toggle('active', !isEraser && swatch.dataset.color.toLowerCase() === currentColor.toLowerCase());
  });

  if (canvas) {
    canvas.style.cursor = isEraser ? eraserCursor : pencilCursor;
  }
}

function setCanvasStatus(message, state = 'waiting') {
  const banner = document.getElementById('canvasStatusBanner');
  if (!banner) return;

  banner.textContent = message;
  banner.classList.remove('ready', 'waiting', 'locked');
  banner.classList.add(state);
}

function hideIntermissionModal() {
  const modal = document.getElementById('intermissionModal');
  if (intermissionCountdownInterval) {
    clearInterval(intermissionCountdownInterval);
    intermissionCountdownInterval = null;
  }
  if (modal) {
    modal.classList.add('hidden');
  }
}

function undoDrawing() {
  if (!hasDrawAccess()) return;
  if (drawingHistory.length > 0) {
    drawingHistory.pop();
    redrawCanvas();
    socket.emit('undo', {
      gameId,
      snapshot: canvas.toDataURL('image/png')
    });
  }
}

function redrawCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function saveDrawingState() {
  drawingHistory.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
}

function clearCanvas() {
  if (!hasDrawAccess()) return;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawingHistory = [];
  socket.emit('clear_canvas', {
    gameId,
    snapshot: canvas.toDataURL('image/png')
  });
}

function startNewRound() {
  if (!canUseHostControls()) {
    showNotification('Only Amelia or Marlene can start the next round.');
    return;
  }

  socket.emit('next_round', gameId);
}

function restartRound() {
  if (!canUseHostControls()) {
    showNotification('Only Amelia or Marlene can restart the round.');
    return;
  }

  socket.emit('restart_round', gameId);
}

function endGame() {
  if (!canUseHostControls()) {
    showNotification('Only Amelia or Marlene can end the game.');
    return;
  }

  socket.emit('end_game', gameId);
}

function restartGame() {
  if (!canUseHostControls()) {
    showNotification('Only Amelia or Marlene can restart the game.');
    return;
  }

  socket.emit('restart_game', gameId);
}

function addPointsToTeam() {
  if (!canUseHostControls()) {
    showNotification('Only Amelia or Marlene can add points.');
    return;
  }

  const teamSelect = document.getElementById('hostTeamSelect');
  const pointInput = document.getElementById('hostPointInput');
  const teamId = teamSelect?.value;
  const points = parseInt(pointInput?.value || '0', 10);

  if (!teamId || Number.isNaN(points) || points <= 0) {
    showNotification('Enter a valid team and point amount.');
    return;
  }

  socket.emit('add_points', { gameId, teamId, points });
}

function removePointsFromTeam() {
  if (!canUseHostControls()) {
    showNotification('Only Amelia or Marlene can remove points.');
    return;
  }

  const teamSelect = document.getElementById('hostTeamSelect');
  const pointInput = document.getElementById('hostPointInput');
  const teamId = teamSelect?.value;
  const points = parseInt(pointInput?.value || '0', 10);

  if (!teamId || Number.isNaN(points) || points <= 0) {
    showNotification('Enter a valid team and point amount.');
    return;
  }

  socket.emit('remove_points', { gameId, teamId, points });
}

function togglePrimaryHostAction() {
  if (hostGameStarted) {
    endGame();
    return;
  }

  startGameRound();
}

function updateHostControls() {
  const canControlRounds = canUseHostControls();
  const hostControls = document.getElementById('hostControls');
  const primaryBtn = document.getElementById('hostPrimaryBtn');
  const restartBtn = document.getElementById('hostRestartRoundBtn');
  const nextBtn = document.getElementById('hostNextRoundBtn');
  const restartGameBtn = document.getElementById('hostRestartGameBtn');
  const modalRestartGameBtn = document.getElementById('gameOverRestartGameBtn');
  const addPointsBtn = document.getElementById('hostAddPointsBtn');
  const removePointsBtn = document.getElementById('hostRemovePointsBtn');
  const teamSelect = document.getElementById('hostTeamSelect');
  const pointInput = document.getElementById('hostPointInput');

  if (hostControls) {
    hostControls.classList.toggle('visible', canControlRounds);
  }

  if (primaryBtn) {
    primaryBtn.textContent = hostGameStarted ? 'End Game' : 'Start Game';
    primaryBtn.classList.toggle('host-primary-end', hostGameStarted);
    primaryBtn.disabled = false;
  }

  if (restartBtn) {
    restartBtn.disabled = !hostGameStarted;
  }

  if (nextBtn) {
    nextBtn.disabled = !hostGameStarted;
  }

  if (restartGameBtn) {
    restartGameBtn.disabled = false;
  }

  if (modalRestartGameBtn) {
    modalRestartGameBtn.classList.toggle('hidden', !canControlRounds);
    modalRestartGameBtn.disabled = false;
  }

  if (addPointsBtn) {
    addPointsBtn.disabled = false;
  }

  if (removePointsBtn) {
    removePointsBtn.disabled = false;
  }

  if (teamSelect) {
    teamSelect.disabled = !canControlRounds;
  }

  if (pointInput) {
    pointInput.disabled = !canControlRounds;
  }

  scheduleFitGameToViewport();
}

function startGameRound() {
  if (!canUseHostControls()) {
    showNotification('Only Amelia or Marlene can start the game.');
    return;
  }

  console.log('Starting game round...');
  const primaryBtn = document.getElementById('hostPrimaryBtn');
  if (primaryBtn) primaryBtn.disabled = true;
  socket.emit('start_game', gameId);
}

function handleGuessKeypress(e) {
  if (e.key === 'Enter') {
    const guess = document.getElementById('guessInput').value.trim();
    if (!guess) return;

    if (finalGuessActive) {
      if (!teamId || finalGuessers[teamId] !== playerId) {
        showNotification('🔒 Final guess is locked for your team. Wait for your turn.');
        return;
      }
    } else {
      if (playerId === currentDrawer) return;
    }

    socket.emit('guess', { gameId, guess });
    document.getElementById('guessInput').value = '';
  }
}

function joinGame() {
  gameId = 'contractual-canvas';
  playerName = document.getElementById('playerName').value.trim() || `Player${playerId.slice(0, 4)}`;
  const teamId = null; // auto-assigned by server for balanced teams

  if (!playerName) {
    alert('Please enter your name');
    return;
  }

  updateHostControls();

  socket.emit('join_game', {
    gameId,
    playerName,
    teamId,
    teamsUserPrincipalName: null
  });

  gameJoined = true;
  document.getElementById('setupModal').style.display = 'none';
  document.getElementById('gameContainer').style.display = 'flex';
  setCanvasStatus('Waiting for the host to start the game.', 'waiting');
  scheduleFitGameToViewport();

  // DO NOT auto-start game - wait for explicit button
}

// Socket event listeners
socket.on('player_joined', (data) => {
  updateTeamsDisplay(data.teams);
  showNotification(data.notification);

  // Determine own team from the updated teams structure.
  const ownTeamEntry = Object.entries(data.teams).find(([, team]) =>
    team.players.some(p => p.id === playerId)
  );
  if (ownTeamEntry) {
    teamId = ownTeamEntry[0];
  }
});

socket.on('game_state_sync', (state) => {
  syncJoinedPlayerState(state);
});

socket.on('start_game_denied', (data) => {
  const primaryBtn = document.getElementById('hostPrimaryBtn');
  if (primaryBtn) primaryBtn.disabled = false;
  showNotification(data.message || 'You cannot start the game.');
  updateHostControls();
});

socket.on('next_round_denied', (data) => {
  const nextBtn = document.getElementById('hostNextRoundBtn');
  if (nextBtn) nextBtn.disabled = false;
  showNotification(data.message || 'You cannot start the next round.');
  updateHostControls();
});

socket.on('restart_round_denied', (data) => {
  const restartBtn = document.getElementById('hostRestartRoundBtn');
  if (restartBtn) restartBtn.disabled = false;
  showNotification(data.message || 'You cannot restart the round.');
  updateHostControls();
});

socket.on('end_game_denied', (data) => {
  const primaryBtn = document.getElementById('hostPrimaryBtn');
  const restartGameBtn = document.getElementById('hostRestartGameBtn');
  if (primaryBtn) primaryBtn.disabled = false;
  if (restartGameBtn) restartGameBtn.disabled = false;
  showNotification(data.message || 'You cannot end the game.');
  updateHostControls();
});

socket.on('restart_game_denied', (data) => {
  const restartGameBtn = document.getElementById('hostRestartGameBtn');
  if (restartGameBtn) restartGameBtn.disabled = false;
  showNotification(data.message || 'You cannot restart the game.');
  updateHostControls();
});

socket.on('add_points_denied', (data) => {
  showNotification(data.message || 'You cannot add points.');
  updateHostControls();
});

socket.on('remove_points_denied', (data) => {
  showNotification(data.message || 'You cannot remove points.');
  updateHostControls();
});

socket.on('score_updated', (data) => {
  if (data.teams) {
    updateTeamsDisplay(data.teams);
  }
  showNotification(data.message || 'Score updated.');
  updateHostControls();
});

socket.on('guess_logged', (data) => {
  appendGuessHistoryEntry(data.player || 'Player', data.guess || '');
});

socket.on('guesser_hint', (data) => {
  if (canDraw) return;
  if (!data?.text) return;
  currentPromptHintLevel = Math.max(currentPromptHintLevel, data.hintNumber || 0);
  appendGuessHistoryHint(data.text);
  showGuesserHintModal(data.hintNumber || 1, data.text);
  showNotification(`Hint ${data.hintNumber || 1}: ${data.text}`);
});

socket.on('round_started', (data) => {
  // Only process if game has been joined
  if (!gameJoined) {
    console.log('Ignoring round_started - game not yet joined');
    return;
  }

  finalGuessActive = false;
  canDraw = false;
  activePrompt = '';
  clearRoundUiState();
  hideRemoteDrawerCursor();
  hideGuesserHintModal();
  clearGuessHistory();
  currentPromptHintLevel = 0;
  hostGameStarted = true;
  currentDrawer = data.drawer;
  currentDrawerName = data.drawerName || data.selection?.drawerName || null;
  promptChoices = data.choices;
  finalGuessers = {};
  resetTimerDisplay(data.duration ?? DEFAULT_ROUND_DURATION);
  const isDrawer = normalizeName(playerName) === normalizeName(currentDrawerName);
  const selection = data.selection;
  const drawingTeamName = selection?.teamName || 'A team';
  const drawerName = selection?.drawerName || 'A player';

  console.log('=== ROUND STARTED ===');
  console.log('My ID:', playerId);
  console.log('Drawer ID:', currentDrawer);
  console.log('Am I the drawer?', isDrawer);
  updateDrawingControlsVisibility();

  if (isDrawer) {
    setGuessInputVisibility(false);
    setPromptHighlight(false);
    setCanvasStatus('You are drawing this round. Pick your prompt.', 'waiting');
    document.getElementById('promptText').textContent = `${drawingTeamName} is drawing. Your prompt is up next.`;
    showNotification(`${drawingTeamName} draws first. ${drawerName}, choose the prompt.`);
    if (bypassPromptSelection) {
      console.log('Bypass prompt selection active — auto selecting first prompt.');
      hidePromptChoiceModal();
      const autoPrompt = data.choices?.easy?.[0] || data.choices?.medium?.[0] || data.choices?.hard?.[0];
      if (autoPrompt) {
        selectPrompt(autoPrompt);
      } else {
        console.log('No prompt available to auto-select. Showing prompt choice modal.');
        showPromptChoiceModal(data.choices);
      }
    } else {
      console.log('Showing prompt modal for drawer');
      showPromptChoiceModal(data.choices);
    }
  } else {
    setGuessInputVisibility(true);
    setPromptHighlight(false);
    setCanvasStatus(`${drawerName} is drawing this round.`, 'locked');
    console.log('Hiding prompt modal for guesser');
    document.getElementById('promptText').textContent = `${drawingTeamName} is drawing. ${drawerName} is selecting a prompt...`;
    document.getElementById('guessInput').disabled = true;
    hidePromptChoiceModal();
    showNotification(`${drawingTeamName} draws first. ${drawerName} is choosing a prompt.`);
  }

  redrawCanvas();
  drawingHistory = [];
  updateHostControls();
});

socket.on('round_prompt_selected', (data) => {
  // Prompt has been chosen. Start the shared ready countdown.
  currentDrawer = data.drawer;
  currentDrawerName = data.drawerName || currentDrawerName;
  const isDrawer = playerId === currentDrawer || normalizeName(playerName) === normalizeName(currentDrawerName);
  const countdownSeconds = data.countdown ?? 5;
  let remaining = countdownSeconds;

  canDraw = false;
  document.getElementById('guessInput').disabled = true;
  updateDrawingControlsVisibility();
  resetTimerDisplay(data.duration ?? DEFAULT_ROUND_DURATION);

  if (preRoundCountdownInterval) {
    clearInterval(preRoundCountdownInterval);
  }

  if (isDrawer) {
    setGuessInputVisibility(false);
    setPromptHighlight(true);
    setCanvasStatus('You are drawing this round.', 'waiting');
    document.getElementById('promptText').textContent = `🖌️ Draw: ${activePrompt}`;
    showNotification(`Get ready to draw in ${countdownSeconds}...`);
  } else {
    setGuessInputVisibility(true);
    setPromptHighlight(true);
    setCanvasStatus(`${currentDrawerName || 'The drawer'} is drawing this round.`, 'locked');
    document.getElementById('promptText').textContent = `Get ready to start guessing in ${remaining}...`;
    showNotification(`Get ready to guess in ${countdownSeconds}...`);
  }

  preRoundCountdownInterval = setInterval(() => {
    remaining -= 1;

    if (remaining > 0) {
      if (isDrawer) {
        setPromptHighlight(true);
        setCanvasStatus(`You are drawing this round. Starts in ${remaining}...`, 'waiting');
        document.getElementById('promptText').textContent = `🖌️ Draw: ${activePrompt} | Start in ${remaining}...`;
      } else {
        setPromptHighlight(true);
        setCanvasStatus(`${currentDrawerName || 'The drawer'} is drawing this round. Starts in ${remaining}...`, 'locked');
        document.getElementById('promptText').textContent = `Get ready to start guessing in ${remaining}...`;
      }
      return;
    }

    clearInterval(preRoundCountdownInterval);
    preRoundCountdownInterval = null;

    if (isDrawer) {
      setPromptHighlight(true);
      setCanvasStatus('You are drawing this round.', 'ready');
      document.getElementById('promptText').textContent = `🖌️ Draw: ${activePrompt} | GO`;
    } else {
      setPromptHighlight(true);
      setCanvasStatus(`${currentDrawerName || 'The drawer'} is drawing this round.`, 'locked');
      document.getElementById('promptText').textContent = 'Get ready to start guessing... GO';
    }
  }, 1000);
});

socket.on('round_live_started', (data) => {
  hostGameStarted = true;
  currentDrawer = data.drawer;
  currentDrawerName = data.drawerName || currentDrawerName;
  const isDrawer = Boolean(data.canDraw);
  const duration = data.duration;
  const startTime = Date.now();

  canDraw = isDrawer;
  stopLiveRoundTimer();
  resetTimerDisplay(duration);
  hideRemoteDrawerCursor();
  document.getElementById('guessInput').disabled = isDrawer;
  updateDrawingControlsVisibility();

  if (isDrawer) {
    setGuessInputVisibility(false);
    setPromptHighlight(true);
    setCanvasStatus('You are drawing this round.', 'ready');
    document.getElementById('promptText').textContent = `🖌️ Draw: ${activePrompt}`;
    showNotification('GO! Start drawing now.');
  } else {
    setGuessInputVisibility(true);
    setPromptHighlight(true);
    setCanvasStatus(`${currentDrawerName || 'The drawer'} is drawing this round.`, 'locked');
    document.getElementById('promptText').textContent = '🧠 GO! Start guessing now.';
    showNotification('GO! Start guessing now.');
  }

  liveRoundTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const remaining = Math.max(0, duration - elapsed);

    const timerEl = document.getElementById('timer');
    timerEl.textContent = `${remaining} seconds`;

    if (remaining <= 10) {
      timerEl.classList.add('warning');
    } else {
      timerEl.classList.remove('warning');
    }

    if (remaining === 0) {
      stopLiveRoundTimer();
    }
  }, 100);

  updateHostControls();
});

socket.on('draw', (data) => {
  if (data.senderId === playerId) {
    return;
  }

  const startPoint = denormalizeCanvasPoint(data.x0Ratio, data.y0Ratio, data.x0, data.y0);
  const endPoint = denormalizeCanvasPoint(data.x1Ratio, data.y1Ratio, data.x1, data.y1);
  const toolSize = denormalizeToolSize(data.sizeRatio, data.size);

  if (data.senderId === currentDrawer) {
    showRemoteDrawerCursor(endPoint.x, endPoint.y, data.isEraser);
  }

  if (data.isEraser) {
    ctx.clearRect(endPoint.x - toolSize / 2, endPoint.y - toolSize / 2, toolSize, toolSize);
    return;
  }

  ctx.lineWidth = toolSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = data.color;
  ctx.beginPath();
  ctx.moveTo(startPoint.x, startPoint.y);
  ctx.lineTo(endPoint.x, endPoint.y);
  ctx.stroke();
});

socket.on('cursor_move', (data) => {
  if (data.senderId !== currentDrawer) {
    return;
  }

  const cursorPoint = denormalizeCanvasPoint(data.xRatio, data.yRatio, data.x, data.y);
  showRemoteDrawerCursor(cursorPoint.x, cursorPoint.y, data.isEraser);
});

socket.on('cursor_hide', (data) => {
  if (data.senderId !== currentDrawer) {
    return;
  }

  hideRemoteDrawerCursor();
});

socket.on('undo', (data) => {
  applyCanvasSnapshot(data?.snapshot || null);
});

socket.on('clear_canvas', (data) => {
  applyCanvasSnapshot(data?.snapshot || null);
});

socket.on('correct_guess', (data) => {
  setPromptHighlight(false);
  showNotification(`✅ ${data.player} guessed correctly! +${data.pointsAwarded} point${data.pointsAwarded === 1 ? '' : 's'} (${data.guessedCount} so far)`);
  document.getElementById(`team${data.team.replace('team', '')}Score`).textContent = 
    data.teams[data.team].score;
  document.getElementById('promptText').textContent = `"${data.prompt}"`;
});

socket.on('round_ended', (data) => {
  finalGuessActive = false;
  canDraw = false;
  activePrompt = '';
  hostGameStarted = true;
  clearRoundUiState();
  stopDrawing();
  emitCursorHide();
  hideRemoteDrawerCursor();
  hideGuesserHintModal();
  setGuessInputVisibility(true);
  setPromptHighlight(false);
  document.getElementById('guessInput').disabled = false;
  updateDrawingControlsVisibility();
  setCanvasStatus('Round ended. Waiting for the next round.', 'waiting');

  showNotification(`Round ended! Prompt was: "${data.prompt}"`);
  document.getElementById('promptText').textContent = `"${data.prompt}"`;

  updateHostControls();
});

socket.on('intermission_started', (data) => {
  showIntermissionState(data);
});

socket.on('game_reset', (data) => {
  hostGameStarted = false;
  finalGuessActive = false;
  canDraw = false;
  activePrompt = '';
  currentDrawer = null;
  currentDrawerName = null;
  drawingHistory = [];
  clearRoundUiState();
  hidePromptChoiceModal();
  hideRemoteDrawerCursor();
  hideGuesserHintModal();
  hideGameOverModal();
  setPromptHighlight(false);
  setGuessInputVisibility(true);
  document.getElementById('guessInput').disabled = false;
  document.getElementById('promptText').textContent = 'Waiting for game to start...';
  resetTimerDisplay();
  setCanvasStatus('Waiting for the host to start the game.', 'waiting');
  if (data.teams) {
    updateTeamsDisplay(data.teams);
  }
  clearGuessHistory();
  if (data.message) {
    showNotification(data.message);
  }
  updateDrawingControlsVisibility();
  updateHostControls();
});

socket.on('game_over', (data) => {
  hostGameStarted = false;
  finalGuessActive = false;
  canDraw = false;
  activePrompt = '';
  clearRoundUiState();
  hidePromptChoiceModal();
  document.getElementById('guessInput').disabled = false;
  hideGuesserHintModal();
  hideIntermissionModal();
  setGuessInputVisibility(true);
  setPromptHighlight(false);
  setCanvasStatus('Game ended. Waiting for the host to start the next game.', 'waiting');
  if (data?.winner?.teamName) {
    document.getElementById('promptText').textContent = `${data.winner.teamName} wins the game.`;
  } else {
    document.getElementById('promptText').textContent = 'Game over.';
  }
  showGameOverCelebration(data);
  updateDrawingControlsVisibility();
  updateHostControls();
});

socket.on('timer_update', (data) => {
  const timerEl = document.getElementById('timer');
  timerEl.textContent = `${data.remaining} seconds`;
  
  if (data.remaining <= 10) {
    timerEl.classList.add('warning');
  } else {
    timerEl.classList.remove('warning');
  }
});

socket.on('difficulty_changed', (data) => {
  showNotification(`Difficulty changed to: ${data.difficulty}`);
});

function updateTeamsDisplay(teams) {
  for (const [key, team] of Object.entries(teams)) {
    const teamNum = key.replace('team', '');
    document.getElementById(`team${teamNum}Score`).textContent = team.score;
    
    const playersList = document.getElementById(`team${teamNum}Players`);
    playersList.innerHTML = team.players.map(p => `
      <li ${p.id === currentDrawer ? 'class="drawer"' : ''}>${p.name}</li>
    `).join('');
  }

  scheduleFitGameToViewport();
}

function showNotification(message) {
  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = message;
  document.body.appendChild(notif);
  
  setTimeout(() => notif.remove(), 3000);
}

function showPromptChoiceModal(choices) {
  const modal = document.getElementById('promptChoiceModal');
  const countdownElement = document.getElementById('promptChoiceCountdown');
  const infoElement = document.getElementById('promptChoiceInfo') || document.querySelector('.prompt-choice-info');

  console.log('showPromptChoiceModal called with choices:', choices);


  // Reset previous timer if any
  clearPromptChoiceTimers();

  const easyContainer = document.getElementById('easyOptions');
  const mediumContainer = document.getElementById('mediumOptions');
  const hardContainer = document.getElementById('hardOptions');
  easyContainer.innerHTML = '';
  mediumContainer.innerHTML = '';
  hardContainer.innerHTML = '';
  currentPromptOptions = [];

  if (!choices || !choices.easy || !choices.medium || !choices.hard) {
    const errorHtml = '<div style="color:#f87171; padding:12px; text-align:center;">No prompt options available. Please restart round.</div>';
    easyContainer.innerHTML = errorHtml;
    mediumContainer.innerHTML = '';
    hardContainer.innerHTML = '';
    countdownElement.textContent = '';
    infoElement.textContent = 'Failed to load prompts. Please start new round.';
    modal.classList.remove('hidden');
    return;
  }

  const makePromptCard = (option, difficulty) => {
    const promptOption = normalizePromptOption(option, difficulty);
    const button = document.createElement('div');
    button.className = 'prompt-option';
    button.innerHTML = `
      <div>${promptOption.text}</div>
      <div class="prompt-drawer-hint">${promptOption.drawerHint}</div>
      <div class="prompt-difficulty">${difficulty}</div>
    `;
    button.onclick = () => selectPrompt(promptOption, difficulty);
    return button;
  };
  const easyPrompts = choices.easy.map(prompt => makePromptCard(prompt, 'Easy'));
  const mediumPrompts = choices.medium.map(prompt => makePromptCard(prompt, 'Medium'));
  const hardPrompts = choices.hard.map(prompt => makePromptCard(prompt, 'Hard'));

  easyPrompts.forEach(card => easyContainer.appendChild(card));
  mediumPrompts.forEach(card => mediumContainer.appendChild(card));
  hardPrompts.forEach(card => hardContainer.appendChild(card));

  currentPromptOptions = [
    ...choices.easy.map(option => normalizePromptOption(option, 'Easy')),
    ...choices.medium.map(option => normalizePromptOption(option, 'Medium')),
    ...choices.hard.map(option => normalizePromptOption(option, 'Hard'))
  ];

  // Set initial text
  infoElement.textContent = `Select a prompt (auto-selects in ${PROMPT_CHOICE_DURATION_SECONDS}s)`;
  let remaining = PROMPT_CHOICE_DURATION_SECONDS;
  countdownElement.textContent = `${remaining}s remaining`;

  document.getElementById('guessInput').disabled = true;
  modal.classList.remove('hidden');

  // Countdown timer for prompt choice
  promptChoiceInterval = setInterval(() => {
    remaining -= 1;
    if (remaining < 0) {
      clearInterval(promptChoiceInterval);
      promptChoiceInterval = null;
      // Auto-select a random prompt if none chosen
      if (currentPromptOptions.length > 0 && !modal.classList.contains('hidden')) {
        const randomPrompt = currentPromptOptions[Math.floor(Math.random() * currentPromptOptions.length)];
        selectPrompt(randomPrompt, randomPrompt.difficulty);
      }
      return;
    }

    countdownElement.textContent = `${remaining}s remaining`;

    if (remaining <= 5) {
      countdownElement.style.color = '#fb7185';
      infoElement.textContent = `Hurry up! Auto-select in ${remaining}s`;
    }
  }, 1000);

  // Safety fallback window closure after 20 sec
  promptChoiceTimeout = setTimeout(() => {
    if (!modal.classList.contains('hidden')) {
      if (currentPromptOptions.length > 0) {
        const randomPrompt = currentPromptOptions[Math.floor(Math.random() * currentPromptOptions.length)];
        selectPrompt(randomPrompt, randomPrompt.difficulty);
      } else {
        modal.classList.add('hidden');
      }
    }
  }, PROMPT_CHOICE_FALLBACK_MS);
}


function selectPrompt(promptOption, difficulty = 'Easy') {
  const normalizedPrompt = normalizePromptOption(promptOption, difficulty);
  // clear prompt selection timers
  clearPromptChoiceTimers();

  currentPromptOptions = [];
  activePrompt = normalizedPrompt.text;
  setPromptHighlight(true);
  hidePromptChoiceModal();
  document.getElementById('promptText').textContent = `🖌️ Draw: ${normalizedPrompt.text}`;
  socket.emit('select_prompt', {
    gameId,
    prompt: normalizedPrompt.text,
    difficulty: difficulty.toLowerCase()
  });

  // Notify drawer and guessers appropriately
  if (playerId === currentDrawer) {
    showNotification(`🕐 You have 1 minute to draw: ${normalizedPrompt.text} (${difficulty})`);
  } else {
    showNotification('🕐 Drawer selected a prompt. Hurry and guess!');
  }
}
