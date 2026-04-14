/* ============================================================
   GRABBIT — download.js
   URL input, platform detection, fetch video info, add to queue
   ============================================================ */

const urlInput    = document.getElementById('url-input');
const fetchBtn    = document.getElementById('fetch-btn');
const clearBtn    = document.getElementById('clear-btn');
const addQueueBtn = document.getElementById('add-queue-btn');
const optionsCard = document.getElementById('options-card');
const previewEl   = document.getElementById('video-preview');
const downloadHint = document.getElementById('download-hint');
const platformRow = document.getElementById('platform-row');

let currentInfo = null;
let selectedFormat = 'video+audio';
let selectedQuality = 'best';

// ── Platform detection ─────────────────────────────────────
const platforms = {
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'tiktok.com': 'tiktok',
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'fb.watch': 'facebook',
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'pinterest.com': 'pinterest',
  'pin.it': 'pinterest',
  'twitch.tv': 'twitch',
  'soundcloud.com': 'soundcloud',
};

const platformLabels = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X / Twitter',
  pinterest: 'Pinterest',
  twitch: 'Twitch',
  soundcloud: 'SoundCloud',
};

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    for (const [domain, id] of Object.entries(platforms)) {
      if (host.includes(domain)) return id;
    }
  } catch { /* invalid URL */ }
  return null;
}

function showPlatformBadge(platformId) {
  const badge = document.getElementById('platform-badge');
  const name  = document.getElementById('platform-name');
  badge.className = 'platform-badge ' + (platformId || '');
  name.textContent = platformLabels[platformId] || 'Unknown';
  platformRow.style.display = platformId ? 'block' : 'none';
}

// ── Live platform detection on input ──────────────────────
urlInput.addEventListener('input', () => {
  const url = urlInput.value.trim();
  if (!url) {
    showPlatformBadge(null);
    return;
  }
  const platform = detectPlatform(url);
  showPlatformBadge(platform);
});

// ── Fetch video info ───────────────────────────────────────
async function fetchInfo() {
  const url = urlInput.value.trim();
  if (!url) return;

  fetchBtn.disabled = true;
  fetchBtn.innerHTML = `
    <svg style="animation:spin 0.8s linear infinite;width:15px;height:15px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-.07-8.5"/>
    </svg>
    Fetching...
  `;

  try {
    const res  = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    currentInfo = { ...data, url };
    showPreview(data);
    showOptions();

  } catch (err) {
    showError(err.message || 'Could not fetch video info. Check the URL.');
  } finally {
    fetchBtn.disabled = false;
    fetchBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      Fetch
    `;
  }
}

function showPreview(data) {
  document.getElementById('preview-title').textContent = data.title || 'Unknown title';
  document.getElementById('preview-channel').textContent = data.channel || '';
  document.getElementById('preview-duration').textContent = data.duration ? formatDuration(data.duration) : '';

  const thumb = document.getElementById('preview-thumb');
  if (data.thumbnail) {
    // Use proxy to avoid CORS issues with Instagram/Facebook thumbnails
    thumb.src = `/api/thumbnail?url=${encodeURIComponent(data.thumbnail)}`;
    thumb.style.display = 'block';
    thumb.onerror = () => { thumb.style.display = 'none'; };
  } else {
    thumb.style.display = 'none';
  }

  previewEl.style.display = 'flex';
  downloadHint.style.display = 'none';
}

function showOptions() {
  optionsCard.style.display = 'block';
  optionsCard.style.animation = 'slideUp 0.25s ease forwards';
}

function showError(msg) {
  const errEl = document.createElement('div');
  errEl.style.cssText = 'color:#ef4444;font-size:0.82rem;margin-top:8px;padding:10px 14px;background:rgba(239,68,68,0.08);border-radius:8px;border:1px solid rgba(239,68,68,0.2);';
  errEl.textContent = '⚠ ' + msg;

  const existing = document.querySelector('.fetch-error');
  if (existing) existing.remove();
  errEl.classList.add('fetch-error');
  urlInput.parentElement.parentElement.appendChild(errEl);
  setTimeout(() => errEl.remove(), 5000);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

fetchBtn.addEventListener('click', fetchInfo);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchInfo(); });

// ── Download limits — server is authoritative ──────────────
const FREE_DAILY_LIMIT  = 2;
const PRO_MULTI_LIMIT   = 4;

function isPro() {
  return !!localStorage.getItem('grabbit-license');
}

async function syncDailyCounter() {
  try {
    const code = localStorage.getItem('grabbit-license') || '';
    const res  = await fetch(`/api/limits/status?license=${encodeURIComponent(code)}`);
    const data = await res.json();
    updateDailyCounterUI(data.remaining, data.limit, data.is_pro);

    // Update topbar license pill
    const pill = document.getElementById('license-pill');
    if (pill) {
      if (data.is_pro) {
        pill.className   = 'status-pill done';
        pill.textContent = 'Pro';
      } else {
        pill.className   = 'status-pill waiting';
        pill.textContent = 'Free';
      }
    }

    return data;
  } catch { return null; }
}

function updateDailyCounterUI(remaining, limit, pro) {
  const el = document.getElementById('daily-counter');
  if (!el) return;
  if (pro) {
    el.style.display = 'inline';
    el.textContent   = 'Pro — Unlimited';
    el.style.color   = '#22c55e';
    return;
  }
  el.style.display = 'inline';
  el.textContent   = `${remaining}/${limit} downloads left today`;
  el.style.color   = remaining <= 1 ? '#ef4444' : 'var(--text-muted)';
}

async function checkDailyLimit(count = 1) {
  const data = await syncDailyCounter();
  if (!data) return true; // allow if server unreachable
  if (data.is_pro) return true;
  if (data.remaining < count) {
    if (data.remaining === 0) {
      showLimitToast(`You've reached your ${data.limit} downloads/day limit. Upgrade to Pro.`);
    } else {
      showLimitToast(`Only ${data.remaining} download${data.remaining !== 1 ? 's' : ''} left today.`);
    }
    return false;
  }
  return true;
}

