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
    { id:'jpg',  label:'JPEG'  },
    { id:'png',  label:'PNG'   },
    { id:'webp', label:'WebP'  },
    { id:'avif', label:'AVIF'  },
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
let _cvFiles       = [];   // [{id, path, name, type, format}]
let _cvOutFolder   = '';
let _cvNextId      = 1;
let _cvPollers     = {};   // job_id -> interval id
let _cvCategoryFmt = { video: 'mp4', audio: 'mp3', image: 'jpg' };

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
    if (_cvFiles.find(f => f.path === path)) continue;
    const type   = _cvDetectType(name);
    const format = _cvCategoryFmt[type] || _CV_DEFAULT_FORMAT[type] || 'mp4';
    _cvFiles.push({ id: _cvNextId++, path, name, type, format });
    added++;
  }
  if (added) _cvRenderStaging();
}

function _cvRemoveFile(id) {
  _cvFiles = _cvFiles.filter(f => f.id !== id);
  _cvRenderStaging();
}

// ── RENDER STAGING LIST (grouped by type) ────────────────────
function _cvTypeLabel(type) {
  return { video: t('filter_video'), audio: t('filter_audio'), image: t('cv_image_label') }[type] || type.toUpperCase();
}

function _cvRenderStaging() {
  const list = _cvEl('ct-staging-list');
  if (!list) return;
  if (_cvFiles.length === 0) {
    list.innerHTML = `<div class="ct-conv-empty-state">${t('cv_empty_staging')}</div>`;
    return;
  }
  list.innerHTML = '';

  const groups = { video: [], audio: [], image: [], unknown: [] };
  for (const f of _cvFiles) (groups[f.type] || groups.unknown).push(f);

  for (const [type, files] of Object.entries(groups)) {
    if (!files.length) continue;
    const opts  = _CV_FORMAT_OPTS[type] || [];
    const label = _cvTypeLabel(type);
    const icon  = _CV_TYPE_ICON[type]  || _CV_TYPE_ICON.unknown;
    const catFmt = _cvCategoryFmt[type] || (opts[0]?.id || '');

    // ── Category header ──
    const header = document.createElement('div');
    header.className = 'ct-cat-header';
    header.innerHTML = `
      <div class="ct-cat-title">${icon}<span>${label}</span><span class="ct-cat-count">${files.length}</span></div>
      ${opts.length ? `
      <div class="ct-cat-bulk">
        <span class="ct-cat-bulk-label">${t('cv_all_to')}</span>
        <select class="input ct-cat-select" data-cat="${type}" style="font-size:0.75rem;padding:2px 8px;height:26px;width:auto;min-width:130px;">
          ${opts.map(o => `<option value="${o.id}" ${catFmt === o.id ? 'selected':''}>${o.label}</option>`).join('')}
        </select>
      </div>` : ''}
    `;
    list.appendChild(header);

    // ── File rows ──
    for (const f of files) {
      const srcExt = (f.name.split('.').pop() || '').toLowerCase();
      const row    = document.createElement('div');
      row.className = 'ct-staging-item';
      row.id        = `cvsf-${f.id}`;
      row.innerHTML = `
        <span class="ct-file-icon">${icon}</span>
        <span class="ct-file-name" title="${f.path}">${f.name}</span>
        <span class="ct-src-ext">${srcExt}</span>
        <span class="ct-arrow">→</span>
        <select class="input ct-format-select" data-fid="${f.id}" style="font-size:0.75rem;padding:2px 8px;height:26px;width:auto;min-width:130px;">
          ${opts.map(o => `<option value="${o.id}" ${f.format === o.id ? 'selected':''}>${o.label}</option>`).join('')}
        </select>
        <button class="btn-icon ct-remove-btn" data-fid="${f.id}" title="${t('cv_remove')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      `;
      list.appendChild(row);
    }
  }

  // Category bulk-select: updates all files of that type
  list.querySelectorAll('.ct-cat-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const cat = sel.dataset.cat;
      _cvCategoryFmt[cat] = sel.value;
      for (const f of _cvFiles) {
        if (f.type === cat) f.format = sel.value;
      }
      // Sync individual selects without full re-render
      list.querySelectorAll('.ct-format-select').forEach(fs => {
        const file = _cvFiles.find(f => f.id === Number(fs.dataset.fid));
        if (file?.type === cat) fs.value = sel.value;
      });
    });
  });

  // Individual file select: overrides only that file
  list.querySelectorAll('.ct-format-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const file = _cvFiles.find(f => f.id === Number(sel.dataset.fid));
      if (file) file.format = sel.value;
    });
  });

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
  } catch { _cvToast(t('cv_err_folder_picker'), 'error'); }
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
  } catch { _cvToast(t('cv_err_file_picker'), 'error'); }
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

  const files = [...e.dataTransfer.files].filter(f => {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    return _CV_VIDEO.has(ext) || _CV_AUDIO.has(ext) || _CV_IMAGE.has(ext);
  });
  if (!files.length) { _cvToast(t('cv_unsupported_fmt'), 'error'); return; }

  // Electron exposes file.path — use it directly
  if (files[0].path) {
    _cvAddFiles(files.map(f => ({ path: f.path, name: f.name })));
    return;
  }

  // Browser context: upload to localhost (local copy, no real network)
  _cvToast(t('cv_loading_files').replace('{n}', files.length), 'info');
  const results = [];
  for (const file of files) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res  = await fetch('/api/converter/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.path) results.push({ path: data.path, name: file.name });
    } catch { /* skip this file */ }
  }
  if (results.length) _cvAddFiles(results);
  else _cvToast(t('cv_err_upload'), 'error');
});

