/* ============================================================
   GRABBIT — watchlist.js
   Watch List: channel bookmarks + video browser with date filters
   ============================================================ */

let watchlistItems   = [];
let _activeChannelId = null;   // id of the channel being browsed (null = list view)
let _checkNowBusy    = false;  // throttle: only one check-now at a time

// ── Init ──────────────────────────────────────────────────
function initWatchlist() {
  loadWatchlist();
  setInterval(loadWatchlist, 30000);

  document.getElementById('watch-add-btn').addEventListener('click', watchAddChannel);
  document.getElementById('watch-url-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') watchAddChannel();
  });
}

// ── View routing ──────────────────────────────────────────
function _showChannelList() {
  _activeChannelId = null;
  document.getElementById('watch-channel-list-view').style.display = '';
  document.getElementById('watch-video-browser').style.display     = 'none';
}

function _showVideoBrowser(item) {
  _activeChannelId = item.id;
  document.getElementById('watch-channel-list-view').style.display = 'none';
  document.getElementById('watch-video-browser').style.display     = '';

  // Header info
  const thumb = item.thumbnail
    ? `/api/thumbnail?url=${encodeURIComponent(item.thumbnail)}`
    : `/api/placeholder_thumb?platform=${item.platform || 'youtube'}`;
  document.getElementById('wvb-avatar').src            = thumb;
  const nameEl = document.getElementById('wvb-channel-name');
  nameEl.textContent  = item.channel_name || item.channel_url;
  nameEl.dataset.url  = item.channel_url;   // period buttons read this

  // Mark as seen (clear NEW badge)
  if (item.has_new) {
    fetch('/api/watchlist/seen', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    });
    item.has_new = false;
    renderWatchlist();
    updateWatchBadge();
  }

  // Reset state so a fresh fetch always happens when entering a new channel
  _currentChannelUrl = '';
  _currentVideos     = [];
  _currentTab        = 'videos';
  _setActiveTab('videos');
  _loadChannelVideos(item.channel_url, null, 'videos');
}

// ── Load channel list ─────────────────────────────────────
async function loadWatchlist() {
  try {
    const res  = await fetch('/api/watchlist/state');
    const data = await res.json();
    watchlistItems = data.items || [];
    renderWatchlist();
    updateWatchBadge();
  } catch { /* offline */ }
}

function renderWatchlist() {
  const list  = document.getElementById('watch-list');
  const empty = document.getElementById('watch-empty');
  if (!list) return;

  if (!watchlistItems.length) {
    empty.style.display = '';
    list.querySelectorAll('.watch-card').forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';

  const existingIds = new Set([...list.querySelectorAll('.watch-card')].map(el => el.dataset.id));
  const currentIds  = new Set(watchlistItems.map(i => i.id));

  existingIds.forEach(id => {
    if (!currentIds.has(id)) list.querySelector(`[data-id="${id}"]`)?.remove();
  });

  watchlistItems.forEach(item => {
    const existing = list.querySelector(`[data-id="${item.id}"]`);
    if (existing) {
      _patchChannelCard(existing, item);
    } else {
      list.appendChild(_buildChannelCard(item));
    }
  });
}

// ── Channel card ──────────────────────────────────────────
function _buildChannelCard(item) {
  const card = document.createElement('div');
  card.className  = 'watch-card';
  card.dataset.id = item.id;
  card.innerHTML  = _channelCardHTML(item);
  _bindChannelCardEvents(card, item);
  return card;
}

function _patchChannelCard(el, item) {
  const newDot = el.querySelector('.watch-new-dot');
  if (newDot) newDot.style.display = item.has_new ? '' : 'none';

  const errEl = el.querySelector('.watch-card-error');
  if (errEl) { errEl.textContent = item.last_error || ''; errEl.style.display = item.last_error ? '' : 'none'; }

  const checkBtn = el.querySelector('.watch-check-now-btn');
  if (checkBtn) checkBtn.disabled = _checkNowBusy;
}

function _channelCardHTML(item) {
  const thumb = item.thumbnail
    ? `/api/thumbnail?url=${encodeURIComponent(item.thumbnail)}`
    : `/api/placeholder_thumb?platform=${item.platform || 'youtube'}`;

  return `
    <div class="watch-card-clickzone">
      <img class="watch-avatar" src="${thumb}" alt=""
           onerror="this.src='/api/placeholder_thumb?platform=${item.platform || 'youtube'}'">
      <div class="watch-channel-info">
        <div class="watch-channel-name">
          ${_esc(item.channel_name || item.channel_url)}
          <span class="watch-new-dot" style="display:${item.has_new ? '' : 'none'};" title="${t('watch_new_video')}"></span>
        </div>
        <div class="watch-channel-meta">
          <span class="platform-badge" style="font-size:0.7rem;padding:2px 7px;">
            <span class="platform-dot" style="background:var(--color-${item.platform || 'youtube'});"></span>
            ${_cap(item.platform || 'youtube')}
          </span>
        </div>
        <span class="watch-card-error" style="display:${item.last_error ? '' : 'none'};font-size:0.72rem;color:var(--red,#ef4444);">${_esc(item.last_error || '')}</span>
      </div>
    </div>
    <div class="watch-card-btns">
      <button class="btn btn-ghost watch-check-now-btn" title="${t('watch_check_now')}" ${_checkNowBusy ? 'disabled' : ''}>
        ${_iconRefresh()}
      </button>
      <button class="btn btn-ghost watch-delete-btn" title="${t('watch_delete')}">
        ${_iconTrash()}
      </button>
    </div>
  `;
}

function _bindChannelCardEvents(card, item) {
  // Click on the main area → open video browser
  card.querySelector('.watch-card-clickzone').addEventListener('click', () => {
    const current = watchlistItems.find(i => i.id === item.id) || item;
    _showVideoBrowser(current);
  });

  // Check now
  card.querySelector('.watch-check-now-btn').addEventListener('click', async e => {
    e.stopPropagation();
    if (_checkNowBusy) return;
    _checkNowBusy = true;
    _refreshAllCheckBtns();
    await fetch('/api/watchlist/check_now', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    });
    // Brief delay then re-enable and refresh
    setTimeout(async () => {
      _checkNowBusy = false;
      _refreshAllCheckBtns();
      await loadWatchlist();
    }, 2500);
  });

  // Delete
  card.querySelector('.watch-delete-btn').addEventListener('click', e => {
    e.stopPropagation();
    window.showConfirm(
      t('watch_confirm_delete_title'),
      t('watch_confirm_delete_msg').replace('{name}', item.channel_name || item.channel_url),
      async () => {
        await fetch('/api/watchlist/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id }),
        });
        loadWatchlist();
      },
      t('watch_delete')
    );
  });
}