function showLimitToast(msg) {
  if (window.showToast) showToast(msg, 'error', 6000);
  setTimeout(() => navigateTo('license'), 1500);
}

// ── Multi-link detection ───────────────────────────────────
urlInput.addEventListener('paste', (e) => {
  setTimeout(() => {
    const text = urlInput.value.trim();
    const urls = extractUrls(text);
    if (urls.length > 1) {
      handleMultiDetected(urls);
    }
  }, 10);
});

urlInput.addEventListener('input', () => {
  const text = urlInput.value.trim();
  const urls = extractUrls(text);
  if (urls.length > 1) {
    handleMultiDetected(urls);
  }
});

function handleMultiDetected(urls) {
  if (!isPro()) {
    // Free — block multi-link entirely
    urlInput.value = urls[0] || '';
    if (window.showToast) showToast('Multi-link is a Pro feature. Add links one at a time on the Free plan.', 'error', 5000);
    return;
  }

  // Pro — cap at 4
  const capped = urls.slice(0, PRO_MULTI_LIMIT);
  if (urls.length > PRO_MULTI_LIMIT) {
    if (window.showToast) showToast(`Pro plan supports up to ${PRO_MULTI_LIMIT} links at once. ${urls.length - PRO_MULTI_LIMIT} link${urls.length - PRO_MULTI_LIMIT > 1 ? 's were' : ' was'} removed.`, 'info', 5000);
  }
  showMultiLink(capped);
}

function extractUrls(text) {
  const raw = text.split(/(?=https?:\/\/)/g)
    .map(s => s.trim())
    .filter(s => s.startsWith('http'));
  return raw.map(u => u.replace(/[\s,;|]+$/, '')).filter(u => u.length > 10);
}

// ── Segment toggle ─────────────────────────────────────────
document.getElementById('segment-toggle')?.addEventListener('change', function() {
  const inputs = document.getElementById('segment-inputs');
  if (inputs) inputs.style.display = this.checked ? 'block' : 'none';
  if (!this.checked) {
    document.getElementById('start-time').value = '';
    document.getElementById('end-time').value = '';
  }
});

// Hide segment option when multi-link is shown
function showMultiLink(urls) {
  const area = document.getElementById('multi-link-area');
  const ta   = document.getElementById('multi-url-input');
  area.style.display = 'block';
  ta.value = urls.join('\n');
  updateMultiCount();
  urlInput.value = '';
  document.getElementById('platform-row').style.display = 'none';
  // Hide segment section for multi-link
  const seg = document.getElementById('segment-section');
  if (seg) seg.style.display = 'none';
}

function updateMultiCount() {
  const ta   = document.getElementById('multi-url-input');
  let urls   = extractUrls(ta.value);

  // Enforce cap silently in textarea too
  if (isPro() && urls.length > PRO_MULTI_LIMIT) {
    urls = urls.slice(0, PRO_MULTI_LIMIT);
    ta.value = urls.join('\n');
  }

  const countEl = document.getElementById('multi-link-count');
  if (countEl) {
    countEl.textContent = `${urls.length} / ${PRO_MULTI_LIMIT} links`;
    countEl.style.color = urls.length >= PRO_MULTI_LIMIT ? 'var(--accent)' : 'var(--text-muted)';
  }
  return urls;
}

document.getElementById('multi-url-input')?.addEventListener('input', updateMultiCount);

document.getElementById('multi-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('multi-link-area').style.display = 'none';
  document.getElementById('multi-url-input').value = '';
  // Restore segment section
  const seg = document.getElementById('segment-section');
  if (seg) seg.style.display = 'block';
});

