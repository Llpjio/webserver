/**
 * E4ALL Minecraft World Host Coordinator — Frontend Application
 */

const STATE = {
  theme: localStorage.getItem('e4all_theme') || 'mcnet',
  selectedPlayerId: parseInt(localStorage.getItem('e4all_player_id') || '1', 10),
  hostToken: localStorage.getItem('e4all_host_token') || null,
  currentStatus: null,
  players: [],
  history: [],
  timerInterval: null,
  heartbeatInterval: null,
  ws: null
};

// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', async () => {
  setupThemeDropdown();
  setupPlayerDropdown();
  setupWebSocket();
  await refreshAll();

  // Periodic polling backup (every 10s) in case ws drops
  setInterval(fetchStatus, 10000);
});

function setupThemeDropdown() {
  const select = document.getElementById('themeSelect');
  if (select) {
    select.value = STATE.theme;
    select.addEventListener('change', (e) => {
      STATE.theme = e.target.value;
      localStorage.setItem('e4all_theme', STATE.theme);
      applyTheme(STATE.theme);
      showToast(`Switched theme to ${STATE.theme === 'classic' ? 'Classic Textures' : 'Minecraft.net Animated'}`, 'info');
    });
  }
  applyTheme(STATE.theme);
}

function applyTheme(themeName) {
  document.body.className = themeName === 'classic' ? 'theme-classic' : 'theme-mcnet';
}

function setupPlayerDropdown() {
  const select = document.getElementById('playerSelect');
  if (!select) return;
  select.value = STATE.selectedPlayerId.toString();

  select.addEventListener('change', (e) => {
    STATE.selectedPlayerId = parseInt(e.target.value, 10);
    localStorage.setItem('e4all_player_id', STATE.selectedPlayerId);
    showToast(`Viewing as ${getSelectedPlayerName()}`, 'info');
    renderHero();
    renderRoster();
  });
}

function getSelectedPlayer() {
  return STATE.players.find(p => p.id === STATE.selectedPlayerId) || {
    id: STATE.selectedPlayerId,
    name: `Player ${STATE.selectedPlayerId}`,
    canHost: STATE.selectedPlayerId !== 4,
    hasVoxy: STATE.selectedPlayerId !== 4
  };
}

function getSelectedPlayerName() {
  const p = getSelectedPlayer();
  return p ? p.name : `Player ${STATE.selectedPlayerId}`;
}

// ================= WEBSOCKET REAL-TIME SYNC =================
function setupWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  const wsDot = document.getElementById('wsDot');
  const wsText = document.getElementById('wsText');

  try {
    const ws = new WebSocket(wsUrl);
    STATE.ws = ws;

    ws.onopen = () => {
      if (wsDot) {
        wsDot.className = 'ws-dot connected';
      }
      if (wsText) wsText.textContent = 'Live Sync';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'SESSION_STATE_CHANGED') {
          STATE.currentStatus = msg.payload;
          renderHero();
          renderHeader();
          renderRoster();
          checkHeartbeatRunner();
        } else if (msg.type === 'WORLD_VERSION_UPDATED') {
          showToast(`Authoritative World updated to v${msg.payload.version}!`, 'success');
          fetchHistory();
          fetchStatus();
        }
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    ws.onclose = () => {
      if (wsDot) wsDot.className = 'ws-dot';
      if (wsText) wsText.textContent = 'Reconnecting...';
      setTimeout(setupWebSocket, 3000);
    };

    ws.onerror = () => {
      if (wsDot) wsDot.className = 'ws-dot error';
      if (wsText) wsText.textContent = 'Disconnected';
    };
  } catch (err) {
    console.error('WebSocket connection error:', err);
    setTimeout(setupWebSocket, 5000);
  }
}

// ================= DATA FETCHING =================
async function refreshAll() {
  await Promise.all([fetchPlayers(), fetchStatus(), fetchHistory()]);
}

