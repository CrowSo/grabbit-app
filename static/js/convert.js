/* ============================================================
   GRABBIT — convert.js
   Local File Converter (Pro) + YouTube Thumbnail Downloader
   ============================================================ */

// ── FILE TYPE CONFIG ────────────────────────────────────────
const _CV_VIDEO = new Set(['mp4','mkv','mov','webm','avi','wmv','flv','m4v','ts','mts','3gp','m2ts']);
const _CV_AUDIO = new Set(['mp3','flac','wav','aac','m4a','ogg','opus','wma','aiff','ape','alac']);
const _CV_IMAGE = new Set(['jpg','jpeg','png','webp','heic','heif','bmp','tiff','tif','gif','avif']);

const _CV_FORMAT_OPTS = {
  video: [
    { id:'mp4',    label:'MP4 (H.264)' },
    { id:'mkv',    label:'MKV (H.264)' },
    { id:'mov',    label:'MOV (H.264)' },
    { id:'webm',   label:'WebM (VP9)'  },
    { id:'avi',    label:'AVI'          },
    { id:'mp3',    label:'MP3 — extract audio' },
    { id:'prores', label:'ProRes HQ ★' },
    { id:'dnxhd',  label:'DNxHR HQ ★' },
  ],
  audio: [
    { id:'mp3',  label:'MP3 (320k)' },
    { id:'flac', label:'FLAC'       },
    { id:'wav',  label:'WAV'        },
    { id:'aac',  label:'AAC / M4A'  },
    { id:'ogg',  label:'OGG'        },
    { id:'opus', label:'Opus'       },
  ],
  image: [
    { id:'jpg',  label:'JPEG'    },
    { id:'png',  label:'PNG'     },
    { id:'webp', label:'WebP'    },
    { id:'avif', label:'AVIF'    },
    { id:'jxl',  label:'JPEG XL' },
  ],
};

