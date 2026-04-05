/* ============================================================
   GRABBIT — queue.js
   Queue rendering, progress polling, persistence, auto-resume
   ============================================================ */

const queueList  = document.getElementById('queue-list');
const queueEmpty = document.getElementById('queue-empty');
const queue      = [];
const pollers    = {};

const platformIcons = {
  youtube: '📺', tiktok: '🎵', instagram: '📸', facebook: '👥',
  twitter: '🐦', pinterest: '📌', twitch: '🎮', soundcloud: '🔊', other: '🔗',
};

// ─── Friendly error messages by platform ──────────────────
const platformNames = {
  youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram',
  facebook: 'Facebook', twitter: 'X / Twitter', pinterest: 'Pinterest',
  twitch: 'Twitch', soundcloud: 'SoundCloud', other: 'this platform',
};

// ─── Add item ──────────────────────────────────────────────
window.addToQueue = function(item) {
  queue.push(item);
  renderQueueItem(item);
  updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
  persistQueue();
  startDownload(item);
};

// ─── Render ────────────────────────────────────────────────
function renderQueueItem(item) {
  queueEmpty.style.display = 'none';

  const el = document.createElement('div');
  el.className = 'queue-item';
  el.id = `queue-item-${item.id}`;

  const thumbSrc = item.thumbnail
    ? `/api/thumbnail?url=${encodeURIComponent(item.thumbnail)}`
    : `/api/placeholder_thumb?platform=${item.platform || 'other'}`;

  el.innerHTML = `
    <img class="queue-thumb" id="thumb-${item.id}"
      src="${thumbSrc}"
      alt=""
      data-platform="${item.platform || 'other'}"
      onerror="this.src='/api/placeholder_thumb?platform=${item.platform || 'other'}'" />
    <div class="queue-info">
      <div class="queue-title">${escapeHtml(item.title)}</div>
      <div class="queue-meta">
        <span>${platformIcons[item.platform] || '🔗'} ${item.platform || 'Unknown'}</span>
        <span>${formatLabel(item.format)}</span>
        <span>${item.quality === 'best' ? 'Best quality' : item.quality + 'p'}</span>
        ${item.startTime ? `<span>✂ ${item.startTime}–${item.endTime || 'end'}</span>` : ''}
        <span class="status-pill waiting" id="status-${item.id}">Waiting</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" id="progress-${item.id}" style="width:0%"></div>
      </div>
    </div>
    <div class="queue-stats">
      <div class="queue-pct" id="pct-${item.id}">0%</div>
      <div class="queue-speed" id="speed-${item.id}"></div>
    </div>
    <div class="queue-actions">
      <button class="btn btn-ghost btn-icon" title="Remove" onclick="removeQueueItem('${item.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </div>
  `;

  queueList.insertBefore(el, queueEmpty);
}

// ─── Start download ────────────────────────────────────────
async function startDownload(item) {
  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url:         item.url,
        item_id:     item.id,
        quality:     item.quality,
        audio_only:  item.format === 'audio',
        no_audio:    item.format === 'video',
        start_time:  item.startTime  || '',
        end_time:    item.endTime    || '',
        save_folder: item.saveFolder || '',
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error);

    item.jobId = data.job_id;
    pollProgress(item);

  } catch (err) {
    handleError(item, err.message, 'other');
  }
}

