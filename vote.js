/* ═══════════════════════════════════════════════════
   PRESIDENTIAL ANNUAL AWARDS — vote.js
   Wired to mpesa_stk.php for real Safaricom STK Push
═══════════════════════════════════════════════════ */

'use strict';

/* ── STATE ── */
let selectedCandidate = null;
let pendingVoteState  = {};

/* ══════════════════════════════════════
   RENDER — CANDIDATES GRID
══════════════════════════════════════ */
function renderCandidates() {
  const data   = Store.load();
  const tv     = Store.totalVotes(data);
  const sorted = Store.sortedCandidates(data);
  const grid   = document.getElementById('candidates-grid');

  const rankMap = {};
  sorted.forEach((c, i) => { rankMap[c.id] = i + 1; });

  grid.innerHTML = PAA.CANDIDATES.map(c => {
    const votes    = data.votes[c.id] || 0;
    const rank     = rankMap[c.id];
    const isLeader = rank === 1 && votes > 0;

    return `
      <div class="candidate-card" onclick="openPayModal('${c.id}')">
        <div class="card-face">
          <div class="rank-badge ${isLeader ? 'leading' : ''}">
            ${isLeader ? '👑' : '#' + rank}
          </div>
          <div class="candidate-avatar">
            <img src="images/${c.id}.jpg" alt="${c.name}"
                 onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
            <span class="avatar-fallback">${c.initials}</span>
          </div>
          <div class="candidate-name">${c.name}</div>
        </div>
        <div class="card-footer">
          <div class="vote-count-mini">
            <strong>${Fmt.number(votes)}</strong>
            vote${votes !== 1 ? 's' : ''}
          </div>
          <button class="card-vote-btn">Vote Now</button>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('live-total-label').textContent =
    `${Fmt.number(tv)} Vote${tv !== 1 ? 's' : ''} Cast`;
}

/* ══════════════════════════════════════
   RENDER — STANDINGS BARS
══════════════════════════════════════ */
function renderStandings() {
  const data   = Store.load();
  const tv     = Store.totalVotes(data);
  const sorted = Store.sortedCandidates(data);
  const maxV   = Math.max(...PAA.CANDIDATES.map(c => data.votes[c.id] || 0), 1);
  const bars   = document.getElementById('standings-bars');

  bars.innerHTML = sorted.map(c => {
    const votes  = data.votes[c.id] || 0;
    const pct    = tv > 0 ? Math.round((votes / tv) * 100) : 0;
    const barPct = Math.round((votes / maxV) * 100);

    return `
      <div class="bar-row">
        <div class="bar-name">${c.name}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${barPct}%"></div>
        </div>
        <div class="bar-pct">${pct}%</div>
        <div class="bar-votes">${Fmt.number(votes)} v</div>
      </div>
    `;
  }).join('');
}

/* ══════════════════════════════════════
   STEP NAVIGATION
══════════════════════════════════════ */
function showStep(step) {
  document.getElementById('step-form').style.display    = step === 'form'    ? '' : 'none';
  document.getElementById('step-stk').style.display     = step === 'stk'     ? '' : 'none';
  document.getElementById('step-success').style.display = step === 'success' ? '' : 'none';
}

function setProgressStep(n) {
  [1, 2, 3].forEach(i => {
    const dot  = document.getElementById(`ps${i}`);
    const line = document.getElementById(`ps-line${i}`);
    if (!dot) return;
    dot.classList.remove('active', 'done');
    if (i < n)        { dot.classList.add('done');   dot.textContent = '✓'; }
    else if (i === n) { dot.classList.add('active'); dot.textContent = String(i); }
    else              { dot.textContent = String(i); }
    if (line) line.classList.toggle('done', i < n);
  });
}

/* ══════════════════════════════════════
   MODAL — OPEN / CLOSE
══════════════════════════════════════ */
function openPayModal(candidateId) {
  selectedCandidate = PAA.CANDIDATES.find(c => c.id === candidateId);
  if (!selectedCandidate) return;

  // Stop any running timers from a previous attempt
  stopAll();
  pendingVoteState = {};

  // Reset UI to Step 1
  showStep('form');
  setProgressStep(1);

  document.getElementById('modal-candidate-name').textContent = selectedCandidate.name;
  document.getElementById('mpesa-acc-display').textContent    = selectedCandidate.name;
  document.getElementById('voter-phone').value  = '';
  document.getElementById('voter-name').value   = '';
  document.getElementById('vote-amount').value  = '20';
  document.getElementById('mpesa-code').value   = '';
  document.getElementById('preview-count').textContent = '—';
  document.getElementById('manual-confirm-section').style.display = 'none';

  document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
  updateVotePreview();
  resetPayBtn();

  document.getElementById('pay-modal').classList.add('open');
  setTimeout(() => document.getElementById('voter-phone').focus(), 300);
}

function closePayModal() {
  stopAll();
  document.getElementById('pay-modal').classList.remove('open');
  selectedCandidate = null;
  pendingVoteState  = {};
}

/* ══════════════════════════════════════
   AMOUNT → VOTE PREVIEW
══════════════════════════════════════ */
function updateVotePreview() {
  const raw    = parseInt(document.getElementById('vote-amount').value, 10);
  const amount = isNaN(raw) || raw < PAA.VOTE_COST ? 0 : raw;
  const votes  = Math.floor(amount / PAA.VOTE_COST);

  const preview = document.getElementById('vote-preview');
  const count   = document.getElementById('preview-count');
  const payLbl  = document.getElementById('pay-btn-label');

  if (votes > 0) {
    count.textContent  = votes;
    count.className    = 'preview-count active';
    preview.className  = 'vote-preview has-votes';
    if (payLbl) payLbl.textContent = `Send M-Pesa Prompt — KES ${amount} (${votes} vote${votes > 1 ? 's' : ''})`;
  } else {
    count.textContent  = '—';
    count.className    = 'preview-count';
    preview.className  = 'vote-preview';
    if (payLbl) payLbl.textContent = 'Enter a valid amount';
  }
}

function setAmount(amount) {
  document.getElementById('vote-amount').value = amount;
  updateVotePreview();
  document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

/* ══════════════════════════════════════
   VALIDATE FORM
══════════════════════════════════════ */
function formatPhone(raw) {
  let p = raw.replace(/[\s\-\(\)]/g, '');
  if (p.startsWith('0'))  p = '254' + p.slice(1);
  if (p.startsWith('+'))  p = p.slice(1);
  return /^254(7|1)\d{8}$/.test(p) ? p : null;
}

function validateForm() {
  const rawPhone = document.getElementById('voter-phone').value.trim();
  const amount   = parseInt(document.getElementById('vote-amount').value, 10);
  const name     = document.getElementById('voter-name').value.trim();

  if (!formatPhone(rawPhone)) {
    Toast.show('Enter a valid Safaricom number (07XX or 01XX)', '⚠️');
    document.getElementById('voter-phone').focus();
    return false;
  }
  if (!amount || amount < PAA.VOTE_COST) {
    Toast.show(`Minimum amount is KES ${PAA.VOTE_COST} (1 vote).`, '⚠️');
    document.getElementById('vote-amount').focus();
    return false;
  }
  if (amount % PAA.VOTE_COST !== 0) {
    Toast.show(`Amount must be a multiple of KES ${PAA.VOTE_COST}. e.g. 20, 40, 100…`, '⚠️');
    document.getElementById('vote-amount').focus();
    return false;
  }
  if (name.length < 2) {
    Toast.show('Please enter your full name to proceed.', '⚠️');
    document.getElementById('voter-name').focus();
    return false;
  }
  return true;
}

/* ══════════════════════════════════════
   PAY BUTTON — fires real STK Push
══════════════════════════════════════ */
async function submitVote() {
  if (!validateForm() || !selectedCandidate) return;

  const rawPhone  = document.getElementById('voter-phone').value.trim();
  const phone     = formatPhone(rawPhone);
  const amount    = parseInt(document.getElementById('vote-amount').value, 10);
  const voterName = document.getElementById('voter-name').value.trim();
  const votes     = Math.floor(amount / PAA.VOTE_COST);

  // Lock button & show spinner
  const btn = document.getElementById('pay-btn');
  btn.disabled  = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Sending prompt…';

  // ── Call mpesa_stk.php ───────────────────────────────────
  let stkResult;
  try {
    const resp = await fetch('mpesa_stk.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:        'stk_push',          // ← always send action
        phone,
        amount,
        candidateId:   selectedCandidate.id,
        candidateName: selectedCandidate.name,
        voterName,
        votes,
      }),
    });

    // Guard: if server returned HTML (404/500) instead of JSON, catch cleanly
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await resp.text();
      console.error('mpesa_stk.php returned non-JSON:', text.slice(0, 300));
      stkResult = {
        success: false,
        message: `Server error (HTTP ${resp.status}). Make sure mpesa_stk.php is on the server.`,
      };
    } else {
      stkResult = await resp.json();
    }

  } catch (networkErr) {
    console.error('Network error:', networkErr);
    stkResult = { success: false, message: 'Network error — check your connection and try again.' };
  }

  // ── STK initiation failed ────────────────────────────────
  if (!stkResult.success) {
    Toast.show('❌ ' + (stkResult.message || 'Could not send M-Pesa prompt.'), '❌');
    resetPayBtn();
    return;
  }

  // ── STK sent! Save pending state ─────────────────────────
  pendingVoteState = {
    checkoutRequestId: stkResult.checkoutRequestId,
    phone:    rawPhone,
    amount,
    votes,
    voterName,
    candidateId:   selectedCandidate.id,
    candidateName: selectedCandidate.name,
  };

  // ── Move to Step 2 ───────────────────────────────────────
  showStep('stk');
  setProgressStep(2);

  document.getElementById('stk-phone-display').textContent = rawPhone;
  document.getElementById('stk-vote-summary').textContent  =
    `KES ${amount} · ${votes} vote${votes !== 1 ? 's' : ''} for ${selectedCandidate.name}`;

  // ── Poll for payment confirmation every 3s ───────────────
  // FIX: was incorrectly calling 'mpesa_poll.php' — now uses mpesa_stk.php with action:'poll'
  startPolling(stkResult.checkoutRequestId);

  // ── Countdown timer ──────────────────────────────────────
  startCountdown();
}

/* ══════════════════════════════════════
   POLLING — checks payment status
   FIX: was fetching 'mpesa_poll.php' (wrong file, caused 404)
        now fetches 'mpesa_stk.php' with action:'poll'
══════════════════════════════════════ */
let _pollTimer     = null;
let _cdownTimer    = null;
let _secondsLeft   = 120;

function startPolling(checkoutRequestId) {
  stopPolling();
  _pollTimer = setInterval(async () => {
    try {
      const resp = await fetch('mpesa_stk.php', {          // ← FIXED: was 'mpesa_poll.php'
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'poll',                                   // ← FIXED: action was missing
          checkoutRequestId,
        }),
      });

      const ct = resp.headers.get('content-type') || '';
      if (!ct.includes('application/json')) return;        // silent — keep polling

      const data = await resp.json();

      if (data.status === 'COMPLETED') {
        stopAll();
        onPaymentSuccess(data.mpesaCode || 'CONFIRMED');
      } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
        stopAll();
        onPaymentFailed(data.status);
      }
      // PENDING → keep polling
    } catch (e) {
      // network hiccup — keep trying silently
    }
  }, 3000);
}

function stopPolling() {
  clearInterval(_pollTimer);
  _pollTimer = null;
}

/* ══════════════════════════════════════
   COUNTDOWN TIMER
══════════════════════════════════════ */
function startCountdown() {
  _secondsLeft = 120;
  stopCountdown();

  const el = document.getElementById('stk-countdown');
  const mc = document.getElementById('manual-confirm-section');
  if (el) el.textContent = _secondsLeft;
  if (mc) mc.style.display = 'none';

  _cdownTimer = setInterval(() => {
    _secondsLeft--;
    if (el) el.textContent = _secondsLeft;

    // Show manual code entry after 30s
    if (_secondsLeft === 30 && mc) mc.style.display = '';

    if (_secondsLeft <= 0) {
      stopAll();
      Toast.show('⏱ Prompt expired — please try again.', '⏱');
      showStep('form');
      setProgressStep(1);
      resetPayBtn();
    }
  }, 1000);
}

function stopCountdown() {
  clearInterval(_cdownTimer);
  _cdownTimer = null;
}

function stopAll() {
  stopPolling();
  stopCountdown();
}

/* ══════════════════════════════════════
   SUCCESS / FAILURE HANDLERS
══════════════════════════════════════ */
function onPaymentSuccess(mpesaCode) {
  const s = pendingVoteState;

  // Record vote locally (localStorage)
  Store.recordVote(s.voterName, s.candidateId, s.amount, mpesaCode);

  // Fill success details
  document.getElementById('s-candidate').textContent = s.candidateName;
  document.getElementById('s-votes').textContent     = `+${s.votes} vote${s.votes !== 1 ? 's' : ''}`;
  document.getElementById('s-amount').textContent    = `KES ${s.amount}`;
  document.getElementById('s-code').textContent      = mpesaCode || '—';
  document.getElementById('s-voter').textContent     = s.voterName;

  showStep('success');
  setProgressStep(3);

  renderCandidates();
  renderStandings();

  Toast.show(`🎉 ${s.votes} vote${s.votes !== 1 ? 's' : ''} for ${s.candidateName} confirmed!`, '✅');
}

function onPaymentFailed(status) {
  const msg = status === 'CANCELLED'
    ? 'You cancelled the M-Pesa request.'
    : 'Payment was not completed. Please try again.';
  Toast.show('❌ ' + msg, '❌');
  showStep('form');
  setProgressStep(1);
  resetPayBtn();
}

/* ══════════════════════════════════════
   MANUAL CODE CONFIRMATION (fallback)
══════════════════════════════════════ */
async function submitManualCode() {
  const code = document.getElementById('mpesa-code').value.trim().toUpperCase();
  if (code.length < 8) {
    Toast.show('Enter a valid M-Pesa code (e.g. QJK7XXXXXX)', '⚠️');
    return;
  }

  const btn = document.getElementById('manual-confirm-btn');
  btn.disabled    = true;
  btn.textContent = 'Verifying…';

  let res;
  try {
    const resp = await fetch('mpesa_stk.php', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action:            'manual_confirm',
        mpesaCode:         code,
        checkoutRequestId: pendingVoteState.checkoutRequestId,
        candidateId:       pendingVoteState.candidateId,
        candidateName:     pendingVoteState.candidateName,
        votes:             pendingVoteState.votes,
        amount:            pendingVoteState.amount,
        voterName:         pendingVoteState.voterName,
        phone:             formatPhone(pendingVoteState.phone) || pendingVoteState.phone,
      }),
    });
    const ct = resp.headers.get('content-type') || '';
    res = ct.includes('application/json')
      ? await resp.json()
      : { success: false, message: 'Server error verifying code.' };
  } catch (e) {
    res = { success: false, message: 'Network error. Please try again.' };
  }

  if (res.success) {
    stopAll();
    onPaymentSuccess(code);
  } else {
    Toast.show('❌ ' + (res.message || 'Could not verify code. Try again.'), '❌');
    btn.disabled    = false;
    btn.textContent = 'Confirm with M-Pesa Code';
  }
}

/* ══════════════════════════════════════
   RESET PAY BUTTON
══════════════════════════════════════ */
function resetPayBtn() {
  const btn = document.getElementById('pay-btn');
  btn.disabled  = false;
  btn.innerHTML = '<span>📲</span> <span id="pay-btn-label">Send M-Pesa Prompt — KES 20</span>';
  updateVotePreview();
}

/* ══════════════════════════════════════
   EVENT LISTENERS
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  renderCandidates();
  renderStandings();

  document.getElementById('vote-amount')
    .addEventListener('input', updateVotePreview);

  document.getElementById('pay-btn')
    .addEventListener('click', submitVote);

  document.getElementById('cancel-stk-btn')
    .addEventListener('click', () => {
      stopAll();
      showStep('form');
      setProgressStep(1);
      resetPayBtn();
    });

  document.getElementById('manual-confirm-btn')
    .addEventListener('click', submitManualCode);

  document.getElementById('success-close-btn')
    .addEventListener('click', () => {
      closePayModal();
      document.getElementById('standings-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

  document.getElementById('modal-close-btn')
    .addEventListener('click', closePayModal);

  document.getElementById('pay-modal')
    .addEventListener('click', e => {
      if (e.target === document.getElementById('pay-modal')) closePayModal();
    });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePayModal();
  });

  // Auto-refresh every 6s
  setInterval(() => {
    renderCandidates();
    renderStandings();
  }, 6000);
});