const _CV_DEFAULT_FORMAT = { video:'mp4', audio:'mp3', image:'jpg' };
const _CV_TYPE_ICON = {
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/><line x1="17" y1="17" x2="22" y2="17"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  unknown:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`,
};

function _cvDetectType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (_CV_VIDEO.has(ext)) return 'video';
  if (_CV_AUDIO.has(ext)) return 'audio';
  if (_CV_IMAGE.has(ext)) return 'image';
  return 'unknown';
}

// ── STATE ───────────────────────────────────────────────────
let _cvFiles     = [];   // [{id, path, name, type}]
let _cvOutFolder = '';
let _cvNextId    = 1;
let _cvPollers   = {};   // job_id -> interval id

// ── HELPERS ─────────────────────────────────────────────────
function _cvIsProUser() {
  return !!(localStorage.getItem('grabbit-license') || '').trim();
}

function _cvEl(id) { return document.getElementById(id); }

function _cvToast(msg, type) {
  if (window.showToast) showToast(msg, type || 'info');
}

// ── TAB SWITCHING ────────────────────────────────────────────
window.setConvertTab = function(tab) {
  _cvEl('ct-converter').style.display    = tab === 'converter'  ? '' : 'none';
  _cvEl('ct-thumbnails').style.display   = tab === 'thumbnails' ? '' : 'none';
  _cvEl('ct-tab-converter').classList.toggle('active',  tab === 'converter');
  _cvEl('ct-tab-thumbnails').classList.toggle('active', tab === 'thumbnails');
};

// ── PRO GATE DISPLAY ─────────────────────────────────────────
function _cvUpdateProGate() {
  const gate     = _cvEl('ct-pro-gate');
  const dropzone = _cvEl('ct-dropzone');
  const browseBtn = _cvEl('ct-browse-btn');
  if (!gate) return;
  if (_cvIsProUser()) {
    gate.style.display    = 'none';
    if (dropzone)  dropzone.style.display  = '';
    if (browseBtn) browseBtn.style.display = '';
  } else {
    gate.style.display    = '';
    if (dropzone)  dropzone.style.display  = 'none';
    if (browseBtn) browseBtn.style.display = 'none';
  }
}

// ── ADD FILES TO STAGING ──────────────────────────────────────
function _cvAddFiles(pathsAndNames) {
  let added = 0;
  for (const { path, name } of pathsAndNames) {
    const already = _cvFiles.find(f => f.path === path);
    if (already) continue;
    const type = _cvDetectType(name);
    _cvFiles.push({ id: _cvNextId++, path, name, type });
    added++;
  }
  if (added) _cvRenderStaging();
}

function _cvRemoveFile(id) {
  _cvFiles = _cvFiles.filter(f => f.id !== id);
  _cvRenderStaging();
}

// ── FORMAT DROPDOWN ──────────────────────────────────────────
function _cvFormatSelect(fileId, type) {
  const opts = _CV_FORMAT_OPTS[type] || [];
  const def  = _CV_DEFAULT_FORMAT[type] || (opts[0] && opts[0].id) || 'mp4';
  const sel  = document.createElement('select');
  sel.className        = 'input ct-format-select';
  sel.dataset.fileId   = fileId;
  sel.style.cssText    = 'font-size:0.75rem;padding:4px 8px;height:30px;flex-shrink:0;width:auto;min-width:140px;';
  for (const o of opts) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    if (o.id === def) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

// ── RENDER STAGING LIST ──────────────────────────────────────
function _cvRenderStaging() {
  const list      = _cvEl('ct-staging-list');
  const stageArea = _cvEl('ct-stage-area');
  if (!list) return;
  if (_cvFiles.length === 0) {
    list.innerHTML = '';
    if (stageArea) stageArea.style.display = 'none';
    return;
  }
  if (stageArea) stageArea.style.display = '';

  const html = _cvFiles.map(f => `
    <div class="ct-staging-item" id="cvsf-${f.id}">
      <span class="ct-file-icon" style="color:var(--gray);">${_CV_TYPE_ICON[f.type] || _CV_TYPE_ICON.unknown}</span>
      <span class="ct-file-name" title="${f.path}">${f.name}</span>
      <span class="ct-file-type-badge">${f.type}</span>
      <span class="ct-format-slot" data-fid="${f.id}"></span>
      <button class="btn-icon ct-remove-btn" data-fid="${f.id}" title="Remove">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `).join('');
  list.innerHTML = html;

  // Inject format dropdowns
  for (const f of _cvFiles) {
    const slot = list.querySelector(`.ct-format-slot[data-fid="${f.id}"]`);
    if (slot) slot.appendChild(_cvFormatSelect(f.id, f.type));
  }

  // Remove buttons
  list.querySelectorAll('.ct-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => _cvRemoveFile(Number(btn.dataset.fid)));
  });
}

// ── OUTPUT FOLDER ────────────────────────────────────────────
_cvEl('ct-browse-folder-btn')?.addEventListener('click', async () => {
  try {
    const res  = await fetch('/api/browse_folder', { method: 'POST' });
    const data = await res.json();
    if (data.path) {
      _cvOutFolder = data.path;
      _cvEl('ct-out-folder').value = data.path;
    }
  } catch { _cvToast('Could not open folder picker', 'error'); }
});

_cvEl('ct-clear-folder-btn')?.addEventListener('click', () => {
  _cvOutFolder = '';
  const el = _cvEl('ct-out-folder');
  if (el) el.value = '';
});

// ── BROWSE FILES BUTTON ───────────────────────────────────────
_cvEl('ct-browse-btn')?.addEventListener('click', async () => {
  if (!_cvIsProUser()) { navigateTo('license'); return; }
  try {
    const res  = await fetch('/api/browse_files', { method: 'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    const data = await res.json();
    if (data.error) { _cvToast(data.error, 'error'); return; }
    if (data.files && data.files.length > 0) {
      _cvAddFiles(data.files.map(p => ({ path: p, name: p.split(/[\\/]/).pop() })));
    }
  } catch { _cvToast('Could not open file picker', 'error'); }
});

// ── DRAG & DROP ON DROPZONE ───────────────────────────────────
const _cvDropzone = _cvEl('ct-dropzone');
_cvDropzone?.addEventListener('dragover', e => {
  e.preventDefault();
  _cvDropzone.classList.add('drag-over');
});
_cvDropzone?.addEventListener('dragleave', () => _cvDropzone.classList.remove('drag-over'));
_cvDropzone?.addEventListener('drop', async e => {
  e.preventDefault();
  _cvDropzone.classList.remove('drag-over');
  if (!_cvIsProUser()) { navigateTo('license'); return; }
  // In a desktop browser (Electron / localhost), file.path may not be available.
  // We use the file name + open the native picker as fallback.
  const files = [...e.dataTransfer.files];
  if (files.length > 0) {
    // Try to get path from dataTransfer items (works in some Electron builds)
    const items = [...e.dataTransfer.items];
    const results = [];
    for (let i = 0; i < files.length; i++) {
      const f    = files[i];
      const path = f.path || (items[i] && items[i].getAsFile && items[i].getAsFile() && items[i].getAsFile().path) || '';
      if (path) {
        results.push({ path, name: f.name });
      }
    }
    if (results.length > 0) {
      _cvAddFiles(results);
    } else {
      // Path not available in this browser — prompt user to use Browse button
      _cvToast('Use the Browse button to select files from disk', 'info');
    }
  }
});

// ── CLEAR ALL ─────────────────────────────────────────────────
_cvEl('ct-clear-all-btn')?.addEventListener('click', () => {
  _cvFiles = [];
  _cvRenderStaging();
  _cvEl('ct-progress-list').innerHTML = '';
});

// ── CONVERT ALL ───────────────────────────────────────────────
_cvEl('ct-convert-btn')?.addEventListener('click', async () => {
  if (!_cvFiles.length) return;
  if (!_cvIsProUser()) { navigateTo('license'); return; }

  const list = _cvEl('ct-staging-list');
  const payload = _cvFiles.map(f => {
    const sel = list?.querySelector(`.ct-format-select[data-file-id="${f.id}"], select[data-file-id="${f.id}"]`)
      || list?.querySelector(`.ct-format-slot[data-fid="${f.id}"] select`);
    return {
      path:          f.path,
      format:        sel ? sel.value : _CV_DEFAULT_FORMAT[f.type] || 'mp4',
      output_folder: _cvOutFolder || '',
    };
  });

  const btn = _cvEl('ct-convert-btn');
  btn.disabled = true;
  btn.textContent = 'Starting...';

  try {
    const res  = await fetch('/api/convert/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ files: payload }),
    });
    const data = await res.json();

    if (res.status === 403 || data.error === 'pro_required') {
      _cvToast('Pro license required', 'error');
      btn.disabled = false; btn.textContent = 'Convert all';
      navigateTo('license');
      return;
    }
    if (data.error) {
      _cvToast(data.error, 'error');
      btn.disabled = false; btn.textContent = 'Convert all';
      return;
    }

    // Render progress items
    const progressList = _cvEl('ct-progress-list');
    progressList.innerHTML = '';
    for (const job of (data.jobs || [])) {
      _cvRenderProgressItem(job);
      if (job.job_id) _cvStartPoll(job.job_id);
    }

    // Clear staging
    _cvFiles = [];
    _cvRenderStaging();

  } catch (e) {
    _cvToast('Conversion failed to start', 'error');
  }

  btn.disabled = false; btn.textContent = 'Convert all';
});

// ── PROGRESS RENDERING ────────────────────────────────────────
function _cvRenderProgressItem(job) {
  const list = _cvEl('ct-progress-list');
  if (!list) return;
  const el  = document.createElement('div');
  el.className = 'ct-progress-item';
  el.id        = `cvp-${job.job_id || 'err'}`;
  if (!job.job_id) {
    el.innerHTML = `
      <div class="ct-prog-name">${_CV_TYPE_ICON.unknown} <span>${job.filename}</span></div>
      <div class="ct-prog-msg" style="color:var(--red);">${job.error || 'Error'}</div>`;
  } else {
    el.innerHTML = `
      <div class="ct-prog-name">${_CV_TYPE_ICON[_cvDetectType(job.filename)] || _CV_TYPE_ICON.unknown} <span>${job.filename}</span></div>
      <div class="ct-prog-bar-wrap"><div class="ct-prog-bar" id="cvbar-${job.job_id}"></div></div>
      <div class="ct-prog-footer">
        <span class="ct-prog-msg" id="cvmsg-${job.job_id}">Queued</span>
        <button class="btn-icon ct-cancel-btn" id="cvcnl-${job.job_id}" title="Cancel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }
  list.appendChild(el);

  _cvEl(`cvcnl-${job.job_id}`)?.addEventListener('click', async () => {
    await fetch(`/api/convert/cancel/${job.job_id}`, { method:'POST' });
    _cvStopPoll(job.job_id);
    _cvUpdateProgress(job.job_id, { status:'cancelled', pct:0, msg:'Cancelled' });
  });
}

