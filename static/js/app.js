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
  const isPro     = !!localStorage.getItem('grabbit-license');
  const isPremium = PREMIUM_THEMES.includes(theme);

  if (isPremium && !isPro) {
    // Delay to ensure queue.js showToast is available
    setTimeout(() => {
      if (window.showToast) window.showToast('Unlock Pro to use premium themes', 'info');
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
  queue: 'Queue',
  library: 'Library',
  settings: 'Settings',
  license: 'License',
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
    if (data.ready) return; // Tools already installed, show app normally
  } catch { return; }

  // Show splash
  splash.style.display = 'flex';
  document.querySelector('.app-shell').style.visibility = 'hidden';

  const statusMap = {
    ok:         { icon: '✓', color: '#22c55e' },
    installing: { icon: '⬇', color: 'var(--accent)' },
    updating:   { icon: '⟳', color: 'var(--accent)' },
    checking:   { icon: '⟳', color: 'var(--text-muted)' },
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

// ── Auto-update notification ───────────────────────────────
async function checkForUpdates() {
  try {
    const res  = await fetch('/api/update/status');
    const data = await res.json();
    if (!data.available) return;

    // Show persistent toast with update button
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:var(--card-bg); border:1px solid var(--accent);
      border-radius:12px; padding:14px 20px; z-index:9998;
      display:flex; align-items:center; gap:16px;
      box-shadow:0 8px 32px rgba(0,0,0,0.4);
      font-size:0.88rem; color:var(--text-primary);
      animation:slideUp 0.3s ease;
    `;
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>Grabbit <strong style="color:var(--accent);">v${data.version}</strong> is available</span>
      <button id="update-now-btn" style="
        background:var(--accent); color:#fff; border:none; border-radius:8px;
        padding:6px 14px; font-size:0.82rem; font-weight:600; cursor:pointer;
      ">Update now</button>
      <button id="update-dismiss-btn" style="
        background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1.1rem; line-height:1;
      ">×</button>
    `;
    document.body.appendChild(toast);

    document.getElementById('update-now-btn').onclick = async () => {
      toast.querySelector('#update-now-btn').textContent = 'Downloading...';
      toast.querySelector('#update-now-btn').disabled = true;
      const r = await fetch('/api/update/apply', { method: 'POST' });
      const d = await r.json();
      if (d.releases_url) window.open(d.releases_url, '_blank');
    };
    document.getElementById('update-dismiss-btn').onclick = () => toast.remove();
  } catch { /* ignore */ }
}

// Check for updates 5s after load (give server time to check GitHub)
setTimeout(checkForUpdates, 5000);

// ── Init ───────────────────────────────────────────────────
applyTheme(state.theme);
checkToolStatus();