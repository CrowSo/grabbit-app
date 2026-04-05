/* ============================================================
   GRABBIT — tools.js
   Auto-update checker, tool status polling, update buttons
   ============================================================ */

const ytdlpStatusEl  = document.getElementById('ytdlp-status');
const ffmpegStatusEl = document.getElementById('ffmpeg-status');

// ── Poll startup status until tools are ready ──────────────
function getToolLabel(status) {
  const map = {
    ok:         { text: '✓ Installed', color: '#22c55e' },
    updating:   { text: '⟳ Updating...',  color: 'var(--accent)' },
    installing: { text: '⬇ Installing...', color: 'var(--accent)' },
    checking:   { text: '... Checking',   color: 'var(--text-muted)' },
    error:      { text: '✗ Error',         color: '#ef4444' },
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

      const bothDone = done.includes(data.ytdlp) && done.includes(data.ffmpeg);
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
          showToast(tool === 'ytdlp' ? 'yt-dlp updated ✓' : 'FFmpeg updated ✓', 'success');
        } else if (p.status === 'error') {
          clearInterval(poll);
          btn.disabled = false;
          btn.textContent = original;
          showToast('Update failed. Check your connection.', 'error');
        }
      } catch { clearInterval(poll); btn.disabled = false; btn.textContent = original; }
    }, 800);

  } catch {
    btn.disabled = false;
    btn.textContent = original;
    showToast('Update failed. Check your connection.', 'error');
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
      showToast('Folder updated ✓', 'success');
    }
  } catch {
    showToast('Could not open folder picker.', 'error');
  }
});

// Restore saved folder on load — prefer server settings
async function loadSaveFolder() {
  try {
    const res  = await fetch('/api/settings');
    const data = await res.json();
    if (data.save_folder) {
      const el = document.getElementById('save-folder');
      if (el) el.value = data.save_folder;
      localStorage.setItem('grabbit-save-folder', data.save_folder);
    }
  } catch {
    const savedFolder = localStorage.getItem('grabbit-save-folder');
    if (savedFolder) {
      const el = document.getElementById('save-folder');
      if (el) el.value = savedFolder;
    }
  }
}
loadSaveFolder();

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