async function fetchPlayers() {
  try {
    const res = await fetch('/api/players');
    const data = await res.json();
    STATE.players = data.players || [];
    renderRoster();
  } catch (err) {
    console.error('Error fetching players:', err);
  }
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/session/status');
    const data = await res.json();
    STATE.currentStatus = data;
    renderHeader();
    renderHero();
    renderRoster();
    checkHeartbeatRunner();
  } catch (err) {
    console.error('Error fetching status:', err);
  }
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/world/history');
    const data = await res.json();
    STATE.history = data.history || [];
    renderHistory();
  } catch (err) {
    console.error('Error fetching history:', err);
  }
}

// ================= HEARTBEAT RUNNER =================
function checkHeartbeatRunner() {
  const isHost = isCurrentUserHost();
  const sessionActive = STATE.currentStatus && STATE.currentStatus.status !== 'OFFLINE';

  if (isHost && sessionActive && STATE.hostToken) {
    if (!STATE.heartbeatInterval) {
      // Send immediate heartbeat and set interval every 15s
      sendHeartbeat();
      STATE.heartbeatInterval = setInterval(sendHeartbeat, 15000);
    }
  } else {
    if (STATE.heartbeatInterval) {
      clearInterval(STATE.heartbeatInterval);
      STATE.heartbeatInterval = null;
    }
  }
}

async function sendHeartbeat() {
  if (!STATE.hostToken) return;
  try {
    await fetch('/api/session/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken: STATE.hostToken })
    });
  } catch (err) {
    console.warn('Heartbeat error:', err);
  }
}

function isCurrentUserHost() {
  if (!STATE.currentStatus || !STATE.currentStatus.activeSession) return false;
  return STATE.currentStatus.activeSession.hostPlayerId === STATE.selectedPlayerId;
}

// ================= RENDERING =================
function renderHeader() {
  if (!STATE.currentStatus) return;
  const verElem = document.getElementById('headerWorldVersion');
  if (verElem) {
    verElem.textContent = `v${STATE.currentStatus.worldVersion}`;
  }
}

function renderHero() {
  const heroCard = document.getElementById('statusHeroCard');
  const statusText = document.getElementById('statusText');
  const heroBody = document.getElementById('heroBody');
  const timerBadge = document.getElementById('sessionTimerBadge');

  if (!heroCard || !statusText || !heroBody || !STATE.currentStatus) return;

  const status = STATE.currentStatus.status || 'OFFLINE';
  const isStale = STATE.currentStatus.isStale;
  const activeSession = STATE.currentStatus.activeSession;
  const isHost = isCurrentUserHost();
  const currentPlayer = getSelectedPlayer();

  // Reset classes
  heroCard.className = `card status-hero state-${status}`;
  statusText.textContent = isStale ? `${status} (STALE / NO HEARTBEAT)` : status;

  // Manage Stopwatch Timer
  if (status === 'ONLINE' && activeSession && activeSession.sessionStartedAt) {
    timerBadge.classList.remove('hidden');
    startTimer(new Date(activeSession.sessionStartedAt).getTime());
  } else {
    timerBadge.classList.add('hidden');
    stopTimer();
  }

  let html = '';

  // Stale session alert if applicable
  if (isStale) {
    html += `
      <div class="stale-warning-box">
        <div>
          <strong>⚠️ Host Heartbeat Lost:</strong>
          <span>No heartbeat received from host for ${STATE.currentStatus.secondsSinceHeartbeat || 90}+ seconds.</span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="handleForceRelease()">Reset Stale Session</button>
      </div>
    `;
  }

  // Render State-Specific Hero Body
  switch (status) {
    case 'OFFLINE':
      html += renderOfflineState(currentPlayer);
      break;
    case 'CLAIMED':
      html += renderClaimedState(activeSession, isHost);
      break;
    case 'STARTING':
      html += renderStartingState(activeSession, isHost);
      break;
    case 'ONLINE':
      html += renderOnlineState(activeSession, isHost, currentPlayer);
      break;
    case 'SAVING':
      html += renderSavingState(activeSession, isHost);
      break;
    default:
      html += renderOfflineState(currentPlayer);
  }

  heroBody.innerHTML = html;
}

