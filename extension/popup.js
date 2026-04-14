/* ============================================================
   GRABBIT — popup.js
   Extension popup logic
   ============================================================ */

const SERVER = 'http://localhost:5000';
const FREE_DAILY_LIMIT = 2;

const PLATFORM_LABELS = {
  youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram',
  facebook: 'Facebook', twitter: 'X / Twitter', pinterest: 'Pinterest',
  twitch: 'Twitch', soundcloud: 'SoundCloud', other: 'Unknown',
};

let currentUrl      = '';
let currentPlatform = '';
let currentInfo     = null;
let selectedFormat  = 'video+audio';
let selectedQuality = 'best';
let activeJobId     = null;
let pollInterval    = null;

// ── Helpers ────────────────────────────────────────────────
function getTodayKey() {
  return `grabbit-downloads-${new Date().toISOString().slice(0, 10)}`;
}

function getDailyCount() {
  return parseInt(localStorage.getItem(getTodayKey()) || '0', 10);
}

function incrementDailyCount() {
  const key   = getTodayKey();
  const count = getDailyCount() + 1;
  localStorage.setItem(key, String(count));
  return count;
}

function isPro() {
  return !!localStorage.getItem('grabbit-license');
}

function getRemainingToday() {
  if (isPro()) return Infinity;
  return Math.max(0, FREE_DAILY_LIMIT - getDailyCount());
}

function formatDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

// ── Show / hide sections ───────────────────────────────────
function showSection(id) {
  ['loading', 'offline', 'unsupported', 'main'].forEach(s => {
    document.getElementById(s).style.display = s === id ? (s === 'main' ? 'block' : 'flex') : 'none';
  });
}

// ── Server ping ────────────────────────────────────────────
async function checkServer() {
  try {
    const res = await fetch(`${SERVER}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      document.getElementById('status-dot').className  = 'status-dot online';
      document.getElementById('status-text').textContent = 'Connected';
      return true;
    }
  } catch {}
  document.getElementById('status-dot').className  = 'status-dot offline';
  document.getElementById('status-text').textContent = 'Offline';
  return false;
}

// ── Platform badge ─────────────────────────────────────────
function setPlatformBadge(platform) {
  const badge = document.getElementById('platform-badge');
  const name  = document.getElementById('platform-name');
  badge.className  = `platform-badge ${platform || ''}`;
  name.textContent = PLATFORM_LABELS[platform] || 'Unknown';
}

// ── Daily limit indicator ──────────────────────────────────
async function updateLimitPill() {
  const pill = document.getElementById('limit-pill');
  try {
    const res    = await fetch(`${SERVER}/api/settings`);
    const config = await res.json();
    const code   = config.license_code || '';
    const res2   = await fetch(`${SERVER}/api/limits/status?license=${encodeURIComponent(code)}`);
    const limits = await res2.json();
    if (limits.is_pro) {
      pill.textContent = 'Pro — Unlimited';
      pill.className   = 'limit-pill';
      pill.style.color = '#22c55e';
    } else {
      pill.textContent = `${limits.remaining}/${limits.limit} left today`;
      pill.className   = `limit-pill${limits.remaining <= 1 ? ' warn' : ''}`;
      pill.style.color = '';
    }
  } catch {
    pill.textContent = '';
  }
}

// ── Fetch video info ───────────────────────────────────────
async function fetchVideoInfo(url) {
  try {
    const res  = await fetch(`${SERVER}/api/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  } catch (e) {
    throw e;
  }
}

// ── Render video info ──────────────────────────────────────
function renderVideoInfo(info) {
  document.getElementById('video-title').textContent = info.title || 'Unknown title';
  document.getElementById('video-meta').textContent  =
    [info.channel, formatDuration(info.duration)].filter(Boolean).join(' · ');

  const thumb = document.getElementById('video-thumb');
  if (info.thumbnail) {
    thumb.src = `${SERVER}/api/thumbnail?url=${encodeURIComponent(info.thumbnail)}`;
    thumb.style.display = 'block';
    thumb.addEventListener('error', function() { thumb.style.display = 'none'; }, { once: true });
  } else {
    thumb.style.display = 'none';
  }

  // Enable add button if limit allows
  const addBtn = document.getElementById('add-btn');
  if (getRemainingToday() > 0) {
    addBtn.disabled     = false;
    addBtn.innerHTML    = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Add to Queue
    `;
  } else {
    addBtn.disabled     = true;
    addBtn.textContent  = 'Daily limit reached';
  }
}

// ── Add to queue ───────────────────────────────────────────
async function addToQueue() {
  if (!currentInfo) return;

  const addBtn = document.getElementById('add-btn');
  addBtn.disabled    = true;
  addBtn.textContent = 'Checking...';

  try {
    const licenseCode = localStorage.getItem('grabbit-license') || '';
    const limRes  = await fetch(`${SERVER}/api/limits/status?license=${encodeURIComponent(licenseCode)}`);
    const limits  = await limRes.json();

    if (!limits.allowed) {
      showToast(`Daily limit reached (${limits.limit}/day). Upgrade to Pro!`, 'error');
      addBtn.disabled    = false;
      addBtn.textContent = 'Limit reached';
      return;
    }

    addBtn.textContent = 'Adding...';
    const saveFolder = localStorage.getItem('grabbit-save-folder') || '';

    const res  = await fetch(`${SERVER}/api/download`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url:         currentUrl,
        item_id:     `ext_${Date.now()}`,
        title:       currentInfo?.title     || '',
        thumbnail:   currentInfo?.thumbnail || '',
        platform:    currentInfo?.platform  || '',
        quality:     selectedQuality,
        audio_only:  selectedFormat === 'audio',
        no_audio:    selectedFormat === 'video',
        start_time:  '',
        end_time:    '',
        save_folder: saveFolder,
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    // Server already incremented counter in /api/download
    activeJobId = data.job_id;
    showToast('Added to queue ✓', 'success');
    startPolling(data.job_id);
    updateLimitPill();

    addBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      In Queue
    `;

  } catch (e) {
    addBtn.disabled    = false;
    addBtn.textContent = 'Add to Queue';
    showToast(e.message || 'Failed to add', 'error');
  }
}

// ── Poll download progress ─────────────────────────────────
function startPolling(jobId) {
  const wrap = document.getElementById('progress-wrap');
  const fill = document.getElementById('progress-fill');
  wrap.style.display = 'block';

  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const res  = await fetch(`${SERVER}/api/progress/${jobId}`);
      const data = await res.json();
      const pct  = data.pct || 0;

      fill.style.width = `${pct}%`;

      if (data.status === 'done') {
        clearInterval(pollInterval);
        fill.style.width = '100%';
        fill.style.background = '#22c55e';
        showToast('Download complete ✓', 'success');
        document.getElementById('add-btn').textContent = 'Downloaded ✓';
        updateQueueCount();
      }

      if (data.status === 'error') {
        clearInterval(pollInterval);
        wrap.style.display = 'none';
        showToast(data.msg || 'Download failed', 'error');
        const addBtn = document.getElementById('add-btn');
        addBtn.disabled    = false;
        addBtn.textContent = 'Try Again';
      }
    } catch { clearInterval(pollInterval); }
  }, 800);
}

