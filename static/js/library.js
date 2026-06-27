/* ============================================================
   GRABBIT — library.js
   Download history with hover actions
   ============================================================ */

const libraryItems   = JSON.parse(localStorage.getItem('grabbit-library') || '[]');
const libraryContent = document.getElementById('library-content');
const libraryEmpty   = document.getElementById('library-empty');

// IDs the user explicitly removed — the polling loop must never re-add them
// Auto-clean: remove deterministic thumb IDs (thumb_<11chars>, no timestamp) that
// were written by a buggy version — they block future downloads of the same video.
(function _cleanBadThumbIds() {
  try {
    const raw     = JSON.parse(localStorage.getItem('grabbit-library-removed') || '[]');
    const cleaned = raw.filter(id => !/^thumb_[A-Za-z0-9_-]{11}$/.test(id));
    if (cleaned.length !== raw.length) {
      localStorage.setItem('grabbit-library-removed', JSON.stringify(cleaned));
    }
  } catch { /* ignore */ }
})();
const removedIds = new Set(JSON.parse(localStorage.getItem('grabbit-library-removed') || '[]'));

function persistRemovedIds() {
  localStorage.setItem('grabbit-library-removed', JSON.stringify([...removedIds]));
}

function markRemoved(id) {
  if (!id) return;
  removedIds.add(id);
  persistRemovedIds();
}

window.addToLibrary = function(item) {
  // Never re-add an item the user explicitly removed
  if (item.id && removedIds.has(item.id)) return;

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
    renderLibrary();
    return;
  }

  libraryItems.unshift(item);
  localStorage.setItem('grabbit-library', JSON.stringify(libraryItems.slice(0, 500)));
  renderLibrary();
};

// ── Sync library with disk on load ────────────────────────
// Aggressively normalize a string for filename matching.
// Strips emojis, accents, special chars, hashtags — keeps only ASCII letters and digits,
// joined by underscores. Mirrors what yt-dlp --restrict-filenames produces.
function _normalizeForMatch(s) {
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}]/gu, ' ') // strip emojis
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// Extract "significant" words (4+ chars, ASCII alphanumeric) from a title.
// These survive yt-dlp's filename sanitization and let us match even if the
// title has emojis, hashtags, or got trimmed.
function _significantWords(title) {
  const norm = _normalizeForMatch(title);
  return norm.split('_').filter(w => w.length >= 4);
}

// Returns the matching filename if any file in fileList likely corresponds to this item.
// Uses a "significant words" matcher: if at least one of the longer words
// from the title appears in any file, the item is considered present.
function _getMatchingFile(item, fileList) {
  if (!fileList || fileList.length === 0) return null;

  const words = _significantWords(item.title || '');
  if (words.length === 0) return fileList[0] || null;  // title is all emojis/short — just guess the first one or ignore

  const normFiles = fileList.map(f => _normalizeForMatch(f));

  // Find the first file where AT LEAST ONE significant word appears
  const idx = normFiles.findIndex(f => words.some(w => f.includes(w)));
  return idx !== -1 ? fileList[idx] : null;
}

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
      folderFiles[folder] = data.files || [];
    } catch {
      folderFiles[folder] = null; // null = couldn't check
    }
  }));

  let changed = false;
  libraryItems.forEach(item => {
    const folder = item.saveFolder || defaultFolder;
    if (!folder) return;

    const fileList = folderFiles[folder];
    if (fileList === null) return; // can't reach folder — assume ok

    // Item is missing if no file in its folder matches its title
    // But give it a 20-second grace period after download to allow Windows/OneDrive to index the file
    const matchedFile = _getMatchingFile(item, fileList);
    const ageMs = Date.now() - new Date(item.date).getTime();
    const missing = !matchedFile && ageMs > 20000;

    if (matchedFile) {
      item.filename = matchedFile;
    }

    if (!!item.missing !== missing) {
      item.missing = missing;
      changed = true;
    }
  });

  if (changed) {
    localStorage.setItem('grabbit-library', JSON.stringify(libraryItems));
    renderLibrary();
  }

  const missingCount = libraryItems.filter(i => i.missing).length;
  const clearBtn = document.getElementById('clear-deleted-btn');
  if (clearBtn) {
    clearBtn.style.display = missingCount > 0 ? 'inline-flex' : 'none';
    const label = typeof t === 'function' ? t('library_clear_deleted') : 'Clear deleted';
    clearBtn.textContent = `${label} (${missingCount})`;
  }
}

