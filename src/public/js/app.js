/**
 * E4ALL Minecraft World Host Coordinator — Frontend Application
 * MongoDB Edition + User Authentication + Live Sync
 */

const STATE = {
  theme: localStorage.getItem('e4all_theme') || 'mcnet',
  token: localStorage.getItem('e4all_jwt_token') || null,
  currentUser: null,
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
  setupWebSocket();

  // Check current user if token exists
  if (STATE.token) {
    await fetchCurrentUser();
  } else {
    renderAuthHeader();
  }

  await refreshAll();

  // Periodic polling backup (every 10s)
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
      showToast(`Switched theme to ${STATE.theme === 'classic' ? 'Classic Textures' : 'Animated'}`, 'info');
    });
  }
  applyTheme(STATE.theme);
}

function applyTheme(themeName) {
  document.body.className = themeName === 'classic' ? 'theme-classic' : 'theme-mcnet';
}

// ================= USER AUTHENTICATION =================
async function fetchCurrentUser() {
  if (!STATE.token) {
    STATE.currentUser = null;
    renderAuthHeader();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${STATE.token}` }
    });

    if (res.ok) {
      const data = await res.json();
      STATE.currentUser = data.user;
    } else {
      // Expired token
      STATE.token = null;
      STATE.currentUser = null;
      localStorage.removeItem('e4all_jwt_token');
    }
  } catch (err) {
    console.error('Error fetching current user:', err);
  }
  renderAuthHeader();
  renderHero();
}

function renderAuthHeader() {
  const container = document.getElementById('authHeaderContainer');
  if (!container) return;

  if (STATE.currentUser) {
    container.innerHTML = `
      <div class="user-profile-badge">
        <span class="user-avatar-dot" style="background-color: ${STATE.currentUser.color || '#10b981'}"></span>
        <span class="user-name-text">${escapeHtml(STATE.currentUser.displayName || STATE.currentUser.username)}</span>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="handleLogout()">Sign Out</button>
    `;
  } else {
    container.innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="openLoginModal()">🔑 Sign In</button>
      <button class="btn btn-secondary btn-sm" onclick="openRegisterModal()">📝 Register</button>
    `;
  }
}

function openLoginModal() {
  closeAuthModals();
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.remove('hidden');
}

function openRegisterModal() {
  closeAuthModals();
  const modal = document.getElementById('registerModal');
  if (modal) modal.classList.remove('hidden');
}

function closeAuthModals() {
  const loginModal = document.getElementById('loginModal');
  const regModal = document.getElementById('registerModal');
  if (loginModal) loginModal.classList.add('hidden');
  if (regModal) regModal.classList.add('hidden');
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Login failed', 'error');
      return;
    }

    STATE.token = data.token;
    STATE.currentUser = data.user;
    localStorage.setItem('e4all_jwt_token', data.token);

    closeAuthModals();
    showToast(`Welcome back, ${data.user.displayName}!`, 'success');
    renderAuthHeader();
    renderHero();
    fetchPlayers();
  } catch (err) {
    showToast('Network error logging in', 'error');
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const displayName = document.getElementById('regDisplayName').value.trim();
  const password = document.getElementById('regPassword').value;
  const canHost = document.getElementById('regCanHost').checked;
  const hasVoxy = document.getElementById('regHasVoxy').checked;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName, password, canHost, hasVoxy })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Registration failed', 'error');
      return;
    }

    STATE.token = data.token;
    STATE.currentUser = data.user;
    localStorage.setItem('e4all_jwt_token', data.token);

    closeAuthModals();
    showToast(`Account created! Welcome, ${data.user.displayName}!`, 'success');
    renderAuthHeader();
    renderHero();
    fetchPlayers();
  } catch (err) {
    showToast('Network error registering', 'error');
  }
}