// ── Queue count ────────────────────────────────────────────
async function updateQueueCount() {
  try {
    const res  = await fetch(`${SERVER}/api/queue/state`);
    const data = await res.json();
    const active = (data.items || []).filter(i =>
      i.status === 'downloading' || i.status === 'pending'
    ).length;
    const el = document.getElementById('queue-count');
    el.textContent = active > 0 ? `${active} downloading` : '';
  } catch {}
}

// ── Toast ──────────────────────────────────────────────────
let toastTimeout;
function showToast(msg, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  clearTimeout(toastTimeout);

  const toast = document.createElement('div');
  toast.className  = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);

  toastTimeout = setTimeout(() => toast.remove(), 3000);
}

// ── Chip selection ─────────────────────────────────────────
document.querySelectorAll('#format-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#format-chips .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    selectedFormat = chip.dataset.value;
  });
});

document.querySelectorAll('#quality-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#quality-chips .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    selectedQuality = chip.dataset.value;
  });
});

// ── Buttons ────────────────────────────────────────────────
document.getElementById('add-btn').addEventListener('click', addToQueue);

document.getElementById('open-app-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:5000' });
});

document.getElementById('open-library-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'http://localhost:5000/#library' });
});

// ── Init ──────────────────────────────────────────────────
async function init() {
  const online = await checkServer();
  if (!online) { showSection('offline'); return; }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showSection('unsupported'); return; }

  currentUrl = tab.url;

  let platform = null;
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
    platform = response?.platform;
    if (!platform) { showSection('unsupported'); return; }
  } catch {
    showSection('unsupported');
    return;
  }

  currentPlatform = platform;
  setPlatformBadge(platform);
  updateLimitPill();

  // Show loading state while fetching info
  showSection('loading');

  try {
    const info  = await fetchVideoInfo(currentUrl);
    currentInfo = info;
    // Now show main with the loaded info
    showSection('main');
    renderVideoInfo(info);
    updateQueueCount();
  } catch (e) {
    // Still show main but with error message
    showSection('main');
    document.getElementById('video-title').textContent = 'Could not load video info';
    document.getElementById('video-meta').textContent  = e.message || '';
  }
}

init();