// ── Remove missing items ──────────────────────────────────
function removeMissingItems() {
  const before = libraryItems.length;
  const toRemove = libraryItems.filter(i => i.missing);
  const keep     = libraryItems.filter(i => !i.missing);
  const removed  = before - keep.length;
  if (removed > 0) {
    toRemove.forEach(i => markRemoved(i.id));
    libraryItems.length = 0;
    keep.forEach(i => libraryItems.push(i));
    localStorage.setItem('grabbit-library', JSON.stringify(libraryItems));
    renderLibrary();
    if (window.showToast) {
      const msg = typeof t === 'function'
        ? t('library_removed_n').replace('{n}', removed)
        : `${removed} items removed`;
      showToast(msg, 'info');
    }
  }
}

function renderLibrary() {
  const filter = document.querySelector('#lib-platform-filters .chip.selected')?.dataset.filter || 'all';
  const query  = (document.getElementById('lib-search-input')?.value || '').toLowerCase().trim();
  const sortBy = document.getElementById('sort-select')?.value || 'newest';

  // Clear existing groups
  libraryContent.querySelectorAll('.date-group, .library-grid').forEach(el => el.remove());

  let filtered = libraryItems.filter(i => {
    // 1. Platform / format filter
    if (filter !== 'all') {
      if (filter === 'text') {
        if (i.format !== 'text') return false;
      } else if (filter === 'thumbnail') {
        if (i.platform !== 'thumbnail') return false;
      } else if (filter === 'other') {
        if (['youtube','tiktok','instagram','facebook','thumbnail'].includes(i.platform)) return false;
        if (i.format === 'text') return false;
      } else {
        if (i.platform !== filter) return false;
      }
    }
    // 2. Search filter
    if (query) {
      if (!i.title || !i.title.toLowerCase().includes(query)) return false;
    }
    return true;
  });

  // 3. Sort
  if (sortBy === 'oldest') {
    filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
  } else if (sortBy === 'name') {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (sortBy === 'platform') {
    filtered.sort((a, b) => (a.platform || '').localeCompare(b.platform || ''));
  } else { // newest
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  if (filtered.length === 0) {
    libraryEmpty.style.display = 'block';
    return;
  }

  libraryEmpty.style.display = 'none';

  // Group by date
  const groups = {};
  filtered.forEach(item => {
    const d   = new Date(item.date);
    const locale = typeof getLocale === 'function' ? getLocale() : 'en-US';
    const key = isToday(d)
      ? (typeof t === 'function' ? t('lib_today') : 'Today')
      : isYesterday(d)
        ? (typeof t === 'function' ? t('lib_yesterday') : 'Yesterday')
        : d.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' });
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
      const typeClass = item.format === 'audio' ? 'audio' : item.format === 'text' ? 'text' : item.format === 'image' ? 'image' : 'video';
      const typeLabel = item.format === 'audio' ? 'MP3' : item.format === 'text' ? 'TXT' : item.format === 'image' ? (item.filename?.split('.').pop()?.toUpperCase() || 'IMG') : 'MP4';
      const thumbSrc = item.thumbnail
        ? `/api/thumbnail?url=${encodeURIComponent(item.thumbnail)}`
        : `/api/placeholder_thumb?platform=${item.platform || 'other'}`;

      // Format duration (e.g. 125 -> "02:05")
      let durStr = '';
      if (item.duration && !isNaN(item.duration)) {
        const d = Math.round(Number(item.duration));
        const m = Math.floor(d / 60);
        const s = (d % 60).toString().padStart(2, '0');
        durStr = `<span class="lib-meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${m}:${s}</span>`;
      }
      
      // Format file size (e.g. 1500000 -> "1.5 MB")
      let sizeStr = '';
      if (item.file_size && !isNaN(item.file_size)) {
        const mb = (Number(item.file_size) / (1024 * 1024)).toFixed(1);
        sizeStr = `<span class="lib-meta-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ${mb} MB</span>`;
      }

      el.innerHTML = `
        <div class="lib-thumb-wrap" style="${item.missing ? 'opacity:0.4;' : ''}">
          ${`<img class="lib-thumb" src="${thumbSrc}" alt=""
            data-platform="${item.platform || 'other'}"
            id="lib-thumb-${item.id}" />`}
          <span class="lib-type-badge ${typeClass}">${typeLabel}</span>
          ${item.missing ? `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);font-size:0.7rem;color:var(--red);font-weight:700;letter-spacing:0.06em;">${typeof t === 'function' ? t('file_deleted') : 'FILE DELETED'}</div>` : ''}
          <div class="lib-overlay">
            <button class="lib-action-btn" data-action="folder" data-folder="${escapeAttr(item.saveFolder || '')}" title="Open folder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </button>
            <button class="lib-action-btn" data-action="remove" title="Remove from library" style="${item.missing ? 'background:rgba(239,68,68,0.35);border-color:rgba(239,68,68,0.7);' : ''}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="lib-info">
          <div class="lib-title" style="${item.missing ? 'color:var(--text-muted);text-decoration:line-through;' : ''}">${escapeHtml(item.title)}</div>
          <div class="lib-platform platform-${(item.platform || 'other').toLowerCase()}">${item.platform || ''}</div>
          <div class="lib-sub">
            <span class="lib-meta-item">${typeClass === 'audio' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>' : typeClass === 'image' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'} ${typeClass === 'image' ? (item.quality || 'MaxRes') : item.quality === 'best' ? 'HQ' : (item.quality || 'HQ') + 'p'}</span>
            ${durStr}
            ${sizeStr}
          </div>
        </div>
      `;

      // Open folder on card click
      el.addEventListener('click', (e) => {
        if (e.target.closest('.lib-action-btn')) return;
        openFolder(item.saveFolder || '', item.filename);
      });

      // Action buttons
      el.querySelectorAll('.lib-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.dataset.action === 'folder') {
            openFolder(btn.dataset.folder || '', item.filename);
          } else if (btn.dataset.action === 'remove') {
            const idx = libraryItems.findIndex(i => i.id === item.id);
            if (idx !== -1) libraryItems.splice(idx, 1);
            markRemoved(item.id);  // remember so polling doesn't re-add it
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

async function openFolder(folderPath, filename = null) {
  // Use the item's save folder, fall back to user's configured folder, then default
  const target = folderPath
    || localStorage.getItem('grabbit-save-folder')
    || '';
  try {
    let url = target
      ? `/api/open_folder?path=${encodeURIComponent(target)}`
      : '/api/open_folder';
    if (filename) {
      url += (url.includes('?') ? '&' : '?') + `file=${encodeURIComponent(filename)}`;
    }
    await fetch(url);
  } catch { /* ignore */ }
}

// Filter chips
document.querySelectorAll('#lib-platform-filters .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#lib-platform-filters .chip').forEach(c => {
      c.classList.remove('selected');
      c.style.borderColor = '';
      c.style.color = '';
      c.style.background = '';
    });
    chip.classList.add('selected');
    
    // Dynamic search styling
    const color = chip.dataset.color || 'var(--primary)';
    const searchInput = document.getElementById('lib-search-input');
    const searchIcon  = document.querySelector('.lib-search-icon');
    
    if (chip.dataset.filter === 'all') {
      searchInput.style.borderColor = 'transparent';
      searchInput.placeholder = typeof t === 'function' ? t('search_all') : 'Search in all platforms...';
      searchIcon.style.color = 'var(--gray)';
    } else {
      searchInput.style.borderColor = color;
      searchInput.placeholder = typeof t === 'function'
        ? t('search_in').replace('{p}', chip.textContent.trim())
        : `Search in ${chip.textContent.trim()}...`;
      searchIcon.style.color = color;
    }
    
    renderLibrary();
  });
});

// Search input
document.getElementById('lib-search-input')?.addEventListener('input', () => {
  renderLibrary();
});

// Sort select
document.getElementById('sort-select')?.addEventListener('change', () => {
  renderLibrary();
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

// Detect URL/hostname placeholder titles like "https://...", "www.youtube.com/..."
function _isPlaceholderUrl(t) {
  if (!t) return true;
  const s = t.trim().toLowerCase();
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  if (/^(www\.)?[a-z0-9-]+\.[a-z]{2,}(\.[a-z]{2,})?(\/|$)/.test(s)) return true;
  return false;
}

renderLibrary();
// Expose sync so app.js can call it when navigating to the Library page
window.syncLibrary = syncLibrary;

// Initial check shortly after load
setTimeout(syncLibrary, 800);

// Recheck disk state every 30 seconds while the app is open
setInterval(syncLibrary, 30000);

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
      // Update title/thumbnail of existing items when server has better info
      if (inLibrary && item.title && !_isPlaceholderUrl(item.title) && item.title !== inLibrary.title) {
        inLibrary.title = item.title;
        if (item.thumbnail) inLibrary.thumbnail = item.thumbnail;
        localStorage.setItem('grabbit-library', JSON.stringify(libraryItems));
        renderLibrary();
      }
    });
  } catch { /* ignore */ }
}, 5000);