// ─── Poll progress ─────────────────────────────────────────
function pollProgress(item) {
  if (pollers[item.id]) clearInterval(pollers[item.id]);

  pollers[item.id] = setInterval(async () => {
    try {
      const res  = await fetch(`/api/progress/${item.jobId}`);
      const data = await res.json();

      updateItemUI(item.id, data);

      if (data.status === 'done') {
        clearInterval(pollers[item.id]);
        delete pollers[item.id];
        item.status = 'done';
        persistQueue();

        // Re-fetch latest item data from server
        try {
          const stateRes  = await fetch('/api/queue/state');
          const stateData = await stateRes.json();
          const serverItem = (stateData.items || []).find(i => i.id === item.id);
          if (serverItem) {
            if (serverItem.title && !serverItem.title.startsWith('http')) item.title = serverItem.title;
            if (serverItem.thumbnail) item.thumbnail = serverItem.thumbnail;
            if (serverItem.platform) item.platform = serverItem.platform;
          }
        } catch { /* ignore */ }

        window.addToLibrary && window.addToLibrary({
          id:         item.id,
          title:      item.title,
          thumbnail:  item.thumbnail,
          platform:   item.platform,
          format:     item.format,
          quality:    item.quality,
          date:       new Date().toISOString(),
          saveFolder: data.save_folder || item.saveFolder || '',
        });

        updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
      }

      // If stuck at 99% for more than 30s, force-check if file already exists
      if (data.status === 'downloading' && data.pct >= 99) {
        if (!item._stuckAt99) item._stuckAt99 = Date.now();
        const stuckMs = Date.now() - item._stuckAt99;
        if (stuckMs > 30000) {
          // Likely finished but poll missed it — force re-check
          const r2 = await fetch(`/api/progress/${item.jobId}`);
          const d2 = await r2.json();
          if (d2.status === 'done' || stuckMs > 60000) {
            // Force complete
            clearInterval(pollers[item.id]);
            delete pollers[item.id];
            item.status = 'done';
            updateItemUI(item.id, { status: 'done', pct: 100 });
            persistQueue();
            window.addToLibrary && window.addToLibrary({
              id: item.id, title: item.title, thumbnail: item.thumbnail,
              platform: item.platform, format: item.format, quality: item.quality,
              date: new Date().toISOString(), saveFolder: item.saveFolder || '',
            });
            updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
          }
        }
      } else {
        item._stuckAt99 = null;
      }

      if (data.status === 'error') {
        clearInterval(pollers[item.id]);
        delete pollers[item.id];
        handleError(item, data.msg, data.platform || item.platform, data.error_code);
      }

    } catch { /* ignore poll errors */ }
  }, 600);
}

// ─── Handle errors — auto-remove + friendly toast ─────────
function handleError(item, msg, platformId, errorCode) {
  item.status = 'error';
  persistQueue();
  updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);

  const platformName = platformNames[platformId] || 'this platform';
  showToast(msg || `Couldn't download from ${platformName}.`, 'error', 5000);

  // Check if file actually downloaded despite error (common with segment cuts)
  fetch(`/api/progress/${item.jobId}`).then(r => r.json()).then(data => {
    if (data.save_folder) {
      // File exists — add to library even if there was an error
      window.addToLibrary && window.addToLibrary({
        id: item.id, title: item.title, thumbnail: item.thumbnail,
        platform: item.platform, format: item.format, quality: item.quality,
        date: new Date().toISOString(), saveFolder: data.save_folder,
      });
    }
  }).catch(() => {});

  setTimeout(() => removeQueueItem(item.id), 3000);
}

// ─── Update UI ─────────────────────────────────────────────
function updateItemUI(id, data) {
  const pctEl    = document.getElementById(`pct-${id}`);
  const barEl    = document.getElementById(`progress-${id}`);
  const speedEl  = document.getElementById(`speed-${id}`);
  const statusEl = document.getElementById(`status-${id}`);

  const pct = data.pct || 0;
  if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
  if (barEl) barEl.style.width = `${pct}%`;

  if (data.status === 'downloading') {
    if (statusEl) { statusEl.className = 'status-pill downloading'; statusEl.textContent = 'Downloading'; }
    if (speedEl && data.msg) {
      const m = data.msg.match(/·\s*([\d.]+\w+\/s)/);
      speedEl.textContent = m ? m[1] : '';
    }
  } else if (data.status === 'done') {
    if (statusEl) { statusEl.className = 'status-pill done'; statusEl.textContent = 'Done'; }
    if (pctEl) pctEl.textContent = '100%';
    if (barEl) barEl.style.width = '100%';
    if (speedEl) speedEl.textContent = '';
  }
}