function handleLogout() {
  STATE.token = null;
  STATE.currentUser = null;
  localStorage.removeItem('e4all_jwt_token');
  showToast('Signed out.', 'info');
  renderAuthHeader();
  renderHero();
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
      if (wsDot) wsDot.className = 'ws-dot connected';
      if (wsText) wsText.textContent = 'Live Sync';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'SESSION_STATE_CHANGED') {
          STATE.currentStatus = msg.payload;
          renderHero();
          renderHeader();
          renderTopHostBanner();
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
    renderTopHostBanner();
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

  if (isHost && sessionActive && STATE.token) {
    if (!STATE.heartbeatInterval) {
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
  if (!STATE.token) return;
  try {
    await fetch('/api/session/heartbeat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      }
    });
  } catch (err) {
    console.warn('Heartbeat error:', err);
  }
}

function isCurrentUserHost() {
  if (!STATE.currentStatus || !STATE.currentStatus.activeSession || !STATE.currentUser) return false;
  return STATE.currentStatus.activeSession.hostUserId === STATE.currentUser.id.toString();
}

// ================= RENDERING =================
function renderHeader() {
  if (!STATE.currentStatus) return;
  const verElem = document.getElementById('headerWorldVersion');
  if (verElem) {
    verElem.textContent = `v${STATE.currentStatus.worldVersion}`;
  }
}

function renderTopHostBanner() {
  const banner = document.getElementById('activeHostTopBanner');
  const hostNameElem = document.getElementById('activeHostName');
  const statusTagElem = document.getElementById('activeHostStatusTag');

  if (!banner || !hostNameElem || !statusTagElem || !STATE.currentStatus) return;

  const session = STATE.currentStatus.activeSession;
  if (session && STATE.currentStatus.status !== 'OFFLINE') {
    banner.classList.remove('hidden');
    hostNameElem.textContent = `${session.hostDisplayName} (@${session.hostUsername})`;
    statusTagElem.textContent = session.status;
  } else {
    banner.classList.add('hidden');
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
  const user = STATE.currentUser;

  heroCard.className = `card status-hero mc-net-hero state-${status}`;
  statusText.textContent = isStale ? `${status} (STALE / NO HEARTBEAT)` : status;

  if (status === 'ONLINE' && activeSession && activeSession.sessionStartedAt) {
    timerBadge.classList.remove('hidden');
    startTimer(new Date(activeSession.sessionStartedAt).getTime());
  } else {
    timerBadge.classList.add('hidden');
    stopTimer();
  }

  let html = '';

  if (isStale) {
    html += `
      <div class="stale-warning-box">
        <div>
          <strong>⚠️ Host Heartbeat Lost:</strong>
          <span>No heartbeat received from host for ${STATE.currentStatus.secondsSinceHeartbeat || 90}+ seconds.</span>
        </div>
        ${user ? `<button class="btn btn-danger btn-sm" onclick="handleForceRelease()">Reset Stale Session</button>` : ''}
      </div>
    `;
  }

  switch (status) {
    case 'OFFLINE':
      html += renderOfflineState(user);
      break;
    case 'CLAIMED':
      html += renderClaimedState(activeSession, isHost, user);
      break;
    case 'STARTING':
      html += renderStartingState(activeSession, isHost, user);
      break;
    case 'ONLINE':
      html += renderOnlineState(activeSession, isHost, user);
      break;
    case 'SAVING':
      html += renderSavingState(activeSession, isHost, user);
      break;
    default:
      html += renderOfflineState(user);
  }

  heroBody.innerHTML = html;
}

function renderOfflineState(user) {
  return `
    <div class="hero-state-box">
      <h2 class="hero-title mc-pixel-font">Nobody is currently hosting</h2>
      <p class="hero-desc">
        The Minecraft world is offline. Any signed-in host-capable player can claim the session, verify their local world copy, and launch via e4mc.
      </p>
      <div class="btn-actions-row">
        ${user ? (user.canHost ? `
          <button class="btn btn-primary" onclick="handleClaimHost()">
            <img src="/assets/textures/diamond_pickaxe.png" class="mc-tiny-icon" alt="Pickaxe" />
            Become Host (${escapeHtml(user.displayName)})
          </button>
        ` : `
          <button class="btn btn-primary" disabled title="Your account is set as Client Only">
            <img src="/assets/textures/feather.png" class="mc-tiny-icon" alt="Feather" />
            Cannot Host (Client Only)
          </button>
        `) : `
          <button class="btn btn-primary" onclick="openLoginModal()">
            🔑 Sign In to Host World
          </button>
        `}
      </div>
    </div>
  `;
}

function renderClaimedState(session, isHost, user) {
  if (isHost) {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">👑 You have claimed the Host Lease</div>
        <h2 class="hero-title mc-pixel-font">Step 1: Download & Verify World</h2>
        <p class="hero-desc">
          Authoritative world version: <strong class="mc-pixel-font" style="color: var(--mc-green); font-size: 1.3rem;">v${session.worldVersionStart}</strong>. Download the latest save and place it in your <code>.minecraft/saves/E4ALL</code> folder before launching.
        </p>

        <!-- World Download Card for Host -->
        <div class="e4mc-card" style="border-color: #3b82f6;">
          <div class="e4mc-header">Authoritative World Archive (v${session.worldVersionStart})</div>
          <div class="btn-actions-row" style="margin-top: 0.5rem;">
            <a href="/api/world/download/${session.worldVersionStart}" class="btn btn-primary" download>
              <img src="/assets/textures/diamond_pickaxe.png" class="mc-tiny-icon" alt="Download" />
              📥 Download World Save (v${session.worldVersionStart}.zip)
            </a>
          </div>
        </div>

        <div class="btn-actions-row">
          <button class="btn btn-success" onclick="handleReadyToLaunch()">
            <img src="/assets/textures/emerald.png" class="mc-tiny-icon" alt="Ready" />
            ✅ World Ready — Launch Minecraft
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
        <h2 class="hero-title mc-pixel-font">${escapeHtml(session.hostDisplayName)} is preparing to host</h2>
        <p class="hero-desc">
          Host is syncing local world baseline (v${session.worldVersionStart}). The session address will appear once Minecraft is opened to LAN.
        </p>
      </div>
    `;
  }
}

function renderStartingState(session, isHost, user) {
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
        <h2 class="hero-title mc-pixel-font">${escapeHtml(session.hostDisplayName)} is starting Minecraft...</h2>
        <p class="hero-desc">
          World is launching and establishing e4mc tunnel. Address will appear here automatically in real time!
        </p>
      </div>
    `;
  }
}

function renderOnlineState(session, isHost, user) {
  return `
    <div class="hero-state-box">
      <div class="host-badge-banner">
        👑 Hosted by <strong style="color: #ffffff;">${escapeHtml(session.hostDisplayName)}</strong>
      </div>
      <h2 class="hero-title mc-pixel-font" style="color: var(--mc-green);">Minecraft World is ONLINE!</h2>
      <p class="hero-desc">
        Open Minecraft &rarr; <strong>Multiplayer</strong> &rarr; <strong>Direct Connection</strong> &rarr; Paste address below:
      </p>

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

function renderSavingState(session, isHost, user) {
  const nextVer = (session.worldVersionStart || 100) + 1;

  if (isHost) {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">🛑 Session Ending</div>
        <h2 class="hero-title mc-pixel-font" style="color: var(--mc-purple);">Step 3: Save World & Upload (v${nextVer})</h2>
        <p class="hero-desc">
          Please close Minecraft cleanly. Then zip your world save folder (<code>.minecraft/saves/E4ALL</code>) and upload it to publish <strong>v${nextVer}</strong>.
        </p>

        <!-- World Upload Form -->
        <form id="worldUploadForm" onsubmit="handleFinalizeUploadSubmit(event)" style="max-width: 600px; margin: 1.25rem auto;">
          <div class="form-group mc-inset-box" style="text-align: left;">
            <label class="form-label mc-pixel-font" for="worldZipFile">
              📂 Select World Save Archive (.zip):
            </label>
            <input type="file" id="worldZipFile" class="form-input" accept=".zip" />
            <small style="color: #aaaaaa; margin-top: 4px; display: block;">
              (Optional: Leave empty if no file changes were made to publish version bump only)
            </small>
          </div>

          <div class="input-group">
            <label class="input-label" for="sessionNotesInput">Session Notes / Changes:</label>
            <input 
              type="text" 
              id="sessionNotesInput" 
              class="input-field" 
              placeholder="e.g. Explored woodland mansion, built nether portal..."
            />
          </div>

          <div class="btn-actions-row">
            <button type="submit" class="btn btn-primary" id="uploadPublishBtn">
              <img src="/assets/textures/oak_sign.png" class="mc-tiny-icon" alt="Publish" />
              📤 Upload & Publish World v${nextVer}
            </button>
          </div>
        </form>
      </div>
    `;
  } else {
    return `
      <div class="hero-state-box">
        <div class="host-badge-banner">🛑 Wrapping Up</div>
        <h2 class="hero-title mc-pixel-font">${escapeHtml(session.hostDisplayName)} is ending the session</h2>
        <p class="hero-desc">
          Uploading new world version to cloud storage and finalizing state. World will be available for next host momentarily.
        </p>
      </div>
    `;
  }
}

function renderRoster() {
  const container = document.getElementById('rosterList');
  const countElem = document.getElementById('rosterCount');
  if (!container) return;

  if (countElem) {
    countElem.textContent = `${STATE.players.length} Players`;
  }

  const activeHostUserId = STATE.currentStatus && STATE.currentStatus.activeSession 
    ? STATE.currentStatus.activeSession.hostUserId 
    : null;

  container.innerHTML = STATE.players.map(p => {
    const isCurrent = STATE.currentUser && p.id === STATE.currentUser.id.toString();
    const isHostActive = p.id === activeHostUserId;

    return `
      <div class="roster-player-item ${isCurrent ? 'current-user-item' : ''}">
        <div class="roster-player-info">
          <span class="player-avatar-dot" style="background-color: ${p.color || '#3b82f6'}"></span>
          <div>
            <span class="player-name-text">${escapeHtml(p.name)} ${isCurrent ? '(You)' : ''}</span>
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
        <td class="history-player">${escapeHtml(item.player_name || 'System')}</td>
        <td>${escapeHtml(item.notes || 'Routine session')}</td>
        <td>${dateStr}</td>
      </tr>
    `;
  }).join('');
}

// ================= ACTIONS & API HANDLERS =================
async function handleClaimHost() {
  if (!STATE.token) {
    openLoginModal();
    return;
  }

  try {
    const res = await fetch('/api/session/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      }
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to claim host lease', 'error');
      return;
    }

    showToast('Host lease acquired! Check your local world copy.', 'success');
    fetchStatus();
  } catch (err) {
    showToast('Connection error claiming host', 'error');
  }
}

async function handleReadyToLaunch() {
  if (!STATE.token) return;

  try {
    const res = await fetch('/api/session/ready', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      }
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
  if (!STATE.token) return;
  const input = document.getElementById('e4mcInput');
  const address = input ? input.value.trim() : '';

  if (!address) {
    showToast('Please enter the e4mc link from Minecraft chat.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/session/online', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ e4mcAddress: address })
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
  if (!STATE.token) return;
  const newAddress = prompt('Enter updated e4mc address:', currentAddress);
  if (!newAddress || newAddress === currentAddress) return;

  try {
    const res = await fetch('/api/session/e4mc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ e4mcAddress: newAddress.trim() })
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
  if (!STATE.token) return;
  if (!confirm('Are you ready to end hosting? You will be prompted to verify Minecraft is cleanly closed.')) {
    return;
  }

  try {
    const res = await fetch('/api/session/end', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      }
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
  if (!STATE.token) return;
  const input = document.getElementById('sessionNotesInput');
  const notes = input ? input.value.trim() : '';

  try {
    const res = await fetch('/api/session/finalize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ notes })
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to finalize session', 'error');
      return;
    }

    showToast(`World published as v${data.newWorldVersion}! Status returned to OFFLINE.`, 'success');
    fetchStatus();
    fetchHistory();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleFinalizeUploadSubmit(event) {
  if (event) event.preventDefault();
  if (!STATE.token) {
    openLoginModal();
    return;
  }

  const fileInput = document.getElementById('worldZipFile');
  const notesInput = document.getElementById('sessionNotesInput');
  const btn = document.getElementById('uploadPublishBtn');

  const notes = notesInput ? notesInput.value.trim() : '';
  const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

  const formData = new FormData();
  formData.append('notes', notes);
  if (file) {
    formData.append('worldFile', file);
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<img src="/assets/textures/oak_sign.png" class="mc-tiny-icon" alt="Publish" /> Uploading & Publishing...`;
  }

  try {
    const res = await fetch('/api/world/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STATE.token}`
      },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to upload and finalize session', 'error');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<img src="/assets/textures/oak_sign.png" class="mc-tiny-icon" alt="Publish" /> 📤 Retry Upload & Publish`;
      }
      return;
    }

    showToast(`World published as v${data.newWorldVersion}! Status returned to OFFLINE.`, 'success');
    fetchStatus();
    fetchHistory();
  } catch (err) {
    showToast('Connection error during upload', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<img src="/assets/textures/oak_sign.png" class="mc-tiny-icon" alt="Publish" /> 📤 Retry Upload & Publish`;
    }
  }
}

async function handleCancelSession() {
  if (!STATE.token) return;
  if (!confirm('Cancel this host session lease?')) return;

  try {
    await fetch('/api/session/release', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ force: false })
    });

    showToast('Host lease cancelled.', 'info');
    fetchStatus();
  } catch (err) {
    showToast('Connection error', 'error');
  }
}

async function handleForceRelease() {
  if (!STATE.token) return;
  if (!confirm('Force reset this stale session back to OFFLINE?')) return;

  try {
    await fetch('/api/session/release', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${STATE.token}`
      },
      body: JSON.stringify({ force: true })
    });

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