// ── CLEAR ALL ─────────────────────────────────────────────────
_cvEl('ct-clear-all-btn')?.addEventListener('click', () => {
  _cvFiles = [];
  _cvRenderStaging();
  const prog = _cvEl('ct-progress-list');
  if (prog) prog.innerHTML = `<div class="ct-conv-empty-state">${t('cv_no_conversions')}</div>`;
});

// ── CONVERT ALL ───────────────────────────────────────────────
_cvEl('ct-convert-btn')?.addEventListener('click', async () => {
  if (!_cvFiles.length) return;
  if (!_cvIsProUser()) { navigateTo('license'); return; }

  const payload = _cvFiles.map(f => ({
    path:          f.path,
    format:        f.format || _CV_DEFAULT_FORMAT[f.type] || 'mp4',
    output_folder: _cvOutFolder || '',
  }));

  const btn = _cvEl('ct-convert-btn');
  btn.disabled = true;
  btn.textContent = t('cv_starting');

  try {
    const res  = await fetch('/api/convert/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ files: payload }),
    });
    const data = await res.json();

    if (res.status === 403 || data.error === 'pro_required') {
      _cvToast(t('cv_pro_required'), 'error');
      btn.disabled = false; btn.querySelector('[data-i18n]')?.setAttribute('data-i18n', 'cv_convert_all'); btn.querySelector('[data-i18n]')&&(btn.querySelector('[data-i18n]').textContent = t('cv_convert_all'));
      navigateTo('license');
      return;
    }
    if (data.error) {
      _cvToast(data.error, 'error');
      btn.disabled = false; if (btn.querySelector('[data-i18n]')) btn.querySelector('[data-i18n]').textContent = t('cv_convert_all');
      return;
    }

    // Render progress items
    const progressList = _cvEl('ct-progress-list');
    progressList.innerHTML = '';
    const jobs = data.jobs || [];
    _cvTotalJobs     = jobs.filter(j => j.job_id).length;
    _cvCompletedJobs = 0;
    _cvUpdateOverall();
    for (const job of jobs) {
      _cvRenderProgressItem(job);
      if (job.job_id) _cvStartPoll(job.job_id);
      else { _cvCompletedJobs++; _cvUpdateOverall(); } // error at start
    }

    // Clear staging
    _cvFiles = [];
    _cvRenderStaging();

  } catch (e) {
    _cvToast(t('cv_err_conv_start'), 'error');
  }

  btn.disabled = false; if (btn.querySelector('[data-i18n]')) btn.querySelector('[data-i18n]').textContent = t('cv_convert_all');
});

