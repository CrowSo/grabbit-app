/* ============================================================
   GRABBIT — library.js
   Download history with hover actions
   ============================================================ */

const libraryItems   = JSON.parse(localStorage.getItem('grabbit-library') || '[]');
const libraryContent = document.getElementById('library-content');
const libraryEmpty   = document.getElementById('library-empty');

window.addToLibrary = function(item) {
  // Don't add if title is generic platform name (extension downloads before info fetched)
  const genericTitles = ['instagram', 'youtube', 'tiktok', 'facebook', 'twitter', 'pinterest', 'twitch', 'soundcloud'];
  
  // Check if we already have this item — update it instead of duplicating
  const existingIdx = libraryItems.findIndex(i => i.id === item.id);
  if (existingIdx !== -1) {
    // Update title/thumbnail if we got better info
    if (item.title && !genericTitles.includes(item.title.toLowerCase())) {
      libraryItems[existingIdx].title = item.title;
    }
    if (item.thumbnail) {
      libraryItems[existingIdx].thumbnail = item.thumbnail;
    }
    localStorage.setItem('grabbit-library', JSON.stringify(libraryItems.slice(0, 500)));
    renderLibrary(document.querySelector('[data-filter].selected')?.dataset.filter || 'all');
    return;
  }

  libraryItems.unshift(item);
  localStorage.setItem('grabbit-library', JSON.stringify(libraryItems.slice(0, 500)));
  renderLibrary();
};

// ── Sync library with disk on load ────────────────────────
async function syncLibrary() {
  if (libraryItems.length === 0) return;

  const defaultFolder = localStorage.getItem('grabbit-save-folder') || '';
  const folders = [...new Set(
    libraryItems.map(i => i.saveFolder || defaultFolder).filter(Boolean)
  )];
  if (folders.length === 0) return;

  // Fetch file lists for each folder
  const folderFiles = {};
  await Promise.all(folders.map(async folder => {
    try {
      const res  = await fetch(`/api/file_exists?path=${encodeURIComponent(folder)}`);
      const data = await res.json();
      folderFiles[folder] = data.files || [];  // list of filenames in the folder
    } catch {
      folderFiles[folder] = null; // null = assume exists
    }
  }));

  let changed = false;
  libraryItems.forEach(item => {
    const folder = item.saveFolder || defaultFolder;
    if (!folder) return;

    const fileList = folderFiles[folder];
    if (fileList === null) return; // can't check — assume ok

    // If folder is empty or title appears in no file → mark missing
    let missing = false;
    if (fileList.length === 0) {
      missing = true;
    } else if (item.title) {
      // Check if any file in folder contains the title (partial match)
      const titleLower = item.title.toLowerCase().slice(0, 30);
      const found = fileList.some(f => f.toLowerCase().includes(titleLower.slice(0, 20)));
      if (!found && fileList.length > 0) {
        // Also check by platform as fallback — if folder has files, don't mark missing unless folder is truly empty
        missing = false; // Don't mark missing just because filename doesn't match — only mark if folder is empty
      }
    }

    if (!!item.missing !== missing) {
      item.missing = missing;
      changed = true;
    }
  });

  if (changed) {
    localStorage.setItem('grabbit-library', JSON.stringify(libraryItems));
    renderLibrary(document.querySelector('[data-filter].selected')?.dataset.filter || 'all');
  }

  const missingCount = libraryItems.filter(i => i.missing).length;
  const clearBtn = document.getElementById('clear-deleted-btn');
  if (clearBtn) {
    clearBtn.style.display = missingCount > 0 ? 'inline-flex' : 'none';
    clearBtn.textContent = `Clear deleted (${missingCount})`;
  }
}

// ── Remove missing items ──────────────────────────────────
function removeMissingItems() {
  const before = libraryItems.length;
  const keep   = libraryItems.filter(i => !i.missing);
  if (keep.length < before) {
    libraryItems.length = 0;
    keep.forEach(i => libraryItems.push(i));
    localStorage.setItem('grabbit-library', JSON.stringify(libraryItems));
    renderLibrary();
    if (window.showToast) showToast(`Removed ${before - keep.length} missing item${before - keep.length !== 1 ? 's' : ''}`, 'info');
  }
}

