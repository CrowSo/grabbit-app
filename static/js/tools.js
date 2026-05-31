/* ============================================================
   GRABBIT — tools.js
   Auto-update checker, tool status polling, update buttons
   ============================================================ */

const ytdlpStatusEl  = document.getElementById('ytdlp-status');
const ffmpegStatusEl = document.getElementById('ffmpeg-status');
const denoStatusEl   = document.getElementById('deno-status');

// ── Poll startup status until tools are ready ──────────────
function getToolLabel(status) {
  const map = {
    ok:         { text: t('tool_ok'),        color: 'var(--green)' },
    updating:   { text: t('tool_updating'),  color: 'var(--secondary)' },
    installing: { text: t('tool_installing'),color: 'var(--secondary)' },
    checking:   { text: t('tool_checking'),  color: 'var(--gray)' },
    error:      { text: t('tool_error'),     color: 'var(--red)' },
  };
  return map[status] || map.checking;
}

function applyToolStatus(data) {
  if (ytdlpStatusEl) {
    const s = getToolLabel(data.ytdlp);
    ytdlpStatusEl.textContent = s.text;
    ytdlpStatusEl.style.color = s.color;
  }
  if (ffmpegStatusEl) {
    const s = getToolLabel(data.ffmpeg);
    ffmpegStatusEl.textContent = s.text;
    ffmpegStatusEl.style.color = s.color;
  }
  if (denoStatusEl) {
    const s = getToolLabel(data.deno);
    denoStatusEl.textContent = s.text;
    denoStatusEl.style.color = s.color;
  }
}

async function pollStartupStatus() {
  const done = ['ok', 'error'];
  let attempts = 0;

  const interval = setInterval(async () => {
    attempts++;
    try {
      const res  = await fetch('/api/startup_status');
      const data = await res.json();
      applyToolStatus(data);

      const bothDone = done.includes(data.ytdlp) && done.includes(data.ffmpeg) && done.includes(data.deno);
      if (bothDone || attempts > 60) {
        clearInterval(interval);
      }
    } catch {
      clearInterval(interval);
    }
  }, 1500);
}

// ── Manual update buttons ──────────────────────────────────
async function manualUpdate(tool, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = tool === 'ytdlp' ? '⟳ Updating...' : '⟳ Updating...';

  try {
    const res    = await fetch('/api/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool }),
    });
    const data   = await res.json();
    const job_id = data.job_id;

    // Poll until done
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`/api/progress/${job_id}`);
        const p = await r.json();

        if (p.status === 'done') {
          clearInterval(poll);
          btn.disabled = false;
          btn.textContent = original;
          if (tool === 'ytdlp' && ytdlpStatusEl) {
            ytdlpStatusEl.textContent = '✓ Installed';
            ytdlpStatusEl.style.color = '#22c55e';
          }
          if (tool === 'ffmpeg' && ffmpegStatusEl) {
            ffmpegStatusEl.textContent = '✓ Installed';
            ffmpegStatusEl.style.color = '#22c55e';
          }
          showToast(tool === 'ytdlp' ? t('toast_ytdlp_ok') : t('toast_ffmpeg_ok'), 'success');
        } else if (p.status === 'error') {
          clearInterval(poll);
          btn.disabled = false;
          btn.textContent = original;
          showToast(t('toast_update_err'), 'error');
        }
      } catch { clearInterval(poll); btn.disabled = false; btn.textContent = original; }
    }, 800);

  } catch {
    btn.disabled = false;
    btn.textContent = original;
    showToast(t('toast_update_err'), 'error');
  }
}

document.getElementById('update-ytdlp-btn')?.addEventListener('click', function() {
  manualUpdate('ytdlp', this);
});

document.getElementById('update-ffmpeg-btn')?.addEventListener('click', function() {
  manualUpdate('ffmpeg', this);
});

// ── Browse folder button ───────────────────────────────────
document.getElementById('browse-btn')?.addEventListener('click', async () => {
  try {
    const res  = await fetch('/api/browse_folder', { method: 'POST' });
    const data = await res.json();
    if (data.path) {
      document.getElementById('save-folder').value = data.path;
      localStorage.setItem('grabbit-save-folder', data.path);
      // Sync to server so extension picks it up
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ save_folder: data.path }),
      });
      showToast(t('toast_folder_ok'), 'success');
    }
  } catch {
    showToast(t('toast_folder_err'), 'error');
  }
});