// ── OVERALL PROGRESS BAR ─────────────────────────────────────
let _cvTotalJobs     = 0;
let _cvCompletedJobs = 0;

function _cvUpdateOverall() {
  const wrap  = _cvEl('ct-overall-wrap');
  const bar   = _cvEl('ct-overall-bar');
  const label = _cvEl('ct-overall-label');
  if (!wrap) return;
  if (_cvTotalJobs === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const pct = Math.round(_cvCompletedJobs / _cvTotalJobs * 100);
  if (bar)   bar.style.width = `${pct}%`;
  if (label) label.textContent = `${_cvCompletedJobs} / ${_cvTotalJobs}`;
  if (bar) bar.style.background = _cvCompletedJobs >= _cvTotalJobs ? 'var(--green)' : '#f59e0b';
}

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
        <span class="ct-prog-msg" id="cvmsg-${job.job_id}">${t('cv_queued')}</span>
        <button class="btn-icon ct-cancel-btn" id="cvcnl-${job.job_id}" title="${t('cv_cancel')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }
  list.appendChild(el);

  _cvEl(`cvcnl-${job.job_id}`)?.addEventListener('click', async () => {
    await fetch(`/api/convert/cancel/${job.job_id}`, { method:'POST' });
    _cvStopPoll(job.job_id);
    _cvUpdateProgress(job.job_id, { status:'cancelled', pct:0, msg:t('cv_cancelled') });
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
      const fname  = (data.output || '').split(/[\\/]/).pop() || 'file';
      const output = data.output || '';
      msg.innerHTML = `<span style="color:var(--green);" title="${fname}">✓ ${fname}</span>`;
      // Replace cancel button with "Abrir carpeta"
      if (cnl) {
        const folder = cnl.cloneNode(false);
        folder.title = t('cv_open_folder');
        folder.style.display = '';
        folder.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
        folder.addEventListener('click', () => {
          fetch('/api/open_folder', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ path: output }) });
        });
        cnl.replaceWith(folder);
      }
      _cvCompletedJobs++;
      _cvUpdateOverall();
    } else if (data.status === 'error') {
      msg.innerHTML = `<span style="color:var(--red);" title="${data.msg || ''}">${data.msg || 'Error'}</span>`;
      _cvCompletedJobs++; _cvUpdateOverall();
    } else if (data.status === 'cancelled') {
      msg.innerHTML = `<span style="color:var(--gray);">${t('cv_cancelled')}</span>`;
      _cvCompletedJobs++; _cvUpdateOverall();
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

// State
let _thumbUrls  = [];   // [{videoId, url, title}]
let _thumbFmt   = 'jpg';
let _thumbSize  = 'maxres';
const _THUMB_SIZE_URL = {
  maxres: id => `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
  sd:     id => `https://img.youtube.com/vi/${id}/sddefault.jpg`,
  hq:     id => `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
  mq:     id => `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
};
const _THUMB_FALLBACK_SIZE = { maxres: 'hq', sd: 'hq', hq: 'mq', mq: 'mq' };

// Extract YouTube video ID from any URL format
function _ctExtractVideoId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// Format chip selection (col 2)
document.querySelectorAll('[data-thumb-fmt]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-thumb-fmt]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    _thumbFmt = btn.dataset.thumbFmt;
  });
});

// Size chip selection (col 2)
document.querySelectorAll('[data-thumb-size]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-thumb-size]').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    _thumbSize = btn.dataset.thumbSize;
  });
});

// ── FETCH TITLE VIA OEMBED ────────────────────────────────────
async function _ctFetchTitle(videoId) {
  try {
    const r    = await fetch('/api/thumbget/title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId }),
    });
    const data = await r.json();
    if (data.title && data.title !== videoId) return data.title;
  } catch (e) {
    console.warn('[thumbget/title]', e);
  }
  return null;
}

