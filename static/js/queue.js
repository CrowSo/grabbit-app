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

// ─── Add already-completed item (e.g. thumbnail) ───────────
// Renders it directly as "done" without going through /api/download or polling.
window.addCompletedItem = function(item) {
  item.status = 'done';
  queue.push(item);
  renderQueueItem(item);
  updateItemUI(item.id, { status: 'done', pct: 100 });
  updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
  persistQueue();
  window.addToLibrary && window.addToLibrary(item);
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
        <span>${item.format === 'image' ? (item.quality || 'MaxRes') : item.quality === 'best' ? 'Best quality' : item.quality + 'p'}</span>
        ${item.startTime ? `<span>✂ ${item.startTime}–${item.endTime || 'end'}</span>` : ''}
        <span class="status-pill waiting" id="status-${item.id}">Waiting</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" id="progress-${item.id}" style="width:0%"></div>
      </div>
      <div id="error-msg-${item.id}" style="display:none;font-size:0.72rem;color:var(--red);margin-top:4px;"></div>
    </div>
    <div class="queue-stats">
      <div class="queue-pct" id="pct-${item.id}">0%</div>
      <div class="queue-speed" id="speed-${item.id}"></div>
    </div>
    <div class="queue-actions" id="actions-${item.id}">
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
        url:              item.url,
        item_id:          item.id,
        quality:          item.quality,
        audio_only:       item.format === 'audio',
        no_audio:         item.format === 'video',
        format:           item.format  || 'video+audio',
        transcript_lang:  item.transcript_lang || '',
        start_time:       item.startTime  || '',
        end_time:         item.endTime    || '',
        save_folder:      item.saveFolder || '',
        is_batch:         item.is_batch         || false,
        batch_session_id: item.batch_session_id || '',
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

        // Prefer the title/thumb captured directly from yt-dlp's output
        // (data.title / data.thumbnail come from the just-finished download)
        if (data.title && !isPlaceholderTitle(data.title)) {
          item.title = data.title;
        }
        if (data.thumbnail) item.thumbnail = data.thumbnail;

        // Also fall back to server state in case data didn't include them
        try {
          const stateRes  = await fetch('/api/queue/state');
          const stateData = await stateRes.json();
          const serverItem = (stateData.items || []).find(i => i.id === item.id);
          if (serverItem) {
            if (serverItem.title && !isPlaceholderTitle(serverItem.title)) {
              item.title = serverItem.title;
            }
            if (serverItem.thumbnail) item.thumbnail = serverItem.thumbnail;
            if (serverItem.platform)  item.platform  = serverItem.platform;
          }
        } catch { /* ignore */ }

        // Update the UI with the real title
        const titleEl = document.querySelector(`#queue-item-${item.id} .queue-title`);
        if (titleEl) titleEl.textContent = item.title;
        const thumbEl = document.getElementById(`thumb-${item.id}`);
        if (thumbEl && item.thumbnail) {
          thumbEl.src = `/api/thumbnail?url=${encodeURIComponent(item.thumbnail)}`;
          thumbEl.style.display = 'block';
        }

        persistQueue();

        window.addToLibrary && window.addToLibrary({
          id:         item.id,
          title:      item.title,
          thumbnail:  item.thumbnail,
          platform:   item.platform,
          format:     item.format,
          quality:    item.quality,
          date:       new Date().toISOString(),
          saveFolder: data.save_folder || item.saveFolder || '',
          duration:   data.duration,
          file_size:  data.file_size,
        });

        updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
      }

      // Removed stuckAt99 hack because the backend now tracks actual file saving progress

      if (data.status === 'error') {
        clearInterval(pollers[item.id]);
        delete pollers[item.id];
        handleError(item, data.msg, data.platform || item.platform, data.error_code);
      }

      // Fallback: if progress entry is gone ("unknown") check queue.json directly
      if (data.status === 'unknown') {
        try {
          const stateRes  = await fetch('/api/queue/state');
          const stateData = await stateRes.json();
          const serverItem = (stateData.items || []).find(i => i.id === item.id);
          if (serverItem?.status === 'done') {
            clearInterval(pollers[item.id]);
            delete pollers[item.id];
            item.status = 'done';
            updateItemUI(item.id, { status: 'done', pct: 100 });
            if (serverItem.title && !isPlaceholderTitle(serverItem.title)) item.title = serverItem.title;
            if (serverItem.thumbnail) item.thumbnail = serverItem.thumbnail;
            const titleEl = document.querySelector(`#queue-item-${item.id} .queue-title`);
            if (titleEl) titleEl.textContent = item.title;
            persistQueue();
            window.addToLibrary && window.addToLibrary({
              id: item.id, title: item.title, thumbnail: item.thumbnail,
              platform: item.platform, format: item.format, quality: item.quality,
              date: new Date().toISOString(), saveFolder: serverItem.save_folder || item.saveFolder || '',
              duration: serverItem.duration, file_size: serverItem.file_size
            });
            updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
          }
        } catch { /* ignore */ }
      }

    } catch { /* ignore poll errors */ }
  }, 600);
}