function renderOfflineState(currentPlayer) {
  const canHost = currentPlayer && currentPlayer.canHost;
  return `
    <div class="hero-state-box">
      <h2 class="hero-title mc-pixel-font">Nobody is currently hosting</h2>
      <p class="hero-desc">
        The Minecraft world is offline. Any host-capable player can claim the session, verify their local world copy, and launch via e4mc.
      </p>
      <div class="btn-actions-row">
        ${canHost ? `
          <button class="btn btn-primary" onclick="handleClaimHost()">
            <img src="/assets/textures/diamond_pickaxe.png" class="mc-tiny-icon" alt="Pickaxe" />
            Become Host
          </button>
        ` : `
          <button class="btn btn-primary" disabled title="Player 4 is configured as Client Only">
            <img src="/assets/textures/feather.png" class="mc-tiny-icon" alt="Feather" />
            Cannot Host (Client Only)
          </button>
        `}
      </div>
    </div>
  `;
}

function renderClaimedState(session, isHost) {
  if (isHost) {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">👑 You have claimed the Host Lease</div>
        <h2 class="hero-title mc-pixel-font">Step 1: Check Local World Copy</h2>
        <p class="hero-desc">
          Current authoritative world version: <strong class="mc-pixel-font" style="color: var(--mc-green); font-size: 1.2rem;">v${session.worldVersionStart}</strong>. Ensure your local Minecraft save matches this version before launching.
        </p>
        <div class="btn-actions-row">
          <button class="btn btn-success" onclick="handleReadyToLaunch()">
            <img src="/assets/textures/emerald.png" class="mc-tiny-icon" alt="Ready" />
            Local World Valid — Ready to Launch
          </button>
          <button class="btn btn-secondary" onclick="handleCancelSession()">
            Cancel Lease
          </button>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">👑 Host Claimed</div>
        <h2 class="hero-title mc-pixel-font">${session.hostPlayerName} is preparing to host</h2>
        <p class="hero-desc">
          Verifying local world baseline (v${session.worldVersionStart}). The session address will appear once Minecraft is opened to LAN.
        </p>
      </div>
    `;
  }
}

function renderStartingState(session, isHost) {
  if (isHost) {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">👑 Host Setup</div>
        <h2 class="hero-title mc-pixel-font">Step 2: Launch Minecraft & e4mc</h2>
        
        <div class="host-checklist mc-inset-box">
          <ol>
            <li><strong>Launch Minecraft Java Edition</strong> (modpack instance)</li>
            <li><strong>Open E4ALL World</strong> in Singleplayer</li>
            <li>Press <strong>Esc</strong> &rarr; <strong>Open to LAN</strong> with e4mc</li>
            <li>Copy the public link generated in game chat (e.g. <code>abcde.e4mc.link</code>)</li>
          </ol>
        </div>

        <div class="input-group">
          <label class="input-label" for="e4mcInput">Paste e4mc Public Address:</label>
          <input 
            type="text" 
            id="e4mcInput" 
            class="input-field mono" 
            placeholder="e.g. abcde.e4mc.link" 
            value="${session.e4mcAddress || ''}"
            autofocus
          />
        </div>

        <div class="btn-actions-row">
          <button class="btn btn-success" onclick="handleGoOnline()">
            <img src="/assets/textures/compass_16.png" class="mc-tiny-icon" alt="Compass" />
            Start Session / Go Online
          </button>
          <button class="btn btn-secondary" onclick="handleCancelSession()">
            Abort
          </button>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">👑 Starting Up</div>
        <h2 class="hero-title mc-pixel-font">${session.hostPlayerName} is starting Minecraft...</h2>
        <p class="hero-desc">
          World is launching and establishing e4mc tunnel. Address will appear here automatically in real time!
        </p>
      </div>
    `;
  }
}