// ── ADD URL (col 1 input) ─────────────────────────────────────
async function _ctThumbAddFromInput() {
  const input = _cvEl('ct-thumb-url');
  const url   = (input?.value || '').trim();
  if (!url) return;
  const vid = _ctExtractVideoId(url);
  if (!vid) { _cvToast(t('ct_invalid_url'), 'error'); return; }
  if (_thumbUrls.find(u => u.videoId === vid)) {
    _cvToast(t('ct_already_added'), 'info');
    input.value = '';
    return;
  }

  // Add immediately so the user sees it right away
  _thumbUrls.push({ videoId: vid, url, title: vid });
  input.value = '';
  _ctThumbRenderList();
  _ctThumbUpdateCol3();

  // Fetch real title (~500ms with oEmbed)
  const title = await _ctFetchTitle(vid);
  if (title) {
    const entry = _thumbUrls.find(u => u.videoId === vid);
    if (entry) {
      entry.title = title;
      _ctThumbRenderList();
      _ctThumbUpdateCol3();
    }
  }
}

_cvEl('ct-thumb-add-btn')?.addEventListener('click', _ctThumbAddFromInput);
_cvEl('ct-thumb-url')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); _ctThumbAddFromInput(); }
});
_cvEl('ct-thumb-url')?.addEventListener('paste', e => {
  setTimeout(() => _ctThumbAddFromInput(), 80);
});

// ── SHOW PREVIEW / GALLERY (col 3) ───────────────────────────
function _ctThumbUpdateCol3() {
  const hint       = _cvEl('ct-thumb-hint');
  const singleWrap = _cvEl('ct-thumb-preview-wrap');
  const galWrap    = _cvEl('ct-thumb-gallery-wrap');
  const n          = _thumbUrls.length;

  if (n === 0) {
    if (hint)       hint.style.display       = '';
    if (singleWrap) singleWrap.style.display = 'none';
    if (galWrap)    galWrap.style.display    = 'none';
    return;
  }

  if (n === 1) {
    // Single preview
    if (hint)       hint.style.display       = 'none';
    if (galWrap)    galWrap.style.display    = 'none';
    if (singleWrap) singleWrap.style.display = '';
    const entry   = _thumbUrls[0];
    const titleEl = _cvEl('ct-thumb-preview-title');
    const img     = _cvEl('ct-thumb-preview-img');
    if (titleEl) titleEl.textContent = entry.title !== entry.videoId ? entry.title : '';
    if (img) {
      img.src     = `https://img.youtube.com/vi/${entry.videoId}/hqdefault.jpg`;
      img.onerror = () => { img.src = `https://img.youtube.com/vi/${entry.videoId}/mqdefault.jpg`; };
    }
  } else {
    // Gallery mode
    if (hint)       hint.style.display       = 'none';
    if (singleWrap) singleWrap.style.display = 'none';
    if (galWrap)    galWrap.style.display    = '';
    const labelEl = _cvEl('ct-thumb-gallery-label');
    if (labelEl)  labelEl.textContent = t('ct_gallery_label').replace('{n}', n);
    const gallery = _cvEl('ct-thumb-gallery');
    if (!gallery) return;
    gallery.innerHTML = '';
    for (const entry of _thumbUrls) {
      const item = document.createElement('div');
      item.className = 'ct-thumb-gallery-item';
      const shortTitle = entry.title !== entry.videoId ? entry.title : entry.videoId;
      item.innerHTML = `
        <img src="https://img.youtube.com/vi/${entry.videoId}/mqdefault.jpg"
             alt="${shortTitle}"
             onerror="this.src='https://img.youtube.com/vi/${entry.videoId}/hqdefault.jpg'" />
        <div class="ct-gal-title">${shortTitle}</div>`;
      gallery.appendChild(item);
    }
  }
}

function _ctThumbShowPreview(videoId, title) {
  _ctThumbUpdateCol3();
}

