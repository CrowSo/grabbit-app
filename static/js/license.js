/* ============================================================
   GRABBIT — license.js
   License activation, display, and management via Supabase
   ============================================================ */

const licenseInput  = document.getElementById('license-input');
const activateBtn   = document.getElementById('activate-btn');
const activateMsg   = document.getElementById('activate-msg');
const licensePill   = document.getElementById('license-pill');
const LANDING_URL   = 'https://appgrabbit.com';

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

// ── Load saved license on start ────────────────────────────
const savedCode = localStorage.getItem('grabbit-license');
if (savedCode) {
  verifyAndDisplay(savedCode, false);
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
  daysEl.style.color = days <= 5 ? '#ef4444' : days <= 10 ? '#f59e0b' : '#22c55e';

  document.getElementById('license-details-card').style.display = 'block';
  document.getElementById('activate-card').style.display        = 'none';

  document.getElementById('lic-email').textContent   = data.email   || '—';
  document.getElementById('lic-code').textContent    = code;
  document.getElementById('lic-plan').textContent    = (data.plan   || 'pro').toUpperCase();
  document.getElementById('lic-days').textContent    = `${days} days`;
  document.getElementById('lic-days').style.color    = days <= 5 ? '#ef4444' : days <= 10 ? '#f59e0b' : '#22c55e';
  document.getElementById('lic-created').textContent = data.created_at
    ? new Date(data.created_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
    : '—';
  document.getElementById('lic-renewed').textContent = data.last_renewed_at
    ? new Date(data.last_renewed_at).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
    : '—';

  const pct = Math.max(0, Math.min(100, (days / 30) * 100));
  document.getElementById('lic-bar').style.width       = `${pct}%`;
  document.getElementById('lic-bar').style.background  = days <= 5 ? '#ef4444' : days <= 10 ? '#f59e0b' : 'var(--accent)';
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
    renewBtn.style.background  = 'rgba(245,158,11,0.12)';
    renewBtn.style.color       = '#f59e0b';
    renewBtn.style.border      = '1px solid rgba(245,158,11,0.3)';
    renewBtn.textContent       = `⚠ ${days} days left — Renew now`;
  }

  if (showMsg) showMessage('✓ License activated successfully', 'success');

  fetch('/api/limits/reset', { method: 'POST' });
  if (window.syncDailyCounter) syncDailyCounter();
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

// ── Renew → open landing page ──────────────────────────────
document.getElementById('renew-btn')?.addEventListener('click', () => {
  window.open(LANDING_URL + '/renew', '_blank');
});

// ── Get Pro → open landing page ────────────────────────────
document.getElementById('get-pro-btn')?.addEventListener('click', () => {
  window.open(LANDING_URL, '_blank');
});

// ── Message helper ─────────────────────────────────────────
function showMessage(msg, type) {
  if (!activateMsg) return;
  activateMsg.textContent  = msg;
  activateMsg.style.display = 'block';
  activateMsg.style.color   = type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : 'var(--text-muted)';
  setTimeout(() => { activateMsg.style.display = 'none'; }, 6000);
}