/* ============================================================
   GRABBIT — app.js
   Core navigation, theme switching, shared state
   ============================================================ */

// ── State ──────────────────────────────────────────────────
const state = {
  currentPage: 'download',
  theme: localStorage.getItem('grabbit-theme') || 'dark',
  queueItems: [],
};

// ── Theme ──────────────────────────────────────────────────
const FREE_THEMES    = ['dark', 'light'];
const PREMIUM_THEMES = ['ocean', 'forest', 'ember', 'rose'];
const ALL_THEMES     = [...FREE_THEMES, ...PREMIUM_THEMES];

function applyTheme(theme) {
  const isPro     = window.isProOrTrial ? window.isProOrTrial() : !!localStorage.getItem('grabbit-license');
  const isPremium = PREMIUM_THEMES.includes(theme);

  if (isPremium && !isPro) {
    // Delay to ensure queue.js showToast is available
    setTimeout(() => {
      if (window.showToast) window.showToast(t('toast_pro_themes'), 'info');
    }, 100);
    navigateTo('license');
    return;
  }

  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('grabbit-theme', theme);

  const label     = document.getElementById('theme-label');
  const iconDark  = document.getElementById('theme-icon-dark');
  const iconLight = document.getElementById('theme-icon-light');

  const isDarkLike = theme === 'dark' || isPremium;
  if (isDarkLike) {
    if (label)     label.textContent      = 'Light mode';
    if (iconDark)  iconDark.style.display  = 'none';
    if (iconLight) iconLight.style.display = 'block';
  } else {
    if (label)     label.textContent      = 'Dark mode';
    if (iconDark)  iconDark.style.display  = 'block';
    if (iconLight) iconLight.style.display = 'none';
  }

  document.querySelectorAll('[data-theme-set]').forEach(el => {
    el.classList.toggle('active', el.dataset.themeSet === theme);
  });
}

document.getElementById('theme-btn').addEventListener('click', () => {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
});

// Settings theme options
document.querySelectorAll('[data-theme-set]').forEach(el => {
  el.addEventListener('click', () => applyTheme(el.dataset.themeSet));
});

// ── Navigation ─────────────────────────────────────────────
const pageTitles = {
  download: 'Download',
  queue:    'Queue',
  library:  'Library',
  watch:    'Watch',
  settings: 'Settings',
  license:  'License',
};

function navigateTo(pageId) {
  // Deactivate all
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));

  // Activate target
  const navItem = document.querySelector(`[data-page="${pageId}"]`);
  if (navItem) navItem.classList.add('active');

  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');

  document.getElementById('page-title').textContent = pageTitles[pageId] || pageId;
  state.currentPage = pageId;

  if (pageId === 'library' && typeof window.syncLibrary === 'function') {
    window.syncLibrary();
  }
  if (pageId === 'watch' && typeof window.loadWatchlist === 'function') {
    window.loadWatchlist();
  }
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

// ── Tool status ────────────────────────────────────────────
async function checkToolStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    document.getElementById('ytdlp-status').textContent = data.ytdlp ? '✓ Installed' : '✗ Not found';
    document.getElementById('ytdlp-status').style.color = data.ytdlp ? '#22c55e' : '#ef4444';
    document.getElementById('ffmpeg-status').textContent = data.ffmpeg ? '✓ Installed' : '✗ Not found';
    document.getElementById('ffmpeg-status').style.color = data.ffmpeg ? '#22c55e' : '#ef4444';
  } catch { /* offline */ }
}