// ─── Remove item ────────────────────────────────────────────
window.removeQueueItem = function(id) {
  if (pollers[id]) { clearInterval(pollers[id]); delete pollers[id]; }
  const el = document.getElementById(`queue-item-${id}`);
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    setTimeout(() => el.remove(), 200);
  }
  const idx = queue.findIndex(i => i.id === id);
  if (idx !== -1) queue.splice(idx, 1);

  setTimeout(() => {
    if (queue.length === 0) queueEmpty.style.display = 'block';
    updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
    persistQueue();
  }, 220);
};

// ─── Clear completed ───────────────────────────────────────
document.getElementById('clear-completed-btn').addEventListener('click', () => {
  queue.filter(i => i.status === 'done' || i.status === 'error')
       .forEach(i => window.removeQueueItem(i.id));
});

// ─── Persist queue to server ───────────────────────────────
async function persistQueue() {
  try {
    await fetch('/api/queue/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: queue }),
    });
  } catch { /* ignore */ }
}

// ─── Resume pending downloads on load ─────────────────────
async function resumePending() {
  try {
    const res  = await fetch('/api/queue/resume', { method: 'POST' });
    const data = await res.json();

    if (data.items && data.items.length > 0) {
      const pending = data.items.filter(i =>
        i.status === 'pending' || i.status === 'downloading'
      );

      pending.forEach(item => {
        if (queue.find(q => q.id === item.id)) return;

        item.status = 'waiting';
        queue.push(item);
        renderQueueItem(item);

        // Reconnect to existing job OR poll new one — same logic either way
        if (item.job_id) {
          item.jobId = item.job_id;
          pollProgress(item);
        }
      });

      if (pending.length > 0) {
        updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
        const word = pending.length === 1 ? '1 download' : `${pending.length} downloads`;
        showToast(`Resuming ${word} from last session`, 'info');
      }
    }
  } catch { /* ignore */ }
}

// ─── Toast (also used by other modules via window.showToast) ─
function showToast(msg, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  const colors = {
    success: 'rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.3)',
    error:   'rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3)',
    info:    'background:var(--card-bg); color:var(--text-primary); border:1px solid var(--border)',
  };
  toast.style.cssText = `
    position:fixed; bottom:24px; right:24px; padding:12px 18px;
    border-radius:10px; font-size:0.85rem; font-weight:500; z-index:9999;
    max-width:360px; line-height:1.4;
    backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    box-shadow:0 8px 24px rgba(0,0,0,0.2);
    animation:slideUp 0.25s ease forwards;
    background:${colors[type] || colors.info};
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

window.showToast = showToast;

// ─── Helpers ──────────────────────────────────────────────
function formatLabel(format) {
  return { 'video+audio': 'MP4', 'video': 'Video', 'audio': 'MP3' }[format] || format;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Sync from server periodically ───────────────────────
async function syncFromServer() {
  try {
    const res  = await fetch('/api/queue/state');
    const data = await res.json();
    if (!data.items) return;

    data.items.forEach(item => {
      const existing = queue.find(q => q.id === item.id);

      if (existing) {
        // Update title/thumbnail if server fetched real info
        if (item.title && item.title !== existing.title && !item.title.startsWith('http')) {
          existing.title = item.title;
          const titleEl = document.querySelector(`#queue-item-${item.id} .queue-title`);
          if (titleEl) titleEl.textContent = item.title;
        }
        if (item.thumbnail && item.thumbnail !== existing.thumbnail) {
          existing.thumbnail = item.thumbnail;
          const thumbEl = document.getElementById(`thumb-${item.id}`);
          if (thumbEl) {
            thumbEl.src = `/api/thumbnail?url=${encodeURIComponent(item.thumbnail)}`;
            thumbEl.style.display = 'block';
          }
        }
        return;
      }

      // New item from extension — add to queue
      if (item.status !== 'downloading' && item.status !== 'pending') return;

      item.status = 'waiting';
      queue.push(item);
      renderQueueItem(item);

      if (item.active_job_id) {
        item.jobId = item.active_job_id;
        pollProgress(item);
      }
    });

    if (queue.length > 0) {
      updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
      queueEmpty.style.display = 'none';
    }
  } catch { /* ignore */ }
}

// ─── Init ─────────────────────────────────────────────────
resumePending();
// Sync extension downloads every 3 seconds
setInterval(syncFromServer, 3000);