// ─── Handle errors — keep in queue, show error + retry btn ─
function handleError(item, msg, platformId, errorCode) {
  item.status   = 'error';
  item.errorMsg = msg;
  persistQueue();
  updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);

  // Update status pill to ERROR (was getting stuck on DOWNLOADING)
  const statusEl = document.getElementById(`status-${item.id}`);
  if (statusEl) {
    statusEl.className   = 'status-pill error';
    statusEl.textContent = typeof t === 'function' ? t('status_error') : 'Error';
  }
  const speedEl = document.getElementById(`speed-${item.id}`);
  if (speedEl) speedEl.textContent = '';

  // Translate error message using i18n key (msg is a key like 'err_rate_limited')
  const displayMsg = (typeof t === 'function' && msg && msg.startsWith && msg.startsWith('err_'))
    ? t(msg)
    : msg || (typeof t === 'function' ? t('err_unknown') : 'Unknown error');

  // Show error message inside the queue item
  const errEl = document.getElementById(`error-msg-${item.id}`);
  if (errEl) {
    errEl.textContent = '⚠ ' + displayMsg;
    errEl.style.display = 'block';
  }

  // Add retry button to actions area
  const actionsEl = document.getElementById(`actions-${item.id}`);
  if (actionsEl && !actionsEl.querySelector('.retry-btn')) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-ghost btn-icon retry-btn';
    retryBtn.title = typeof t === 'function' ? t('queue_retry') : 'Retry';
    retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-.07-8.5"/>
    </svg>`;
    retryBtn.onclick = () => retryItem(item);
    actionsEl.insertBefore(retryBtn, actionsEl.firstChild);
  }

  // Update clear-errors button visibility
  updateClearErrorsBtn();
}

// ─── Retry a failed item ───────────────────────────────────
function retryItem(item) {
  item.status   = 'waiting';
  item.errorMsg = '';
  item.jobId    = null;

  const errEl = document.getElementById(`error-msg-${item.id}`);
  if (errEl) errEl.style.display = 'none';

  const retryBtn = document.querySelector(`#actions-${item.id} .retry-btn`);
  if (retryBtn) retryBtn.remove();

  const statusEl = document.getElementById(`status-${item.id}`);
  if (statusEl) { statusEl.className = 'status-pill waiting'; statusEl.textContent = 'Waiting'; }

  const pctEl = document.getElementById(`pct-${item.id}`);
  if (pctEl) pctEl.textContent = '0%';

  const barEl = document.getElementById(`progress-${item.id}`);
  if (barEl) barEl.style.width = '0%';

  persistQueue();
  updateClearErrorsBtn();
  startDownload(item);
}

// ─── Clear all errored items ───────────────────────────────
window.clearErrorItems = function() {
  const errors = queue.filter(i => i.status === 'error');
  errors.forEach(item => removeQueueItem(item.id));
  updateClearErrorsBtn();
};