function _refreshAllCheckBtns() {
  document.querySelectorAll('.watch-check-now-btn').forEach(btn => {
    btn.disabled = _checkNowBusy;
  });
}

// ── Video browser ─────────────────────────────────────────
let _currentVideos    = [];
let _currentTab       = 'videos';
let _currentChannelUrl = '';
let _renderedCount    = 0;
const CHUNK_SIZE      = 20;
let _intersectionObs  = null;
let _wvbSpinnerInterval = null;

async function _loadChannelVideos(channelUrl, _unused, tab) {
  tab = tab || _currentTab;

  const grid    = document.getElementById('wvb-grid');
  const spinner = document.getElementById('wvb-spinner');
  const empty   = document.getElementById('wvb-empty');

  // Same channel + same tab → nothing to do
  if (channelUrl === _currentChannelUrl && tab === _currentTab && _currentVideos.length) return;

  _currentChannelUrl = channelUrl;
  _currentTab        = tab;
  _currentVideos     = [];
  _renderedCount     = 0;
  if (_intersectionObs) { _intersectionObs.disconnect(); _intersectionObs = null; }
  grid.innerHTML        = '';
  empty.style.display   = 'none';
  spinner.style.display = 'flex';

  const textEl = document.getElementById('wvb-spinner-text');
  const msgs = [t('watch_loading_1'), t('watch_loading_2'), t('watch_loading_3'), t('watch_loading_4')];
  let msgIdx = 0;
  if (textEl) textEl.textContent = msgs[0];
  if (_wvbSpinnerInterval) clearInterval(_wvbSpinnerInterval);
  _wvbSpinnerInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % msgs.length;
    if (textEl) textEl.textContent = msgs[msgIdx];
  }, 1500);

  try {
    const res  = await fetch('/api/watchlist/channel_videos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_url: channelUrl, tab }),
    });
    const data = await res.json();
    spinner.style.display = 'none';

    if (data.error) { empty.textContent = data.error; empty.style.display = ''; return; }

    _currentVideos = data.videos || [];
    if (!_currentVideos.length) {
      empty.textContent   = t('watch_no_videos');
      empty.style.display = '';
      return;
    }
    _renderVideoChunk(grid);
    _setupLazyLoad(grid);

  } catch {
    spinner.style.display = 'none';
    empty.textContent     = t('err_fetch_failed');
    empty.style.display   = '';
  } finally {
    if (_wvbSpinnerInterval) clearInterval(_wvbSpinnerInterval);
  }
}

function _renderVideoChunk(grid) {
  const slice = _currentVideos.slice(_renderedCount, _renderedCount + CHUNK_SIZE);
  slice.forEach((video, index) => {
    const card = _buildVideoCard(video);
    card.style.animationDelay = `${index * 0.05}s`;
    grid.appendChild(card);
  });
  _renderedCount += slice.length;
}