// Load all settings from server and apply to UI
async function loadSaveFolder() {
  try {
    const res  = await fetch('/api/settings');
    const data = await res.json();

    if (data.save_folder) {
      const el = document.getElementById('save-folder');
      if (el) el.value = data.save_folder;
      localStorage.setItem('grabbit-save-folder', data.save_folder);
    }

    const setSelect = (id, val) => {
      const el = document.getElementById(id);
      if (el && val) el.value = val;
    };

    setSelect('default-quality',  data.default_quality  || 'best');
    setSelect('default-format',   data.default_format   || 'video+audio');
    setSelect('filename-style',   data.filename_style   || 'basic');
    setSelect('video-codec',      data.video_codec      || 'h264');
    setSelect('video-container',  data.video_container  || 'mp4');
    setSelect('audio-format',     data.audio_format     || 'mp3');
    setSelect('audio-bitrate',    data.audio_bitrate    || '192');

  } catch {
    const savedFolder = localStorage.getItem('grabbit-save-folder');
    if (savedFolder) {
      const el = document.getElementById('save-folder');
      if (el) el.value = savedFolder;
    }
  }
}
loadSaveFolder();

// Save any select/input change to server
['default-quality','default-format','filename-style','video-codec','video-container','audio-format','audio-bitrate'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', async function() {
    const key = id.replace(/-/g, '_');
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: this.value }),
    });
  });
});

// ── Download counter in About ──────────────────────────────
async function refreshAboutCounter() {
  const code = localStorage.getItem('grabbit-license') || '';
  try {
    const res  = await fetch(`/api/limits/status?license=${encodeURIComponent(code)}`);
    const data = await res.json();
    const el   = document.getElementById('about-limit-count');
    if (el) el.textContent = data.is_pro
      ? `${data.used} (Pro — unlimited)`
      : `${data.used} / ${data.limit}`;
  } catch { /* ignore */ }
}

refreshAboutCounter();

// ── Load app version from server ──────────────────────────
(async function loadAppVersion() {
  try {
    const res  = await fetch('/api/version');
    const data = await res.json();
    const el   = document.getElementById('app-version');
    if (el && data.version) el.textContent = `v${data.version}`;
  } catch { /* ignore */ }
})();

// ── ENGINE (download engine) — auto-update aware ───────────
const PLATFORM_DISPLAY = {
  youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram',
  facebook: 'Facebook', twitter: 'X', pinterest: 'Pinterest',
  twitch: 'Twitch', soundcloud: 'SoundCloud',
};
let _lastEngineVersion = null;
let _lastPlatformIssue = null;

window.engineCheckNow = async function() {
  const btn = document.getElementById('engine-check-btn');
  if (!btn) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;animation:spin 0.8s linear infinite;">
    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.07-8.5"/>
  </svg><span>${typeof t === 'function' ? t('engine_checking') : 'Checking...'}</span>`;
  try {
    await fetch('/api/engine/check', { method: 'POST' });
    // Wait a few seconds for the background thread to finish, then refresh
    setTimeout(refreshEngineStatus, 3000);
    setTimeout(() => { btn.disabled = false; btn.innerHTML = original; }, 3500);
  } catch {
    btn.disabled = false;
    btn.innerHTML = original;
  }
};

async function refreshEngineStatus() {
  try {
    const res  = await fetch('/api/engine/status');
    const data = await res.json();

    // Toast when the engine version changed (silent update detected)
    if (data.version && _lastEngineVersion && data.version !== _lastEngineVersion) {
      if (window.showToast) {
        showToast(
          typeof t === 'function' ? t('engine_updated_toast') : 'System updated ✓',
          'success', 4000
        );
      }
    }
    if (data.version) _lastEngineVersion = data.version;

    // Platform issue banner
    const banner = document.getElementById('platform-issue-banner');
    const titleEl = document.getElementById('platform-issue-title');
    const bodyEl  = document.getElementById('platform-issue-body');
    if (banner && titleEl && bodyEl) {
      if (data.platform_issue) {
        const platformName = PLATFORM_DISPLAY[data.platform_issue] || data.platform_issue;
        const title = (typeof t === 'function' ? t('platform_issue_title') : 'Issues with {platform}').replace('{platform}', platformName);
        const body  = (typeof t === 'function' ? t('platform_issue_body')  : 'We are detecting problems with {platform}.').replace('{platform}', platformName);
        titleEl.textContent = title;
        bodyEl.textContent  = body;
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
      }
      _lastPlatformIssue = data.platform_issue;
    }
  } catch { /* ignore */ }
}

// Poll every 30s while app is open
refreshEngineStatus();
setInterval(refreshEngineStatus, 30000);