function _cvUpdateProgress(jobId, data) {
  const bar  = _cvEl(`cvbar-${jobId}`);
  const msg  = _cvEl(`cvmsg-${jobId}`);
  const item = _cvEl(`cvp-${jobId}`);
  const cnl  = _cvEl(`cvcnl-${jobId}`);
  if (bar) bar.style.width = `${data.pct || 0}%`;
  if (msg) {
    if (data.status === 'done') {
      const fname = (data.output || '').split(/[\\/]/).pop() || 'file';
      msg.innerHTML = `<span style="color:var(--green);">Done — ${fname}</span>`;
    } else if (data.status === 'error') {
      msg.innerHTML = `<span style="color:var(--red);">${data.msg || 'Error'}</span>`;
    } else if (data.status === 'cancelled') {
      msg.innerHTML = `<span style="color:var(--gray);">Cancelled</span>`;
    } else {
      msg.textContent = data.msg || `${data.pct || 0}%`;
    }
  }
  if (bar && data.status === 'done') bar.style.background = 'var(--green)';
  if (bar && data.status === 'error') bar.style.background = 'var(--red)';
  if (cnl && ['done','error','cancelled'].includes(data.status)) cnl.style.display = 'none';
}

function _cvStartPoll(jobId) {
  _cvPollers[jobId] = setInterval(async () => {
    try {
      const res  = await fetch(`/api/convert/progress/${jobId}`);
      const data = await res.json();
      _cvUpdateProgress(jobId, data);
      if (['done','error','cancelled'].includes(data.status)) _cvStopPoll(jobId);
    } catch { _cvStopPoll(jobId); }
  }, 600);
}

