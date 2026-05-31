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

  // Block Pinterest share short links
  if (/pin\.it\//.test(url)) {
    if (window.showToast) {
      showToast(
        typeof t === 'function' ? t('toast_pin_it_blocked') : 'Pinterest short links are blocked. Open the pin in your browser and paste the full URL.',
        'error',
        5500
      );
    }
    // Clear input so user can paste the long URL right away
    urlInput.value = '';
    showPlatformBadge(null);
    // Show tip in single mode too — fade out after 8s
    const tipEl = document.getElementById('pinterest-tip-single');
    if (tipEl) {
      tipEl.style.display = 'block';
      clearTimeout(window._pinTipSingleTimeout);
      window._pinTipSingleTimeout = setTimeout(() => { tipEl.style.display = 'none'; }, 8000);
    }
    return;
  }

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
    // Clear the input so the user can paste the next link immediately
    urlInput.value = '';
    showPlatformBadge(null);

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
const PRO_MULTI_LIMIT   = 50;  // Pro can batch up to 50 links
const BATCH_FETCH_SIZE  = 3;   // fetch info 3 at a time to avoid overloading yt-dlp

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
        const haslicense = !!localStorage.getItem('grabbit-license');
        pill.textContent = haslicense ? 'Pro' : 'Trial';
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
    // Pro or Trial: hide the counter entirely
    el.style.display = 'none';
    return;
  }
  el.style.display = 'inline';
  el.textContent   = `${remaining}/${limit} downloads left today`;
  el.style.color   = remaining <= 1 ? '#ef4444' : 'var(--gray)';
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

function extractUrls(text) {
  const raw = text.split(/[\s,;|\n]+/g)
    .map(s => s.trim())
    .filter(s => s.startsWith('http'));
  return raw.filter(u => u.length > 10);
}

// ── Single mode: auto-redirect to batch if user pastes multiple ──
urlInput.addEventListener('paste', () => {
  setTimeout(() => {
    const urls = extractUrls(urlInput.value);
    if (urls.length > 1) {
      // Switch to batch mode and add all
      setDownloadMode('batch');
      urls.forEach(u => stagingAdd(u));
      urlInput.value = '';
    }
  }, 10);
});

// ── Segment toggle ─────────────────────────────────────────
document.getElementById('segment-toggle')?.addEventListener('change', function() {
  const inputs = document.getElementById('segment-inputs');
  if (inputs) inputs.style.display = this.checked ? 'block' : 'none';
  if (!this.checked) {
    document.getElementById('start-time').value = '';
    document.getElementById('end-time').value = '';
  }
});

// ── BATCH MODE ─────────────────────────────────────────────
const stagingList = [];
let batchSelectedFormat  = 'video+audio';
let batchSelectedQuality = 'best';

window.setDownloadMode = function(mode) {
  const singleEl = document.getElementById('single-mode');
  const batchEl  = document.getElementById('batch-mode');
  const transEl  = document.getElementById('transcript-mode');
  
  const singleBtn = document.getElementById('mode-single-btn');
  const batchBtn  = document.getElementById('mode-batch-btn');
  const transBtn  = document.getElementById('mode-transcript-btn');
  const hero      = document.querySelector('.download-hero');

  // Reset all
  if (singleEl) singleEl.style.display = 'none';
  if (batchEl)  batchEl.style.display  = 'none';
  if (transEl)  transEl.style.display  = 'none';
  if (singleBtn) singleBtn.classList.remove('active');
  if (batchBtn)  batchBtn.classList.remove('active');
  if (transBtn)  transBtn.classList.remove('active');
  if (hero) hero.classList.remove('batch-active', 'transcript-active');

  if (mode === 'batch') {
    if (batchEl) batchEl.style.display = 'block';
    if (batchBtn) batchBtn.classList.add('active');
    if (hero) hero.classList.add('batch-active');
  } else if (mode === 'transcript') {
    if (transEl) transEl.style.display = 'block';
    if (transBtn) transBtn.classList.add('active');
    if (hero) hero.classList.add('transcript-active');
  } else {
    if (singleEl) singleEl.style.display = 'block';
    if (singleBtn) singleBtn.classList.add('active');
  }
};

