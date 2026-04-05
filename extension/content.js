(function() {
'use strict';

var SERVER = 'http://localhost:5000';

// ── Platform detection (domain only) ──────────────────────
var PLATFORM_MAP = [
  { domains: ['youtube.com', 'youtu.be'], id: 'youtube'    },
  { domains: ['tiktok.com'],              id: 'tiktok'     },
  { domains: ['instagram.com'],           id: 'instagram'  },
  { domains: ['facebook.com','fb.watch'], id: 'facebook'   },
  { domains: ['twitter.com','x.com'],     id: 'twitter'    },
  { domains: ['pinterest.com','pin.it'],  id: 'pinterest'  },
  { domains: ['twitch.tv'],              id: 'twitch'     },
  { domains: ['soundcloud.com'],          id: 'soundcloud' },
];

function detectPlatform(host) {
  host = (host || location.hostname).replace('www.', '');
  for (var i = 0; i < PLATFORM_MAP.length; i++) {
    var entry = PLATFORM_MAP[i];
    for (var j = 0; j < entry.domains.length; j++) {
      if (host.indexOf(entry.domains[j]) !== -1) return entry.id;
    }
  }
  return null;
}

// ── Should the button show on this specific page? ─────────
// Hides button on home/feed/profile listing pages
function isVideoPage(platform) {
  var path = location.pathname;
  var href = location.href;
  switch (platform) {
    case 'youtube':
      return href.indexOf('/watch?v=') !== -1 || href.indexOf('/shorts/') !== -1 || location.hostname === 'youtu.be';
    case 'tiktok':
      return /\/@[^/]+\/video\//.test(path);
    case 'instagram':
      return /\/(reel|reels|p)\/[^/]/.test(path);
    case 'facebook':
      if (location.hostname.indexOf('fb.watch') !== -1) return true;
      return /\/(watch|reel|videos?)\//.test(path) || /\/share\/(r|v)\//.test(path);
    case 'twitter':
      return /\/status\/\d/.test(path);
    case 'pinterest':
      return /\/pin\/\d/.test(path);
    case 'twitch':
      return /\/videos\/\d/.test(path) || /\/clip\//.test(path) || (path.length > 2 && path.indexOf('/directory') === -1 && path.indexOf('/following') === -1 && path.split('/').length === 2);
    case 'soundcloud':
      return (path.match(/\//g) || []).length >= 2;
    default:
      return false;
  }
}

var platform = detectPlatform();

// Always listen for popup messages
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'GET_PAGE_INFO') {
    sendResponse({
      url:      location.href,
      platform: isVideoPage(platform) ? platform : null,
      title:    document.title,
    });
  }
  return true;
});

// Don't inject if not on a supported platform at all
if (!platform) return;

// ── Inject button ──────────────────────────────────────────
var style = document.createElement('style');
style.textContent = [
  '#grabbit-btn{position:fixed;bottom:28px;right:20px;z-index:2147483647;font-family:-apple-system,sans-serif;user-select:none}',
  '#grabbit-inner{display:flex;align-items:center;gap:7px;background:#5b6ef5;color:#fff;padding:10px 16px;border-radius:99px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 20px rgba(91,110,245,.45);transition:all .25s ease}',
  '#grabbit-inner:hover{background:#4558f0;transform:translateY(-2px) scale(1.03);box-shadow:0 6px 24px rgba(91,110,245,.55)}',
  '#grabbit-inner:active{transform:translateY(0) scale(.98)}',
  '#grabbit-inner.dim{background:rgba(91,110,245,.45);cursor:default;box-shadow:none}',
  '#grabbit-inner svg{width:16px;height:16px;flex-shrink:0}',
  '#grabbit-inner.success{background:#22c55e;box-shadow:0 4px 20px rgba(34,197,94,.4)}',
  '#grabbit-inner.error{background:#ef4444;box-shadow:0 4px 20px rgba(239,68,68,.4)}',
  '#grabbit-inner.loading{background:#6b7280;cursor:not-allowed}',
  '#grabbit-spinner{animation:gbspin .7s linear infinite}',
  '@keyframes gbspin{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
  '#grabbit-toast{position:absolute;bottom:calc(100% + 8px);right:0;background:#1e293b;color:#e2e8f8;font-size:12px;font-weight:500;padding:6px 12px;border-radius:8px;white-space:nowrap;opacity:0;transform:translateY(4px);transition:all .2s ease;pointer-events:none;border:1px solid rgba(255,255,255,.08);box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:240px;white-space:normal;text-align:right}',
  '#grabbit-toast.visible{opacity:1;transform:translateY(0)}'
].join('');
document.head.appendChild(style);

var container = document.createElement('div');
container.id = 'grabbit-btn';

var inner = document.createElement('div');
inner.id = 'grabbit-inner';
inner.innerHTML = [
  '<svg id="grabbit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  '<svg id="grabbit-check" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  '<svg id="grabbit-spinner" style="display:none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>',
  '<span id="grabbit-label">Grab</span>'
].join('');

var toast = document.createElement('div');
toast.id = 'grabbit-toast';
container.appendChild(inner);
container.appendChild(toast);
document.body.appendChild(container);

// ── State helpers ──────────────────────────────────────────
var toastTimeout;

function setState(cls, icon, spin, check, label) {
  inner.className = cls || '';
  document.getElementById('grabbit-icon').style.display    = icon  ? 'block' : 'none';
  document.getElementById('grabbit-spinner').style.display = spin  ? 'block' : 'none';
  document.getElementById('grabbit-check').style.display   = check ? 'block' : 'none';
  document.getElementById('grabbit-label').textContent     = label;
}

function showToast(msg) {
  clearTimeout(toastTimeout);
  toast.textContent = msg;
  toast.classList.add('visible');
  toastTimeout = setTimeout(function() { toast.classList.remove('visible'); }, 3500);
}

function reset() { setState('', true, false, false, 'Grab'); }

// ── Update button state based on current URL ───────────────
function updateButtonForPage() {
  var onVideo = isVideoPage(platform);
  if (onVideo) {
    setState('', true, false, false, 'Grab');
  } else {
    setState('dim', true, false, false, 'Grab');
    showToast('Navigate to a specific video to download');
  }
}

// Initial state
updateButtonForPage();

// ── SPA navigation (YouTube, TikTok, etc.) ────────────────
var lastUrl = location.href;
setInterval(function() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    updateButtonForPage();
  }
}, 800);