// ── RENDER LIST (col 2) ───────────────────────────────────────
function _ctThumbRenderList() {
  const list    = _cvEl('ct-thumb-list');
  const opts    = _cvEl('ct-thumb-list-options');
  const count   = _cvEl('ct-thumb-count');
  const clearBtn= _cvEl('ct-thumb-clear-btn');
  const dlLabel = _cvEl('ct-thumb-dl-label');
  if (!list) return;

  const n = _thumbUrls.length;
  if (count)   count.textContent   = n ? `${n} links` : t('ct_no_links');
  if (clearBtn) clearBtn.style.display = n ? '' : 'none';
  if (opts)    opts.style.display   = n ? '' : 'none';
  if (dlLabel) dlLabel.textContent  = t('ct_download_all_n').replace('{n}', n);

  list.innerHTML = '';
  for (const entry of _thumbUrls) {
    const item = document.createElement('div');
    item.className = 'batch-staging-item';
    item.style.cursor = 'pointer';
    item.innerHTML = `
      <div class="batch-platform-badge" style="background:rgba(239,68,68,0.12);color:#ef4444;flex-shrink:0;">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:12px;height:12px;"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
      </div>
      <div class="batch-url" style="flex:1;min-width:0;cursor:pointer;">
        <div style="font-size:0.72rem;font-weight:600;color:${entry.title !== entry.videoId ? 'var(--secondary)' : 'var(--gray)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${entry.title !== entry.videoId ? entry.title : t('ct_loading_title')}
        </div>
        <div style="font-size:0.68rem;color:var(--gray);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${entry.url}</div>
      </div>
      <button class="btn-icon ct-thumb-remove-btn" data-vid="${entry.videoId}" title="${t('cv_remove')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    // Click row → show preview
    item.addEventListener('click', e => {
      if (e.target.closest('.ct-thumb-remove-btn')) return;
      _ctThumbShowPreview(entry.videoId, entry.title);
    });
    // Remove button
    item.querySelector('.ct-thumb-remove-btn').addEventListener('click', () => {
      _thumbUrls = _thumbUrls.filter(u => u.videoId !== entry.videoId);
      _ctThumbRenderList();
      _ctThumbUpdateCol3();
    });
    list.appendChild(item);
  }
}

// ── CLEAR ALL ─────────────────────────────────────────────────
window.ctThumbClearAll = function() {
  _thumbUrls = [];
  _ctThumbRenderList();
  _ctThumbUpdateCol3();
};

// ── RECORD TO QUEUE + LIBRARY ─────────────────────────────────
function _ctThumbRecordLibrary(entry, saveData) {
  const previewUrl = `https://img.youtube.com/vi/${entry.videoId}/hqdefault.jpg`;
  const item = {
    id:        `thumb_${entry.videoId}_${Date.now()}`,
    title:     entry.title !== entry.videoId ? entry.title : (saveData.filename || entry.videoId),
    thumbnail: previewUrl,
    format:    'image',
    platform:  'thumbnail',
    quality:   _thumbSize.toUpperCase(),
    filename:  saveData.filename || '',
    date:      new Date().toISOString(),
    url:       `https://www.youtube.com/watch?v=${entry.videoId}`,
  };
  if (typeof window.addCompletedItem === 'function') {
    window.addCompletedItem(item);
  } else if (typeof window.addToLibrary === 'function') {
    window.addToLibrary(item);
  }
}

// ── DOWNLOAD ALL ──────────────────────────────────────────────
_cvEl('ct-thumb-dl-all-btn')?.addEventListener('click', async () => {
  if (!_thumbUrls.length) return;
  const btn    = _cvEl('ct-thumb-dl-all-btn');
  const log    = _cvEl('ct-thumb-dl-log');
  if (!btn || !log) return;

  btn.disabled = true;
  log.style.display = '';
  log.innerHTML = '';
  let done = 0;

  for (const entry of [..._thumbUrls]) {
    // Skip entries already downloaded in a previous run this session
    if (entry.downloaded) continue;

    const logLine = document.createElement('div');
    logLine.textContent = `⟳ ${entry.title !== entry.videoId ? entry.title : entry.url}`;
    log.appendChild(logLine);
    log.scrollTop = log.scrollHeight;

    const primaryUrl  = _THUMB_SIZE_URL[_thumbSize](entry.videoId);
    const fallbackUrl = _THUMB_SIZE_URL[_THUMB_FALLBACK_SIZE[_thumbSize]](entry.videoId);
    const title       = entry.title !== entry.videoId ? entry.title : `youtube_${entry.videoId}`;

    try {
      const saveRes  = await fetch('/api/thumbget/save', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url: primaryUrl, filename: title, format: _thumbFmt }),
      });
      const saveData = await saveRes.json();
      if (saveData.error) {
        const retry = await fetch('/api/thumbget/save', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ url: fallbackUrl, filename: title, format: _thumbFmt }),
        });
        const retryData = await retry.json();
        if (retryData.ok) {
          entry.downloaded = true;
          _ctThumbRecordLibrary(entry, retryData);
          logLine.innerHTML = `<span style="color:var(--green);">✓ ${title} (fallback)</span>`;
          done++;
        } else {
          logLine.innerHTML = `<span style="color:var(--red);">✗ ${saveData.error}</span>`;
        }
      } else {
        entry.downloaded = true;
        _ctThumbRecordLibrary(entry, saveData);
        logLine.innerHTML = `<span style="color:var(--green);">✓ ${saveData.filename}</span>`;
        done++;
      }
    } catch {
      logLine.innerHTML = `<span style="color:var(--red);">${t('ct_network_error')}</span>`;
    }

    log.scrollTop = log.scrollHeight;
    await new Promise(r => setTimeout(r, 200));
  }

  btn.disabled = false;
  _cvToast(t('ct_downloaded_n').replace('{n}', done), 'success');
});