function stagingAdd(url) {
  url = url.trim();
  if (!url || !url.startsWith('http')) return false;

  // Block Pinterest share short links — they're systematically bot-detected
  if (/pin\.it\//.test(url)) {
    if (window.showToast) {
      showToast(
        typeof t === 'function' ? t('toast_pin_it_blocked') : 'Pinterest short links are blocked. Open the pin in your browser and paste the full URL.',
        'error',
        5500
      );
    }
    // Briefly show the Pinterest tip banner as additional context, then fade out
    const tipEl = document.getElementById('pinterest-tip');
    if (tipEl) {
      tipEl.style.display = 'block';
      clearTimeout(window._pinTipTimeout);
      window._pinTipTimeout = setTimeout(() => { tipEl.style.display = 'none'; }, 8000);
    }
    return false;
  }

  if (stagingList.find(s => s.url === url)) return false; // dedupe

  const item = {
    id: `st_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    url,
    platform: detectPlatform(url) || 'other',
  };
  stagingList.push(item);
  renderStagingItem(item);
  updateStagingCount();
  return true;
}

function renderStagingItem(item) {
  const list = document.getElementById('batch-staging-list');
  if (!list) return;

  const el = document.createElement('div');
  el.className = 'staging-item';
  el.id = `staging-${item.id}`;
  const platformName = platformLabels[item.platform] || 'Link';

  el.innerHTML = `
    <span class="staging-platform">${platformIcons2[item.platform] || '🔗'} ${platformName}</span>
    <span class="staging-url">${item.url}</span>
    <button class="staging-remove" onclick="stagingRemove('${item.id}')" title="Remove">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  list.appendChild(el);
}

const platformIcons2 = {
  youtube:'📺', tiktok:'🎵', instagram:'📸', facebook:'👥',
  twitter:'🐦', pinterest:'📌', twitch:'🎮', soundcloud:'🔊', other:'🔗',
};

window.stagingRemove = function(id) {
  const idx = stagingList.findIndex(s => s.id === id);
  if (idx !== -1) stagingList.splice(idx, 1);
  document.getElementById(`staging-${id}`)?.remove();
  updateStagingCount();
};

window.batchClearAll = function() {
  stagingList.length = 0;
  document.getElementById('batch-staging-list').innerHTML = '';
  updateStagingCount();
};

function updateStagingCount() {
  const countEl   = document.getElementById('batch-count');
  const optionsEl = document.getElementById('batch-options');
  const clearBtn  = document.getElementById('batch-clear-all-btn');
  const dlLabel   = document.getElementById('batch-download-label');
  const tipEl     = document.getElementById('pinterest-tip');
  const n = stagingList.length;

  if (n === 0) {
    countEl.textContent = typeof t === 'function' ? t('batch_empty') : 'No links yet';
    countEl.style.color = 'var(--gray)';
    optionsEl.style.display = 'none';
    clearBtn.style.display  = 'none';
  } else {
    const linkWord = n === 1 ? 'link' : 'links';
    countEl.textContent = `${n} ${linkWord}`;
    countEl.style.color = 'var(--secondary)';
    optionsEl.style.display = 'block';
    clearBtn.style.display  = 'inline-flex';
    if (dlLabel && typeof t === 'function') {
      dlLabel.textContent = t('batch_add_all').replace('{n}', n);
    }
  }

  // Pinterest tip is now shown only when user tries to paste a pin.it/ short link
  // (managed inside stagingAdd) — long Pinterest URLs work fine without warning.
}

// Batch URL input — auto-add on paste/enter
const batchInput = document.getElementById('batch-url-input');
batchInput?.addEventListener('paste', () => {
  setTimeout(() => {
    const text = batchInput.value;
    const urls = extractUrls(text);
    if (urls.length > 0) {
      urls.forEach(u => stagingAdd(u));
      batchInput.value = '';
    }
  }, 10);
});

batchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const urls = extractUrls(batchInput.value);
    urls.forEach(u => stagingAdd(u));
    batchInput.value = '';
  }
});

document.getElementById('batch-add-btn')?.addEventListener('click', () => {
  const urls = extractUrls(batchInput.value);
  urls.forEach(u => stagingAdd(u));
  batchInput.value = '';
  batchInput.focus();
});

// Format/quality chips for batch mode
document.querySelectorAll('#batch-format-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#batch-format-chips .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    batchSelectedFormat = chip.dataset.value;
  });
});

document.querySelectorAll('#batch-quality-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#batch-quality-chips .chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    batchSelectedQuality = chip.dataset.value;
  });
});

// File upload (.txt)
const fileInput = document.getElementById('batch-file-input');
document.getElementById('batch-upload-btn')?.addEventListener('click', () => fileInput?.click());

fileInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const urls = extractUrls(text);
  let added = 0;
  urls.forEach(u => { if (stagingAdd(u)) added++; });
  if (window.showToast) showToast(`${added} links added from ${file.name}`, 'info');
  fileInput.value = '';
});

// Drag & drop
const dropzone = document.getElementById('batch-dropzone');
dropzone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
dropzone?.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file || !file.name.endsWith('.txt')) {
    if (window.showToast) showToast('Only .txt files are supported', 'error');
    return;
  }
  const text = await file.text();
  const urls = extractUrls(text);
  let added = 0;
  urls.forEach(u => { if (stagingAdd(u)) added++; });
  if (window.showToast) showToast(`${added} links added from ${file.name}`, 'info');
});

// Download all button
document.getElementById('batch-download-btn')?.addEventListener('click', async () => {
  if (stagingList.length === 0) return;
  if (!await checkDailyLimit(stagingList.length)) return;

  const saveFolder = localStorage.getItem('grabbit-save-folder') || '';
  const format     = batchSelectedFormat;
  const quality    = batchSelectedQuality;

  // Add all items to queue immediately with placeholder titles
  const items = stagingList.map(staging => {
    const item = {
      id: `dl_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      url:       staging.url,
      title:     shortenUrl(staging.url),
      thumbnail: '',
      platform:  staging.platform,
      format, quality,
      startTime: '', endTime: '',
      saveFolder,
      status: 'waiting', pct: 0, speed: '',
    };
    window.addToQueue(item);
    return item;
  });

  // Clear staging
  batchClearAll();
  navigateTo('queue');

  // Fetch info in batches to avoid saturating yt-dlp
  fetchInfoInBatches(items);
  setTimeout(syncDailyCounter, 1500);
});

async function fetchInfoAndUpdate(item) {
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

    const titleEl = document.querySelector(`#queue-item-${item.id} .queue-title`);
    if (titleEl) titleEl.textContent = data.title;

    if (data.thumbnail) {
      const thumbEl = document.getElementById(`thumb-${item.id}`);
      if (thumbEl) {
        thumbEl.src = `/api/thumbnail?url=${encodeURIComponent(data.thumbnail)}`;
        thumbEl.style.display = 'block';
      }
    }

    const metaEl = document.querySelector(`#queue-item-${item.id} .queue-meta span:first-child`);
    if (metaEl) {
      const icons = { youtube:'📺', tiktok:'🎵', instagram:'📸', facebook:'👥',
                      twitter:'🐦', pinterest:'📌', twitch:'🎮', soundcloud:'🔊', other:'🔗' };
      metaEl.textContent = `${icons[data.platform]||'🔗'} ${data.platform||'Unknown'}`;
    }
  } catch { /* ignore — item stays with URL as title */ }
}

async function fetchInfoInBatches(items) {
  const total = items.length;
  let done = 0, failed = 0;

  // Show toast progress
  const showProgress = () => {
    const current = done + failed;
    if (current < total && window.showToast) {
      showToast(
        t('batch_fetching').replace('{current}', current + 1).replace('{total}', total),
        'info', 2000
      );
    }
  };

  // Process in batches of BATCH_FETCH_SIZE
  for (let i = 0; i < items.length; i += BATCH_FETCH_SIZE) {
    const batch = items.slice(i, i + BATCH_FETCH_SIZE);
    showProgress();
    await Promise.all(batch.map(async item => {
      try {
        await fetchInfoAndUpdate(item);
        done++;
      } catch {
        failed++;
      }
    }));
  }

  // Final summary toast
  if (failed > 0 && window.showToast) {
    showToast(
      t('batch_partial').replace('{ok}', done).replace('{total}', total).replace('{fail}', failed),
      'info', 4000
    );
  } else if (window.showToast) {
    showToast(t('batch_done').replace('{n}', done), 'info');
  }
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

// ── TRANSCRIPT MODE ────────────────────────────────────────

const transUrlInput    = document.getElementById('transcript-url-input');
const transFetchBtn    = document.getElementById('transcript-fetch-btn');
const transClearBtn    = document.getElementById('transcript-clear-btn');
const transAddQueueBtn = document.getElementById('transcript-add-queue-btn');
const transOptionsCard = document.getElementById('transcript-options-card');
const transPreviewEl   = document.getElementById('transcript-video-preview');
const transHint        = document.getElementById('transcript-hint');

let transCurrentInfo = null;

transUrlInput?.addEventListener('input', () => {
  const url      = transUrlInput.value.trim();
  const platform = detectPlatform(url);
  if (url && platform !== 'youtube') {
    if (window.showToast) showToast(typeof t === 'function' ? t('transcript_youtube_only') : 'Transcripts are only supported for YouTube videos.', 'error');
    transFetchBtn.disabled = true;
  } else {
    transFetchBtn.disabled = false;
  }
});

transUrlInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); if (!transFetchBtn.disabled) transFetchInfo(); }
});
transFetchBtn?.addEventListener('click', transFetchInfo);