function updateClearErrorsBtn() {
  const btn = document.getElementById('clear-errors-btn');
  if (!btn) return;
  const count = queue.filter(i => i.status === 'error').length;
  btn.style.display = count > 0 ? 'inline-flex' : 'none';
  btn.textContent = typeof t === 'function'
    ? `${t('queue_clear_errors')} (${count})`
    : `Clear errors (${count})`;
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

  if (data.status === 'downloading' || data.status === 'starting') {
    if (statusEl) { statusEl.className = 'status-pill downloading'; statusEl.textContent = typeof t === 'function' ? t('status_downloading') : 'Downloading'; }
    
    // Determine exact phase and apply specific colors to the progress bar
    const p = data.phase || 'video';
    if (barEl) {
      if (p === 'video') barEl.style.background = ''; // inherit CSS var(--secondary)
      else if (p === 'audio') barEl.style.background = '#8b5cf6'; // Purple for Audio
      else if (p === 'merging') barEl.style.background = '#f97316'; // Orange for Merging
      else if (p === 'saving') barEl.style.background = '#06b6d4'; // Cyan for Saving
    }
    
    if (speedEl && data.msg) {
      if (p === 'merging') {
        speedEl.innerHTML = `<span style="display:flex;align-items:center;gap:4px;color:#f97316;"><svg style="animation:spin 1s linear infinite;width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.07-8.5"/></svg> ${data.msg}</span>`;
      } else if (p === 'saving') {
        speedEl.innerHTML = `<span style="display:flex;align-items:center;gap:4px;color:#06b6d4;"><svg style="animation:spin 1s linear infinite;width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.07-8.5"/></svg> Saving to disk... ${data.msg}</span>`;
      } else {
        const m = data.msg.match(/·\s*([\d.]+\w+\/s)/);
        let speedText = m ? m[1] : '';
        if (p === 'audio') {
          speedEl.innerHTML = `<span style="display:flex;align-items:center;gap:4px;color:#8b5cf6;"><svg style="animation:spin 1s linear infinite;width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.07-8.5"/></svg> Audio · ${speedText}</span>`;
        } else {
          speedEl.textContent = speedText;
        }
      }
    }
  } else if (data.status === 'done') {
    if (statusEl) { statusEl.className = 'status-pill done'; statusEl.textContent = typeof t === 'function' ? t('status_done') : 'Done'; }
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

// ─── Load full queue history (done + error + pending) on page load ─
async function loadQueueOnStart() {
  try {
    // First: load full state (done, error, and in-progress items)
    const stateRes  = await fetch('/api/queue/state');
    const stateData = await stateRes.json();
    const items = stateData.items || [];

    items.forEach(item => {
      if (queue.find(q => q.id === item.id)) return;

      // Pending/downloading items will be re-resumed below
      // Done and error items are rendered as-is with their final state
      const normalizedStatus = (item.status === 'pending' || item.status === 'downloading')
        ? 'waiting'
        : item.status; // 'done' or 'error' stays

      queue.push({ ...item, status: normalizedStatus });
      renderQueueItem(item);

      // Render final state for done/error items
      if (item.status === 'done') {
        updateItemUI(item.id, { status: 'done', pct: 100 });
      } else if (item.status === 'error') {
        handleErrorRestore(item);
      }
    });

    // Second: resume in-progress items
    const resumeRes = await fetch('/api/queue/resume', { method: 'POST' });
    const resumeData = await resumeRes.json();
    const pending = (resumeData.items || []).filter(i =>
      i.status === 'pending' || i.status === 'downloading'
    );

    pending.forEach(item => {
      const existing = queue.find(q => q.id === item.id);
      if (!existing) return;
      if (item.job_id || item.active_job_id) {
        existing.jobId = item.job_id || item.active_job_id;
        pollProgress(existing);
      }
    });

    if (pending.length > 0) {
      const word = pending.length === 1 ? '1 download' : `${pending.length} downloads`;
      showToast(`Resuming ${word} from last session`, 'info');
    }

    if (queue.length > 0) {
      queueEmpty.style.display = 'none';
      updateQueueBadge(queue.filter(i => i.status !== 'done' && i.status !== 'error').length);
      updateClearErrorsBtn();
    }
  } catch { /* ignore */ }
}

// Restore UI state for an item that ended in error (called on page load)
function handleErrorRestore(item) {
  const statusEl = document.getElementById(`status-${item.id}`);
  if (statusEl) {
    statusEl.className   = 'status-pill error';
    statusEl.textContent = typeof t === 'function' ? t('status_error') : 'Error';
  }
  const speedEl = document.getElementById(`speed-${item.id}`);
  if (speedEl) speedEl.textContent = '';
  const pctEl = document.getElementById(`pct-${item.id}`);
  if (pctEl) pctEl.textContent = '0%';

  const msg = item.error_msg || 'err_unknown';
  const displayMsg = (typeof t === 'function' && msg && msg.startsWith && msg.startsWith('err_'))
    ? t(msg)
    : msg;
  const errEl = document.getElementById(`error-msg-${item.id}`);
  if (errEl) {
    errEl.textContent = '⚠ ' + displayMsg;
    errEl.style.display = 'block';
  }

  // Add retry button
  const actionsEl = document.getElementById(`actions-${item.id}`);
  if (actionsEl && !actionsEl.querySelector('.retry-btn')) {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn btn-ghost btn-icon retry-btn';
    retryBtn.title = typeof t === 'function' ? t('queue_retry') : 'Retry';
    retryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-.07-8.5"/>
    </svg>`;
    retryBtn.onclick = () => retryItem(item);
    actionsEl.insertBefore(retryBtn, actionsEl.firstChild);
  }
}

// ─── Toast (also used by other modules via window.showToast) ─
function showToast(msg, type = 'info', duration = 3500) {
  const toast = document.createElement('div');
  const colors = {
    success: 'rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.3)',
    error:   'rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3)',
    info:    'background:var(--button-elevated); color:var(--secondary); border:1px solid var(--button-stroke)',
  };
  toast.style.cssText = `
    position:fixed; top:24px; left:50%; transform:translateX(-50%); padding:12px 18px;
    border-radius:10px; font-size:0.85rem; font-weight:500; z-index:9999;
    max-width:360px; line-height:1.4; text-align:center;
    backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    box-shadow:0 8px 24px rgba(0,0,0,0.2);
    animation:toastSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    background:${colors[type] || colors.info};
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translate(-50%, -20px)';
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

window.showToast = showToast;

// ─── Helpers ──────────────────────────────────────────────
function formatLabel(format) {
  return { 'video+audio': 'MP4', 'video': 'Video', 'audio': 'MP3', 'text': 'Transcript', 'image': 'Thumbnail' }[format] || format;
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Detect when a title is still the URL placeholder (assigned before fetchInfo)
function isPlaceholderTitle(t) {
  if (!t) return true;
  const s = t.trim().toLowerCase();
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  // Detect bare hostnames/paths like "www.youtube.com/..." or "youtu.be/..."
  if (/^(www\.)?[a-z0-9-]+\.[a-z]{2,}(\.[a-z]{2,})?(\/|$)/.test(s)) return true;
  return false;
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
loadQueueOnStart();
// Sync extension downloads every 3 seconds
setInterval(syncFromServer, 3000);