function _setupLazyLoad(grid) {
  if (_renderedCount >= _currentVideos.length) return;

  const sentinel = document.createElement('div');
  sentinel.className = 'wvb-sentinel';
  grid.appendChild(sentinel);

  _intersectionObs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      sentinel.remove();
      _renderVideoChunk(grid);
      if (_renderedCount < _currentVideos.length) _setupLazyLoad(grid);
    }
  }, { rootMargin: '200px' });

  _intersectionObs.observe(sentinel);
}

function _buildVideoCard(video) {
  const card  = document.createElement('div');
  card.className = 'wvb-card';

  const thumb = video.thumbnail
    ? `/api/thumbnail?url=${encodeURIComponent(video.thumbnail)}`
    : '/api/placeholder_thumb?platform=youtube';

  const dateStr = video.upload_date
    ? _formatUploadDate(video.upload_date)
    : '';

  const dur = video.duration ? _formatDuration(video.duration) : '';

  card.innerHTML = `
    <div class="wvb-thumb-wrap">
      <img class="wvb-thumb" src="${thumb}" alt=""
           onerror="this.src='/api/placeholder_thumb?platform=youtube'">
      ${dur ? `<span class="wvb-duration">${dur}</span>` : ''}
    </div>
    <div class="wvb-info">
      <div class="wvb-title">${_esc(video.title)}</div>
      ${dateStr ? `<div class="wvb-date">${dateStr}</div>` : ''}
    </div>
    <button class="btn btn-primary wvb-download-btn" style="width:100%;margin-top:8px;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span data-i18n="watch_download">${t('watch_download')}</span>
    </button>
  `;

  card.querySelector('.wvb-download-btn').addEventListener('click', () => {
    _downloadVideo(video);
  });

  return card;
}

async function _downloadVideo(video) {
  const settings = {};
  try {
    const r = await fetch('/api/settings'); const d = await r.json(); Object.assign(settings, d);
  } catch { /* use defaults */ }

  const quality    = settings.default_quality || 'best';
  const fmt        = settings.default_format  || 'video+audio';
  const audio_only = fmt === 'audio';
  const no_audio   = fmt === 'video';

  await fetch('/api/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url:         video.url,
      title:       video.title,
      thumbnail:   video.thumbnail || '',
      quality,
      audio_only,
      no_audio,
    }),
  });

  if (window.showToast) showToast(t('watch_queued'), 'success');
}

function _setActiveTab(tab) {
  document.querySelectorAll('.wvb-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

// ── Add channel ───────────────────────────────────────────
async function watchAddChannel() {
  const input = document.getElementById('watch-url-input');
  const btn   = document.getElementById('watch-add-btn');
  const url   = input.value.trim();

  if (!url) { if (window.showToast) showToast(t('err_empty_url'), 'error'); return; }

  btn.disabled = true;
  const spanEl = btn.querySelector('span');

  const msgs  = [t('watch_loading_1'), t('watch_loading_2'), t('watch_loading_3'), t('watch_loading_4')];
  let msgIdx  = 0;
  if (spanEl) spanEl.textContent = msgs[0];
  const timer = setInterval(() => { msgIdx = (msgIdx + 1) % msgs.length; if (spanEl) spanEl.textContent = msgs[msgIdx]; }, 2500);

  try {
    const res  = await fetch('/api/watchlist/add', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (res.ok) {
      input.value = '';
      if (window.showToast) showToast(t('watch_added_ok').replace('{name}', data.channel_name || url), 'success');
      loadWatchlist();
    } else {
      const msgMap = {
        'Channel is already in the watch list': t('watch_already_added'),
        'This URL is not a valid channel page.': t('watch_invalid_url'),
      };
      if (window.showToast) showToast(msgMap[data.error] || data.error || t('err_fetch_failed'), 'error');
    }
  } catch { if (window.showToast) showToast(t('err_fetch_failed'), 'error'); }
  finally {
    clearInterval(timer);
    btn.disabled = false;
    if (spanEl) spanEl.textContent = t('btn_add');
  }
}

// ── Nav badge ─────────────────────────────────────────────
function updateWatchBadge() {
  const badge = document.getElementById('watch-badge');
  if (!badge) return;
  const total = watchlistItems.filter(i => i.has_new).length;
  badge.textContent   = total;
  badge.style.display = total ? '' : 'none';
}

// ── Helpers ───────────────────────────────────────────────
function _formatUploadDate(d) {
  if (!d || d.length < 8) return d || '';
  const y = d.slice(0, 4), m = d.slice(4, 6), day = d.slice(6, 8);
  return `${day}/${m}/${y}`;
}

function _formatDuration(secs) {
  if (!secs) return '';
  const s = Math.round(secs);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (h) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${m}:${String(ss).padStart(2,'0')}`;
}

function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _iconRefresh() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`;
}
function _iconTrash() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
}

window.initWatchlist    = initWatchlist;
window.loadWatchlist    = loadWatchlist;
window.updateWatchBadge = updateWatchBadge;

initWatchlist();