document.getElementById('multi-add-btn')?.addEventListener('click', async () => {
  const ta         = document.getElementById('multi-url-input');
  const urls       = extractUrls(ta.value).slice(0, PRO_MULTI_LIMIT);
  const saveFolder = localStorage.getItem('grabbit-save-folder') || '';
  const format     = selectedFormat;
  const quality    = selectedQuality;

  if (urls.length === 0) return;
  if (!await checkDailyLimit(urls.length)) return;

  urls.forEach((url, index) => {
    const item = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      url,
      title: shortenUrl(url),
      thumbnail: '',
      platform: detectPlatform(url) || 'other',
      format,
      quality,
      startTime: '',
      endTime: '',
      saveFolder,
      status: 'waiting',
      pct: 0,
      speed: '',
    };
    window.addToQueue(item);
    fetchInfoAndUpdate(item, index * 500);
  });

  document.getElementById('multi-link-area').style.display = 'none';
  ta.value = '';
  navigateTo('queue');
  if (window.showToast) showToast(`${urls.length} videos added to queue`, 'info');
  setTimeout(syncDailyCounter, 1500);
});

async function fetchInfoAndUpdate(item, delayMs = 0) {
  if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
  try {
    const res  = await fetch('/api/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: item.url }),
    });
    const data = await res.json();
    if (data.error || !data.title) return;

    item.title     = data.title;
    item.thumbnail = data.thumbnail || '';
    item.platform  = data.platform  || item.platform;

    // Update title
    const titleEl = document.querySelector(`#queue-item-${item.id} .queue-title`);
    if (titleEl) titleEl.textContent = data.title;

    // Update thumbnail — always has an <img id="thumb-{id}"> now
    if (data.thumbnail) {
      const thumbEl = document.getElementById(`thumb-${item.id}`);
      if (thumbEl) {
        thumbEl.src   = `/api/thumbnail?url=${encodeURIComponent(data.thumbnail)}`;
        thumbEl.style.display = 'block';
      }
    }

    // Update platform badge
    const metaEl = document.querySelector(`#queue-item-${item.id} .queue-meta span:first-child`);
    if (metaEl) {
      const icons = { youtube:'📺', tiktok:'🎵', instagram:'📸', facebook:'👥',
                      twitter:'🐦', pinterest:'📌', twitch:'🎮', soundcloud:'🔊', other:'🔗' };
      metaEl.textContent = `${icons[data.platform]||'🔗'} ${data.platform||'Unknown'}`;
    }
  } catch { /* ignore */ }
}

function shortenUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname + u.pathname).slice(0, 50) + (url.length > 50 ? '...' : '');
  } catch {
    return url.slice(0, 50) + '...';
  }
}

// ── Format / Quality chips ─────────────────────────────────
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

addQueueBtn.addEventListener('click', async () => {
  if (!currentInfo) return;
  if (!await checkDailyLimit(1)) return;

  const segmentEnabled = document.getElementById('segment-toggle')?.checked;
  const startTime   = segmentEnabled ? document.getElementById('start-time').value.trim() : '';
  const endTime     = segmentEnabled ? document.getElementById('end-time').value.trim() : '';
  const saveFolder  = localStorage.getItem('grabbit-save-folder') || '';

  const item = {
    id: `dl_${Date.now()}`,
    url: currentInfo.url,
    title: currentInfo.title,
    thumbnail: currentInfo.thumbnail,
    platform: currentInfo.platform,
    format: selectedFormat,
    quality: selectedQuality,
    startTime,
    endTime,
    saveFolder,
    status: 'waiting',
    pct: 0,
    speed: '',
  };

  window.addToQueue(item);
  navigateTo('queue');
  resetDownloadPage();
  syncDailyCounter();
});

// ── Clear ──────────────────────────────────────────────────
clearBtn.addEventListener('click', resetDownloadPage);

function resetDownloadPage() {
  urlInput.value = '';
  currentInfo = null;
  selectedFormat = 'video+audio';
  selectedQuality = 'best';

  previewEl.style.display = 'none';
  optionsCard.style.display = 'none';
  downloadHint.style.display = 'block';
  showPlatformBadge(null);

  document.querySelectorAll('#format-chips .chip').forEach((c, i) => c.classList.toggle('selected', i === 0));
  document.querySelectorAll('#quality-chips .chip').forEach((c, i) => c.classList.toggle('selected', i === 0));
  const toggleEl = document.getElementById('segment-toggle');
  if (toggleEl) toggleEl.checked = false;
  const segInputs = document.getElementById('segment-inputs');
  if (segInputs) segInputs.style.display = 'none';
  const segSection = document.getElementById('segment-section');
  if (segSection) segSection.style.display = 'block';
  document.getElementById('start-time').value = '';
  document.getElementById('end-time').value = '';
  document.querySelector('.fetch-error')?.remove();
}

// CSS spin animation
const style = document.createElement('style');
style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
document.head.appendChild(style);

// Expose for other modules
window.syncDailyCounter = syncDailyCounter;

// Show daily counter on load from server
syncDailyCounter();
// Refresh counter every 15 seconds
setInterval(syncDailyCounter, 15000);