function renderOnlineState(session, isHost, currentPlayer) {
  return `
    <div class="hero-state-box">
      <div class="host-badge-banner">
        👑 Hosted by <strong style="color: #ffffff;">${session.hostPlayerName}</strong>
      </div>
      <h2 class="hero-title mc-pixel-font" style="color: var(--mc-green);">Minecraft World is ONLINE!</h2>
      <p class="hero-desc">
        Open Minecraft &rarr; <strong>Multiplayer</strong> &rarr; <strong>Direct Connection</strong> &rarr; Paste address below:
      </p>

      <!-- Big e4mc Address Box -->
      <div class="e4mc-card">
        <div class="e4mc-header">e4mc Connection Address</div>
        <div class="e4mc-display-group">
          <div class="e4mc-address-val" id="activeAddressText">${session.e4mcAddress || 'Connecting...'}</div>
          <button class="btn btn-success btn-copy" onclick="copyAddress('${session.e4mcAddress}')">
            <img src="/assets/textures/emerald.png" class="mc-tiny-icon" alt="Copy" />
            Copy Address
          </button>
        </div>
      </div>

      <!-- Host Controls -->
      ${isHost ? `
        <div class="btn-actions-row">
          <button class="btn btn-secondary btn-sm" onclick="handleEditAddressPrompt('${session.e4mcAddress || ''}')">
            ✏️ Edit Address
          </button>
          <button class="btn btn-danger" onclick="handleBeginEndSession()">
            <img src="/assets/textures/redstone.png" class="mc-tiny-icon" alt="End" />
            End Hosting
          </button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderSavingState(session, isHost) {
  if (isHost) {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">🛑 Session Ending</div>
        <h2 class="hero-title mc-pixel-font" style="color: var(--mc-purple);">Step 3: Clean Save & Version Bump</h2>
        <p class="hero-desc">
          Please close Minecraft completely so world chunks and player data flush cleanly to disk.
        </p>

        <div class="input-group">
          <label class="input-label" for="sessionNotesInput">Session Notes / Changes (Optional):</label>
          <input 
            type="text" 
            id="sessionNotesInput" 
            class="input-field" 
            placeholder="e.g. Explored woodland mansion, built nether portal..."
          />
        </div>

        <div class="btn-actions-row">
          <button class="btn btn-primary" onclick="handleFinalizeSession()">
            <img src="/assets/textures/oak_sign.png" class="mc-tiny-icon" alt="Publish" />
            Minecraft Stopped — Publish World v${(session.worldVersionStart || 100) + 1}
          </button>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">🛑 Wrapping Up</div>
        <h2 class="hero-title mc-pixel-font">${session.hostPlayerName} is ending the session</h2>
        <p class="hero-desc">
          Saving world state and preparing authoritative version increment. World will be available for next host momentarily.
        </p>
      </div>
    `;
  }
}

function renderRoster() {
  const container = document.getElementById('rosterList');
  if (!container) return;

  const activeHostId = STATE.currentStatus && STATE.currentStatus.activeSession 
    ? STATE.currentStatus.activeSession.hostPlayerId 
    : null;

  container.innerHTML = STATE.players.map(p => {
    const isCurrent = p.id === STATE.selectedPlayerId;
    const isHostActive = p.id === activeHostId;

    return `
      <div class="roster-player-item ${isCurrent ? 'current-player' : ''}">
        <div class="roster-player-info">
          <span class="player-avatar-dot" style="background-color: ${p.color || '#3b82f6'}"></span>
          <div>
            <span class="player-name-text">${p.name} ${isCurrent ? '(You)' : ''}</span>
          </div>
        </div>
        <div class="player-tags">
          ${isHostActive ? `<span class="badge badge-active-host">👑 Active Host</span>` : ''}
          ${p.canHost ? `<span class="badge badge-host">Host Ready</span>` : `<span class="badge badge-client">Client Only</span>`}
          ${p.hasVoxy ? `<span class="badge badge-voxy">Neo Voxy</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderHistory() {
  const tbody = document.getElementById('historyTableBody');
  const countElem = document.getElementById('historyCount');
  if (!tbody) return;

  if (countElem) {
    countElem.textContent = `${STATE.history.length} versions recorded`;
  }

  if (STATE.history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem;">No versions recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = STATE.history.map(item => {
    const dateStr = item.created_at ? new Date(item.created_at).toLocaleString() : 'N/A';
    return `
      <tr>
        <td class="history-ver">v${item.version}</td>
        <td class="history-player">${item.player_name || 'System'}</td>
        <td>${escapeHtml(item.notes || 'Routine session')}</td>
        <td>${dateStr}</td>
      </tr>
    `;
  }).join('');
}

// ================= ACTIONS & HANDLERS =================
async function handleClaimHost() {
  const player = getSelectedPlayer();
  if (!player.canHost) {
    showToast('Player 4 is not host-capable.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/session/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: STATE.selectedPlayerId })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to claim host lease', 'error');
      return;
    }

    STATE.hostToken = data.hostToken;
    localStorage.setItem('e4all_host_token', data.hostToken);
    showToast('Host lease acquired! Check your local world copy.', 'success');
    fetchStatus();
  } catch (err) {
    showToast('Connection error claiming host', 'error');
  }
}

async function handleReadyToLaunch() {
  if (!STATE.hostToken) {
    showToast('Missing host token. Re-claim host.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/session/ready', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken: STATE.hostToken })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update state', 'error');
      return;
    }

    showToast('Ready! Launch Minecraft and open to LAN.', 'success');
    fetchStatus();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleGoOnline() {
  const input = document.getElementById('e4mcInput');
  const address = input ? input.value.trim() : '';

  if (!address) {
    showToast('Please enter the e4mc link from Minecraft chat.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/session/online', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken: STATE.hostToken, e4mcAddress: address })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to go online', 'error');
      return;
    }

    showToast('Session is now LIVE! Players can connect.', 'success');
    fetchStatus();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleEditAddressPrompt(currentAddress) {
  const newAddress = prompt('Enter updated e4mc address:', currentAddress);
  if (!newAddress || newAddress === currentAddress) return;

  try {
    const res = await fetch('/api/session/e4mc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken: STATE.hostToken, e4mcAddress: newAddress.trim() })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to update address', 'error');
      return;
    }

    showToast('e4mc address updated!', 'success');
    fetchStatus();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleBeginEndSession() {
  if (!confirm('Are you ready to end hosting? You will be prompted to verify Minecraft is cleanly closed.')) {
    return;
  }

  try {
    const res = await fetch('/api/session/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken: STATE.hostToken })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to end session', 'error');
      return;
    }

    showToast('Session ending. Please close Minecraft.', 'info');
    fetchStatus();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleFinalizeSession() {
  const input = document.getElementById('sessionNotesInput');
  const notes = input ? input.value.trim() : '';

  try {
    const res = await fetch('/api/session/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken: STATE.hostToken, notes })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to finalize session', 'error');
      return;
    }

    STATE.hostToken = null;
    localStorage.removeItem('e4all_host_token');
    showToast(`World published as v${data.newWorldVersion}! Status returned to OFFLINE.`, 'success');
    fetchStatus();
    fetchHistory();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleCancelSession() {
  if (!confirm('Cancel this host session lease?')) return;

  try {
    const res = await fetch('/api/session/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostToken: STATE.hostToken, force: false })
    });

    STATE.hostToken = null;
    localStorage.removeItem('e4all_host_token');
    showToast('Host lease cancelled.', 'info');
    fetchStatus();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleForceRelease() {
  if (!confirm('Force reset this stale session back to OFFLINE?')) return;

  try {
    const res = await fetch('/api/session/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true, playerId: STATE.selectedPlayerId })
    });

    STATE.hostToken = null;
    localStorage.removeItem('e4all_host_token');
    showToast('Session reset to OFFLINE.', 'info');
    fetchStatus();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

// ================= TIMERS & UTILS =================
function startTimer(startTimeMs) {
  stopTimer();
  updateTimerDisplay(startTimeMs);
  STATE.timerInterval = setInterval(() => updateTimerDisplay(startTimeMs), 1000);
}

function stopTimer() {
  if (STATE.timerInterval) {
    clearInterval(STATE.timerInterval);
    STATE.timerInterval = null;
  }
}

function updateTimerDisplay(startTimeMs) {
  const elem = document.getElementById('sessionTimerText');
  if (!elem) return;

  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - startTimeMs) / 1000));

  const hours = Math.floor(diffSec / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);
  const seconds = diffSec % 60;

  elem.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function pad(num) {
  return num.toString().padStart(2, '0');
}

function copyAddress(address) {
  if (!address) return;
  navigator.clipboard.writeText(address).then(() => {
    showToast(`Copied "${address}" to clipboard!`, 'success');
  }).catch(() => {
    prompt('Copy address manually:', address);
  });
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