async function transFetchInfo() {
  const url = transUrlInput.value.trim();
  if (!url) return;
  if (detectPlatform(url) !== 'youtube') {
    if (window.showToast) showToast(typeof t === 'function' ? t('transcript_youtube_only') : 'Only YouTube URLs are supported.', 'error');
    return;
  }

  transFetchBtn.disabled = true;
  transFetchBtn.innerHTML = `
    <svg style="animation:spin 0.8s linear infinite;width:15px;height:15px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.07-8.5"/>
    </svg>
    ${typeof t === 'function' ? t('btn_fetching') : 'Fetching...'}
  `;

  try {
    const res  = await fetch('/api/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    transCurrentInfo = { ...data, url };

    document.getElementById('transcript-preview-title').textContent    = data.title    || '';
    document.getElementById('transcript-preview-channel').textContent  = data.channel  || '';
    document.getElementById('transcript-preview-duration').textContent = data.duration ? formatDuration(data.duration) : '';

    const thumb = document.getElementById('transcript-preview-thumb');
    if (data.thumbnail) {
      thumb.src = `/api/thumbnail?url=${encodeURIComponent(data.thumbnail)}`;
      thumb.style.display = 'block';
    } else {
      thumb.style.display = 'none';
    }

    transPreviewEl.style.display   = 'block';
    transHint.style.display        = 'none';
    transOptionsCard.style.display = 'block';
    transUrlInput.value = '';

    // ── Caption availability ───────────────────────────────
    _updateTranscriptLangAvailability(data.available_langs || []);

  } catch (err) {
    if (window.showToast) showToast(err.message || (typeof t === 'function' ? t('err_fetch_failed') : 'Could not fetch video info.'), 'error');
  } finally {
    transFetchBtn.disabled = false;
    transFetchBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <span>${typeof t === 'function' ? t('btn_fetch') : 'Fetch'}</span>
    `;
  }
}

// ── Caption availability helpers ───────────────────────────
function _updateTranscriptLangAvailability(availLangs) {
  const warnEl = document.getElementById('transcript-subs-warn');
  const okEl   = document.getElementById('transcript-subs-ok');
  const addBtn = document.getElementById('transcript-add-queue-btn');
  const noSubs = availLangs.length === 0;
  if (warnEl) warnEl.style.display = noSubs ? '' : 'none';
  if (okEl)   okEl.style.display   = noSubs ? 'none' : '';
  if (addBtn) addBtn.disabled       = noSubs;
}

function _resetTranscriptLangUI() {
  const warnEl = document.getElementById('transcript-subs-warn');
  const okEl   = document.getElementById('transcript-subs-ok');
  const addBtn = document.getElementById('transcript-add-queue-btn');
  if (warnEl) warnEl.style.display = 'none';
  if (okEl)   okEl.style.display   = 'none';
  if (addBtn) addBtn.disabled       = false;
}

transClearBtn?.addEventListener('click', () => {
  transUrlInput.value            = '';
  transCurrentInfo               = null;
  transPreviewEl.style.display   = 'none';
  transOptionsCard.style.display = 'none';
  transHint.style.display        = 'block';
  _resetTranscriptLangUI();
});

transAddQueueBtn?.addEventListener('click', async () => {
  if (!transCurrentInfo) return;
  if (!await checkDailyLimit(1)) return;

  const saveFolder = localStorage.getItem('grabbit-save-folder') || '';
  const item = {
    id:              `dl_${Date.now()}`,
    url:             transCurrentInfo.url,
    title:           transCurrentInfo.title,
    thumbnail:       transCurrentInfo.thumbnail,
    platform:        transCurrentInfo.platform,
    format:          'text',
    transcript_lang: transCurrentInfo.original_lang || '',
    quality:         'best',
    startTime:       '',
    endTime:         '',
    saveFolder,
    status:          'waiting',
    pct:             0,
    speed:           '',
  };
  window.addToQueue(item);
  navigateTo('queue');
  transClearBtn.click();
  syncDailyCounter();
});


