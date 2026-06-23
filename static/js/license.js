/* ============================================================
   GRABBIT — license.js
   License activation, display, and management via Supabase
   ============================================================ */

const licenseInput  = document.getElementById('license-input');
const activateBtn   = document.getElementById('activate-btn');
const activateMsg   = document.getElementById('activate-msg');
const licensePill   = document.getElementById('license-pill');
const STRIPE_MONTHLY_LINK = 'https://buy.stripe.com/bJe5kF55Bgmi92O5fm0x201';
const STRIPE_ANNUAL_LINK  = 'https://buy.stripe.com/8x200l9lR6LIfrcfU00x200';

// ── Format input ───────────────────────────────────────────
licenseInput?.addEventListener('input', () => {
  let val   = licenseInput.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const parts = [];
  if (val.length > 0)  parts.push(val.substring(0, 4));
  if (val.length > 4)  parts.push(val.substring(4, 8));
  if (val.length > 8)  parts.push(val.substring(8, 12));
  if (val.length > 12) parts.push(val.substring(12, 16));
  licenseInput.value = parts.join('-');
});

// ── Load saved license on start ─────────────────────────────
const savedCode = localStorage.getItem('grabbit-license');
if (savedCode) {
  verifyAndDisplay(savedCode, false);
} else {
  loadFreeUsage();
}

// ── Free plan: show usage counters ────────────────────────
async function loadFreeUsage() {
  try {
    const res  = await fetch('/api/limits/status');
    const data = await res.json();
    if (data.is_pro) return;

    const su = data.singles_used     ?? 0;
    const bu = data.batches_used     ?? 0;
    const tu = data.transcripts_used ?? 0;
    const sl = data.limits.single;
    const bl = data.limits.batch;
    const tl = data.limits.transcript;

    // Status bar
    document.getElementById('license-status').className         = 'license-status inactive';
    document.getElementById('license-icon').className           = 'license-icon inactive';
    document.getElementById('license-status-title').textContent = 'Free plan';
    document.getElementById('license-status-sub').textContent   =
      `${Math.max(0, sl - su)} downloads · ${Math.max(0, bl - bu)} batch · ${Math.max(0, tl - tu)} transcripts remaining`;
    document.getElementById('license-days-wrap').style.display  = 'none';

    // Show free usage card
    const card = document.getElementById('free-usage-card');
    if (card) card.style.display = 'block';

    // Singles
    const singlesExhausted = su >= sl;
    document.getElementById('fu-singles-label').textContent  = `${su} / ${sl} used`;
    document.getElementById('fu-singles-label').style.color  = singlesExhausted ? 'var(--red)' : 'var(--secondary)';
    document.getElementById('fu-singles-bar').style.width    = `${Math.min(100, (su / sl) * 100)}%`;
    document.getElementById('fu-singles-bar').style.background = singlesExhausted ? 'var(--red)' : 'var(--secondary)';

    // Batch
    const batchExhausted = bu >= bl;
    document.getElementById('fu-batch-label').textContent    = `${bu} / ${bl} used`;
    document.getElementById('fu-batch-label').style.color    = batchExhausted ? 'var(--red)' : 'var(--secondary)';
    document.getElementById('fu-batch-bar').style.width      = `${Math.min(100, (bu / bl) * 100)}%`;
    document.getElementById('fu-batch-bar').style.background = batchExhausted ? 'var(--red)' : 'var(--secondary)';

    // Transcripts
    const transExhausted = tu >= tl;
    document.getElementById('fu-transcripts-label').textContent  = `${tu} / ${tl} used`;
    document.getElementById('fu-transcripts-label').style.color  = transExhausted ? 'var(--red)' : 'var(--secondary)';
    document.getElementById('fu-transcripts-bar').style.width    = `${Math.min(100, (tu / tl) * 100)}%`;
    document.getElementById('fu-transcripts-bar').style.background = transExhausted ? 'var(--red)' : 'var(--secondary)';

  } catch { /* keep default */ }
}

// ── Activate button ────────────────────────────────────────
activateBtn?.addEventListener('click', async () => {
  const code = licenseInput.value.trim();
  if (!code) return;
  await verifyAndDisplay(code, true);
});

// ── Verify against Supabase via app.py ────────────────────
async function verifyAndDisplay(code, showMsg) {
  if (activateBtn) {
    activateBtn.disabled    = true;
    activateBtn.textContent = 'Checking...';
  }

  try {
    const res  = await fetch('/api/license/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code }),
    });
    const data = await res.json();

    if (data.valid) {
      localStorage.setItem('grabbit-license', code);
      localStorage.setItem('grabbit-license-data', JSON.stringify(data));
      setLicenseActive(code, data, showMsg);
    } else {
      setLicenseInactive();
      if (showMsg) showMessage(
        data.error === 'License expired'
          ? `License expired. It had ${data.days_left || 0} days left. Renew to continue using Pro.`
          : data.error || 'Invalid license key.',
        'error'
      );
    }
  } catch {
    // Network error — load from cache if available
    const cached = localStorage.getItem('grabbit-license-data');
    if (cached) {
      const data = JSON.parse(cached);
      setLicenseActive(code, data, false);
    } else {
      if (showMsg) showMessage('Could not reach license server. Check your connection.', 'error');
    }
  } finally {
    if (activateBtn) {
      activateBtn.disabled    = false;
      activateBtn.textContent = 'Activate';
    }
  }
}