// ── Queue badge ────────────────────────────────────────────
function updateQueueBadge(count) {
  const badge = document.getElementById('queue-badge');
  const countEl = document.getElementById('queue-count');
  if (count > 0) {
    badge.textContent = count;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
  if (countEl) countEl.textContent = `${count} item${count !== 1 ? 's' : ''}`;
}

// ── Custom confirm modal (avoids browser's native confirm) ─
window.showConfirm = function(title, msg, onConfirm, confirmLabel) {
  const modal     = document.getElementById('confirm-modal');
  const titleEl   = document.getElementById('confirm-title');
  const msgEl     = document.getElementById('confirm-msg');
  const okBtn     = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  if (!modal) { if (confirm(msg)) onConfirm(); return; }
  titleEl.textContent = title;
  msgEl.textContent   = msg;
  okBtn.textContent   = confirmLabel || 'Confirm';
  modal.style.display = 'flex';
  const close = () => { modal.style.display = 'none'; };
  okBtn.onclick     = () => { close(); onConfirm(); };
  cancelBtn.onclick = close;
  modal.onclick     = (e) => { if (e.target === modal) close(); };
};

// ── First-run splash screen ─────────────────────────────────
(async function checkStartupReady() {
  const splash = document.getElementById('setup-splash');
  const bar    = document.getElementById('splash-bar');
  const ytEl   = document.getElementById('splash-ytdlp');
  const ffEl   = document.getElementById('splash-ffmpeg');
  const title  = document.getElementById('splash-title');
  const sub    = document.getElementById('splash-sub');

  // Quick check — if already ready, skip splash entirely
  try {
    const res  = await fetch('/api/startup_ready');
    const data = await res.json();
    if (data.ready) { return; }
  } catch { return; }

  // Show splash
  splash.style.display = 'flex';
  document.querySelector('.app-shell').style.visibility = 'hidden';

  const statusMap = {
    ok:         { icon: '✓', color: '#22c55e' },
    installing: { icon: '⬇', color: 'var(--secondary)' },
    updating:   { icon: '⟳', color: 'var(--secondary)' },
    checking:   { icon: '⟳', color: 'var(--gray)' },
    error:      { icon: '✗', color: '#ef4444' },
  };

  let progress = 10;
  const interval = setInterval(async () => {
    try {
      const res  = await fetch('/api/startup_status');
      const data = await res.json();

      const yt = statusMap[data.ytdlp]  || statusMap.checking;
      const ff = statusMap[data.ffmpeg] || statusMap.checking;

      ytEl.textContent = `${yt.icon} yt-dlp`;
      ytEl.style.color = yt.color;
      ffEl.textContent = `${ff.icon} FFmpeg`;
      ffEl.style.color = ff.color;

      if (data.ytdlp === 'installing' || data.ffmpeg === 'installing') {
        title.textContent = 'Downloading dependencies...';
        progress = Math.min(progress + 8, 85);
      } else if (data.ytdlp === 'updating' || data.ffmpeg === 'updating') {
        title.textContent = 'Updating tools...';
        progress = Math.min(progress + 5, 75);
      }

      bar.style.width = `${progress}%`;

      const ready = data.ytdlp === 'ok' && data.ffmpeg === 'ok';
      const error = data.ytdlp === 'error' || data.ffmpeg === 'error';

      if (ready) {
        clearInterval(interval);
        bar.style.width = '100%';
        title.textContent = 'Ready!';
        sub.textContent   = 'Starting Grabbit...';
        setTimeout(() => {
          splash.style.opacity = '0';
          splash.style.transition = 'opacity 0.4s ease';
          setTimeout(() => {
            splash.style.display = 'none';
            document.querySelector('.app-shell').style.visibility = 'visible';
          }, 400);
        }, 600);
      } else if (error) {
        clearInterval(interval);
        title.textContent = 'Setup encountered an issue';
        sub.textContent   = 'Check your internet connection and restart Grabbit.';
        bar.style.background = '#ef4444';
      }
    } catch { /* server starting up */ }
  }, 1200);
})();

// ── Mandatory update wall ──────────────────────────────────
let _updateWallShown = false;

function showUpdateWall(version, downloadUrl) {
  if (_updateWallShown) return;
  _updateWallShown = true;

  const wall = document.createElement('div');
  wall.id = 'update-wall';
  wall.style.cssText = `
    position:fixed; inset:0; z-index:99999;
    background:rgba(0,0,0,0.92); backdrop-filter:blur(12px);
    display:flex; align-items:center; justify-content:center;
  `;
  wall.innerHTML = `
    <div style="
      background:#1c1c1e; border:1px solid rgba(255,255,255,0.18);
      border-radius:24px; padding:44px 40px; max-width:400px; width:92%;
      text-align:center; box-shadow:0 0 0 1px rgba(255,255,255,0.06), 0 32px 80px rgba(0,0,0,0.9);
    ">
      <div style="
        width:56px; height:56px; border-radius:16px; background:var(--secondary);
        display:flex; align-items:center; justify-content:center; margin:0 auto 22px;
      ">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </div>
      <div style="font-size:1.4rem; font-weight:800; color:var(--secondary); margin-bottom:8px;">
        Update required
      </div>
      <div style="font-size:0.88rem; color:var(--gray); margin-bottom:6px;">
        Grabbit <strong style="color:var(--secondary);">v${version}</strong> is available.
      </div>
      <div style="font-size:0.82rem; color:var(--gray); margin-bottom:32px; line-height:1.5;">
        This version is no longer supported.<br>Please update to continue using Grabbit.
      </div>
      <button id="update-wall-btn" style="
        width:100%; padding:13px; border:none; border-radius:12px;
        background:#ffffff; color:#000000; font-size:0.95rem;
        font-weight:700; cursor:pointer; font-family:var(--font);
        transition:opacity 0.15s;
      ">
        Download v${version}
      </button>
      <div id="update-wall-msg" style="font-size:0.78rem; color:var(--gray); margin-top:12px; min-height:18px;"></div>
    </div>
  `;
  document.body.appendChild(wall);

  document.getElementById('update-wall-btn').onclick = async () => {
    const btn = document.getElementById('update-wall-btn');
    const msg = document.getElementById('update-wall-msg');
    btn.textContent = 'Opening download...';
    btn.disabled    = true;
    try {
      const r = await fetch('/api/update/apply', { method: 'POST' });
      const d = await r.json();
      window.open(d.download_url || downloadUrl, '_blank');
      msg.textContent = 'Installer opened — install it and relaunch Grabbit.';
      btn.textContent = 'Download v' + '${version}';
      btn.disabled    = false;
    } catch {
      msg.textContent = 'Could not open download. Try again.';
      btn.textContent = 'Download v${version}';
      btn.disabled    = false;
    }
  };
}

async function checkForUpdates() {
  try {
    const res  = await fetch('/api/update/status');
    const data = await res.json();
    if (data.available) showUpdateWall(data.version, data.url);
  } catch { /* ignore — if check fails, don't block */ }
}

// Check 5s after load, then every 10 min
setTimeout(checkForUpdates, 5000);
setInterval(checkForUpdates, 10 * 60 * 1000);

window.isProOrTrial = function() {
  return !!localStorage.getItem('grabbit-license');
};

// ── Init ───────────────────────────────────────────────────
applyTheme(state.theme);
checkToolStatus();