function _cvStopPoll(jobId) {
  clearInterval(_cvPollers[jobId]);
  delete _cvPollers[jobId];
}

// ── THUMBNAIL DOWNLOADER ──────────────────────────────────────
let _thumbData    = null;
let _thumbFmt     = 'jpg';
let _thumbSaveDir = '';

// Format chip selection
document.querySelectorAll('[data-thumb-fmt]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-thumb-fmt]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    _thumbFmt = btn.dataset.thumbFmt;
  });
});

// Fetch button
_cvEl('ct-thumb-fetch-btn')?.addEventListener('click', _cvThumbFetch);
_cvEl('ct-thumb-url')?.addEventListener('keydown', e => { if (e.key === 'Enter') _cvThumbFetch(); });

async function _cvThumbFetch() {
  const urlEl = _cvEl('ct-thumb-url');
  const url   = (urlEl?.value || '').trim();
  if (!url) { _cvToast('Paste a YouTube URL', 'info'); return; }

  const btn   = _cvEl('ct-thumb-fetch-btn');
  const orig  = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span style="opacity:.6;">Fetching...</span>';

  try {
    const res  = await fetch('/api/thumbget/fetch', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (data.error) { _cvToast(data.error, 'error'); return; }
    _thumbData = data;
    _cvRenderThumbResult(data);
  } catch (e) {
    _cvToast('Could not fetch thumbnail info', 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = orig;
  }
}

function _cvRenderThumbResult(data) {
  const result = _cvEl('ct-thumb-result');
  if (!result) return;

  const title   = _cvEl('ct-thumb-title');
  const preview = _cvEl('ct-thumb-preview-img');
  const sizes   = _cvEl('ct-thumb-sizes');

  if (title)   title.textContent = data.title || 'Untitled';
  if (preview) { preview.src = data.preview; preview.style.display = ''; }

  if (sizes) {
    sizes.innerHTML = '';
    for (const s of (data.sizes || [])) {
      const row = document.createElement('div');
      row.className = 'ct-thumb-size-row';
      row.innerHTML = `
        <span class="ct-thumb-size-label">${s.label}</span>
        <button class="btn btn-ghost btn-sm ct-thumb-dl-btn" data-url="${s.url}" data-label="${s.label}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Save
        </button>`;
      sizes.appendChild(row);
      row.querySelector('.ct-thumb-dl-btn').addEventListener('click', async function() {
        const url   = this.dataset.url;
        const label = this.dataset.label;
        this.disabled = true; this.textContent = '...';
        await _cvThumbSave(url, data.title || 'thumbnail');
        this.disabled = false;
        this.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Save`;
      });
    }
  }

  result.style.display = '';
}

async function _cvThumbSave(thumbUrl, title) {
  try {
    const res  = await fetch('/api/thumbget/save', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url:thumbUrl, filename:title, format:_thumbFmt }),
    });
    const data = await res.json();
    if (data.error) { _cvToast(data.error, 'error'); return; }
    _cvToast(`Saved: ${data.filename}`, 'success');
  } catch {
    _cvToast('Could not save thumbnail', 'error');
  }
}

// ── BULK THUMBNAILS ───────────────────────────────────────────
_cvEl('ct-bulk-thumb-btn')?.addEventListener('click', async () => {
  const textarea = _cvEl('ct-bulk-thumb-input');
  const status   = _cvEl('ct-bulk-thumb-status');
  const log      = _cvEl('ct-bulk-thumb-log');
  const btn      = _cvEl('ct-bulk-thumb-btn');
  if (!textarea) return;

  const urls = textarea.value.split('\n').map(u => u.trim()).filter(u => u.length > 10 && u.includes('youtube'));
  if (!urls.length) { _cvToast('No valid YouTube URLs found', 'info'); return; }

  btn.disabled = true;
  log.innerHTML = '';
  let done = 0;

  for (const url of urls) {
    if (status) status.textContent = `${done + 1} / ${urls.length}`;
    const logLine = document.createElement('div');
    logLine.textContent = `⟳ ${url}`;
    log.appendChild(logLine);
    log.scrollTop = log.scrollHeight;

    try {
      const fetchRes  = await fetch('/api/thumbget/fetch', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url }),
      });
      const fetchData = await fetchRes.json();
      if (fetchData.error) {
        logLine.innerHTML = `<span style="color:var(--red);">✗ ${fetchData.error} — ${url}</span>`;
        done++;
        continue;
      }
      const maxresUrl = fetchData.sizes?.[0]?.url || fetchData.preview;
      const saveRes   = await fetch('/api/thumbget/save', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url:maxresUrl, filename:fetchData.title || 'thumbnail', format:_thumbFmt }),
      });
      const saveData = await saveRes.json();
      if (saveData.error) {
        // Retry with HQ
        const hqUrl   = fetchData.sizes?.[2]?.url || maxresUrl;
        const retry   = await fetch('/api/thumbget/save', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ url:hqUrl, filename:fetchData.title || 'thumbnail', format:_thumbFmt }),
        });
        const retryData = await retry.json();
        if (retryData.ok) {
          logLine.innerHTML = `<span style="color:var(--green);">✓ ${fetchData.title} (HQ)</span>`;
        } else {
          logLine.innerHTML = `<span style="color:var(--red);">✗ ${saveData.error}</span>`;
        }
      } else {
        logLine.innerHTML = `<span style="color:var(--green);">✓ ${fetchData.title}</span>`;
      }
    } catch (e) {
      logLine.innerHTML = `<span style="color:var(--red);">✗ Network error — ${url}</span>`;
    }

    done++;
    log.scrollTop = log.scrollHeight;
    // Small delay to avoid hammering
    await new Promise(r => setTimeout(r, 400));
  }

  if (status) status.textContent = `Done — ${done} files`;
  btn.disabled = false;
  _cvToast(`Downloaded ${done} thumbnails`, 'success');
});

// ── INIT ─────────────────────────────────────────────────────
(function cvInit() {
  _cvUpdateProGate();
  // Re-check pro gate whenever the page is navigated to
  const origNavigateTo = window.navigateTo;
  if (typeof origNavigateTo === 'function') {
    window.navigateTo = function(pageId, ...args) {
      origNavigateTo(pageId, ...args);
      if (pageId === 'convert') _cvUpdateProGate();
    };
  }
  // Start on Converter tab
  setConvertTab('converter');
})();