function renderLibrary(filter = 'all') {
  // Clear existing groups
  libraryContent.querySelectorAll('.date-group').forEach(el => el.remove());

  const filtered = filter === 'all'
    ? libraryItems
    : libraryItems.filter(i =>
        filter === 'audio'
          ? i.format === 'audio'
          : i.format === 'video' || i.format === 'video+audio'
      );

  if (filtered.length === 0) {
    libraryEmpty.style.display = 'block';
    return;
  }

  libraryEmpty.style.display = 'none';

  // Group by date
  const groups = {};
  filtered.forEach(item => {
    const d   = new Date(item.date);
    const key = isToday(d) ? 'Today' : isYesterday(d) ? 'Yesterday'
      : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  Object.entries(groups).forEach(([label, items]) => {
    const group = document.createElement('div');
    group.className = 'date-group';
    group.innerHTML = `<div class="date-label">${label}</div>`;

    const grid = document.createElement('div');
    grid.className = 'library-grid';

    items.forEach(item => {
      const el        = document.createElement('div');
      el.className    = 'lib-item';
      const typeClass = item.format === 'audio' ? 'audio' : 'video';
      const typeLabel = item.format === 'audio' ? 'MP3' : 'MP4';
      const thumbSrc = item.thumbnail
        ? `/api/thumbnail?url=${encodeURIComponent(item.thumbnail)}`
        : `/api/placeholder_thumb?platform=${item.platform || 'other'}`;

      el.innerHTML = `
        <div class="lib-thumb-wrap" style="${item.missing ? 'opacity:0.4;' : ''}">
          ${`<img class="lib-thumb" src="${thumbSrc}" alt=""
            data-platform="${item.platform || 'other'}"
            id="lib-thumb-${item.id}" />`}
          <span class="lib-type-badge ${typeClass}">${typeLabel}</span>
          ${item.missing ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);font-size:0.7rem;color:#ef4444;font-weight:600;">FILE DELETED</div>` : ''}
          <div class="lib-overlay">
            <button class="lib-action-btn" data-action="folder" data-folder="${escapeAttr(item.saveFolder || '')}" title="Open folder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            ${item.missing ? `<button class="lib-action-btn" data-action="remove" title="Remove from library" style="background:rgba(239,68,68,0.3);border-color:rgba(239,68,68,0.5);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
            </button>` : ''}
          </div>
        </div>
        <div class="lib-info">
          <div class="lib-title" style="${item.missing ? 'color:var(--text-muted);text-decoration:line-through;' : ''}">${escapeHtml(item.title)}</div>
          <div class="lib-sub">
            <span>${item.platform || ''}</span>
            <span>${item.quality === 'best' ? 'HQ' : (item.quality || 'HQ') + 'p'}</span>
          </div>
        </div>
      `;

      // Open folder on card click
      el.addEventListener('click', (e) => {
        if (e.target.closest('.lib-action-btn')) return;
        openFolder(item.saveFolder || '');
      });

      // Action buttons
      el.querySelectorAll('.lib-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.dataset.action === 'folder') {
            openFolder(btn.dataset.folder || '');
          } else if (btn.dataset.action === 'remove') {
            const idx = libraryItems.findIndex(i => i.id === item.id);
            if (idx !== -1) libraryItems.splice(idx, 1);
            localStorage.setItem('grabbit-library', JSON.stringify(libraryItems));
            el.remove();
            if (libraryItems.length === 0) libraryEmpty.style.display = 'block';
          }
        });
      });

      // Thumbnail fallback to placeholder on error
      const imgEl = el.querySelector('.lib-thumb');
      if (imgEl) {
        imgEl.addEventListener('error', function() {
          const plat = this.dataset.platform || 'other';
          this.src = `/api/placeholder_thumb?platform=${plat}`;
          this.removeEventListener('error', arguments.callee);
        });
      }

      grid.appendChild(el);
    });

    group.appendChild(grid);
    libraryContent.appendChild(group);
  });
}

async function openFolder(folderPath) {
  // Use the item's save folder, fall back to user's configured folder, then default
  const target = folderPath
    || localStorage.getItem('grabbit-save-folder')
    || '';
  try {
    const url = target
      ? `/api/open_folder?path=${encodeURIComponent(target)}`
      : '/api/open_folder';
    await fetch(url);
  } catch { /* ignore */ }
}

// Filter chips
document.querySelectorAll('[data-filter]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
    renderLibrary(chip.dataset.filter);
  });
});

// Clear deleted button
document.getElementById('clear-deleted-btn')?.addEventListener('click', () => {
  removeMissingItems();
  const btn = document.getElementById('clear-deleted-btn');
  if (btn) btn.style.display = 'none';
});

// ── Helpers ─────────────────────────────────────────────
function isToday(d) {
  const t = new Date();
  return d.getDate() === t.getDate() && d.getMonth() === t.getMonth() && d.getFullYear() === t.getFullYear();
}

function isYesterday(d) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return d.getDate() === y.getDate() && d.getMonth() === y.getMonth() && d.getFullYear() === y.getFullYear();
}

function escapeHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

renderLibrary();
// Check which files still exist on disk after a short delay
setTimeout(syncLibrary, 800);

// Poll server for new completed items (from extension downloads)
setInterval(async function() {
  try {
    const res  = await fetch('/api/queue/state');
    const data = await res.json();
    const items = data.items || [];
    // Find done items not yet in library
    items.forEach(item => {
      if (item.status !== 'done') return;
      const inLibrary = libraryItems.find(l => l.id === item.id);
      if (!inLibrary && item.title && item.saveFolder) {
        window.addToLibrary({
          id:         item.id,
          title:      item.title,
          thumbnail:  item.thumbnail || '',
          platform:   item.platform  || 'other',
          format:     item.format    || 'video+audio',
          quality:    item.quality   || 'best',
          date:       new Date().toISOString(),
          saveFolder: item.saveFolder,
        });
      }
      // Update title/thumbnail of existing items if they have generic names
      if (inLibrary && item.title && !item.title.startsWith('http') && item.title !== inLibrary.title) {
        inLibrary.title = item.title;
        if (item.thumbnail) inLibrary.thumbnail = item.thumbnail;
        localStorage.setItem('grabbit-library', JSON.stringify(libraryItems));
        renderLibrary(document.querySelector('[data-filter].selected')?.dataset.filter || 'all');
      }
    });
  } catch { /* ignore */ }
}, 5000);