// ── .TXT DROPZONE + FILE INPUT (col 1) ───────────────────────
const _ctThumbDropzone = _cvEl('ct-thumb-dropzone');
_ctThumbDropzone?.addEventListener('dragover', e => { e.preventDefault(); _ctThumbDropzone.classList.add('drag-over'); });
_ctThumbDropzone?.addEventListener('dragleave', () => _ctThumbDropzone.classList.remove('drag-over'));
_ctThumbDropzone?.addEventListener('drop', async e => {
  e.preventDefault();
  _ctThumbDropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.txt')) _ctThumbLoadTxt(file);
});
_cvEl('ct-thumb-upload-btn')?.addEventListener('click', () => _cvEl('ct-thumb-file-input')?.click());
_cvEl('ct-thumb-file-input')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) _ctThumbLoadTxt(file);
  e.target.value = '';
});

async function _ctThumbLoadTxt(file) {
  const text  = await file.text();
  const lines = text.split('\n').map(u => u.trim()).filter(u => u.includes('youtu'));
  let added = 0;
  const newVids = [];
  for (const url of lines) {
    const vid = _ctExtractVideoId(url);
    if (!vid || _thumbUrls.find(u => u.videoId === vid)) continue;
    _thumbUrls.push({ videoId: vid, url, title: vid });
    newVids.push(vid);
    added++;
  }
  if (!added) return;
  _ctThumbRenderList();
  _ctThumbUpdateCol3();
  _cvToast(t('ct_links_added').replace('{n}', added), 'success');
  // Fetch titles for all newly added URLs
  for (const vid of newVids) {
    const title = await _ctFetchTitle(vid);
    if (title) {
      const entry = _thumbUrls.find(u => u.videoId === vid);
      if (entry) { entry.title = title; _ctThumbRenderList(); _ctThumbUpdateCol3(); }
    }
  }
}

// ── INIT ─────────────────────────────────────────────────────
(function cvInit() {
  _cvUpdateProGate();

  // Pre-fill output folder with the app's downloads dir
  fetch('/api/converter/default_folder').then(r => r.json()).then(d => {
    if (d.path && !_cvOutFolder) {
      _cvOutFolder = d.path;
      const el = _cvEl('ct-out-folder');
      if (el) el.value = d.path;
    }
  }).catch(() => {});
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