// ── Show active license info ───────────────────────────────
function setLicenseActive(code, data, showMsg) {
  const days = data.days_left || 0;

  document.getElementById('license-status').className         = 'license-status active';
  document.getElementById('license-icon').className           = 'license-icon active';
  document.getElementById('license-status-title').textContent = 'Pro plan — Active';
  document.getElementById('license-status-sub').textContent   = `${days} days remaining`;
  document.getElementById('license-days-wrap').style.display  = 'block';
  document.getElementById('license-days-num').textContent     = days;

  const daysEl = document.getElementById('license-days-num');
  daysEl.style.color = days <= 5 ? 'var(--red)' : days <= 10 ? 'var(--orange, #f59e0b)' : 'var(--green)';

  document.getElementById('license-details-card').style.display = 'block';
  document.getElementById('activate-card').style.display        = 'none';
  const fuc = document.getElementById('free-usage-card');
  if (fuc) fuc.style.display = 'none';

  document.getElementById('lic-email').textContent   = data.email   || '—';
  _licCodeReal    = code;
  _licCodeVisible = false;
  document.getElementById('lic-code').textContent    = '••••-••••-••••-••••';
  document.getElementById('lic-plan').textContent    = (data.plan   || 'pro').toUpperCase();
  document.getElementById('lic-days').textContent    = `${days} days`;
  document.getElementById('lic-days').style.color    = days <= 5 ? 'var(--red)' : days <= 10 ? 'var(--orange, #f59e0b)' : 'var(--green)';
  document.getElementById('lic-created').textContent = data.created_at
    ? new Date(data.created_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
    : '—';
  document.getElementById('lic-renewed').textContent = data.last_renewed_at
    ? new Date(data.last_renewed_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
    : '—';

  const pct = Math.max(0, Math.min(100, (days / 30) * 100));
  document.getElementById('lic-bar').style.width       = `${pct}%`;
  document.getElementById('lic-bar').style.background  = days <= 5 ? 'var(--red)' : days <= 10 ? 'var(--orange, #f59e0b)' : 'var(--secondary)';
  document.getElementById('lic-bar-label').textContent = `${days} of 30 days`;

  licensePill.className   = 'status-pill done';
  licensePill.textContent = 'Pro';

  // Disable "Get Pro" buttons since user already has Pro
  document.querySelectorAll('.get-pro-btn').forEach(btn => {
    btn.textContent       = '✓ You have Pro';
    btn.style.opacity     = '0.5';
    btn.style.pointerEvents = 'none';
    btn.style.cursor      = 'default';
  });

  // Warn if renewal is close
  const renewBtn = document.getElementById('renew-btn');
  if (renewBtn && days <= 7) {
    renewBtn.style.background  = 'var(--button-elevated)';
    renewBtn.style.color       = 'var(--orange, #f59e0b)';
    renewBtn.style.border      = '1px solid rgba(245,158,11,0.3)';
    renewBtn.textContent       = `⚠ ${days} days left — Renew now`;
  }

  if (showMsg) showMessage('✓ License activated successfully', 'success');

  if (window.syncDailyCounter) window.syncDailyCounter();
}

// ── Show inactive / free state ─────────────────────────────
function setLicenseInactive() {
  localStorage.removeItem('grabbit-license');
  localStorage.removeItem('grabbit-license-data');

  document.getElementById('license-status').className         = 'license-status inactive';
  document.getElementById('license-icon').className           = 'license-icon inactive';
  document.getElementById('license-status-title').textContent = 'Free plan';
  document.getElementById('license-status-sub').textContent   = 'Activate a license key to unlock all features';
  document.getElementById('license-days-wrap').style.display  = 'none';
  document.getElementById('license-details-card').style.display = 'none';
  document.getElementById('activate-card').style.display        = 'block';

  licensePill.className   = 'status-pill waiting';
  licensePill.textContent = 'Free';
}

// ── Deactivate (remove from this device) ──────────────────
document.getElementById('deactivate-btn')?.addEventListener('click', () => {
  window.showConfirm(
    'Remove license?',
    'This removes the license from this device. You can re-activate it anytime with your code.',
    () => {
      fetch('/api/license/deactivate', { method: 'POST' });
      setLicenseInactive();
      showMessage('License removed from this device.', 'info');
    },
    'Remove'
  );
});

// ── License code show/hide ────────────────────────────────
let _licCodeReal = '';
let _licCodeVisible = false;

window.toggleLicCode = function() {
  _licCodeVisible = !_licCodeVisible;
  const el   = document.getElementById('lic-code');
  const icon = document.getElementById('lic-eye-icon');
  if (!el) return;

  if (_licCodeVisible) {
    el.textContent = _licCodeReal || '—';
    icon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`;
  } else {
    el.textContent = '••••-••••-••••-••••';
    icon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  }
};

// ── Renew → open Stripe checkout ──────────────────────────
const STRIPE_MONTHLY_URL = 'https://buy.stripe.com/bJe5kF55Bgmi92O5fm0x201';
document.getElementById('renew-btn')?.addEventListener('click', () => {
  window.open(STRIPE_MONTHLY_URL, '_blank');
});

// ── Get Pro → open landing page ────────────────────────────
document.querySelectorAll('#get-pro-btn, .get-pro-monthly').forEach(btn => {
  btn.addEventListener('click', () => window.open(STRIPE_MONTHLY_LINK, '_blank'));
});

document.getElementById('get-pro-annual-btn')?.addEventListener('click', () => {
  window.open(STRIPE_ANNUAL_LINK, '_blank');
});

// ── Message helper ─────────────────────────────────────────
function showMessage(msg, type) {
  if (!activateMsg) return;
  activateMsg.textContent  = msg;
  activateMsg.style.display = 'block';
  activateMsg.style.color   = type === 'success' ? 'var(--green)' : type === 'error' ? 'var(--red)' : 'var(--gray)';
  setTimeout(() => { activateMsg.style.display = 'none'; }, 6000);
}