// ── Click ──────────────────────────────────────────────────
inner.addEventListener('click', function() {
  if (inner.classList.contains('loading')) return;

  if (!isVideoPage(platform)) {
    showToast('Open a specific video first, then click Grab');
    return;
  }

  setState('loading', false, true, false, 'Grabbing...');

  // Fetch settings first — gets save_folder AND license_code from server
  fetch(SERVER + '/api/settings')
    .then(function(r) { return r.json(); })
    .then(function(settings) {
      var saveFolder  = settings.save_folder  || '';
      var licCode     = settings.license_code || '';

      return fetch(SERVER + '/api/limits/status?license=' + encodeURIComponent(licCode))
        .then(function(r) { return r.json(); })
        .then(function(limits) {
          if (!limits.allowed) {
            setState('error', true, false, false, 'Failed');
            showToast('Daily limit reached (' + limits.limit + '/day). Upgrade to Pro.');
            setTimeout(reset, 3500);
            return Promise.reject('limit');
          }

          return fetch(SERVER + '/api/download', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url:         location.href,
              item_id:     'ext_' + Date.now(),
              title:       document.title || location.href,
              platform:    platform,
              quality:     'best',
              audio_only:  false,
              no_audio:    false,
              start_time:  '',
              end_time:    '',
              save_folder: saveFolder
            })
          }).then(function(res) {
            if (!res.ok) throw new Error('Server error ' + res.status);
            return res.json();
          }).then(function(data) {
            if (data.error) throw new Error(data.error);
            // Re-check status to show accurate remaining count
            return fetch(SERVER + '/api/limits/status?license=' + encodeURIComponent(licCode))
              .then(function(r) { return r.json(); })
              .then(function(lim) {
                var rem = lim.is_pro
                  ? ' \u00b7 Pro \u2014 Unlimited'
                  : ' \u00b7 ' + lim.remaining + ' left today';
                setState('success', false, false, true, 'Done!');
                showToast('Added to queue \u2713' + rem);
                setTimeout(reset, 3000);
              });
          });
        });
    })
    .catch(function(e) {
      if (e === 'limit') return; // already handled
      var msg = (!e || !e.message || e.message === 'Failed to fetch')
        ? 'Grabbit is not running. Open the app first.'
        : e.message;
      setState('error', true, false, false, 'Failed');
      showToast(msg);
      setTimeout(reset, 3500);
    });
});

}());