/* ═══════════════════════════════════════════════════
   PRESIDENTIAL ANNUAL AWARDS — vote.js
   Logic for the public voting page (vote.html / index.html)
═══════════════════════════════════════════════════ */

'use strict';

/* ── STATE ── */
let selectedCandidate  = null;
let pendingVoteState   = {};   // holds data across the 3 modal steps

/* ══════════════════════════════════════
   RENDER — CANDIDATES GRID
══════════════════════════════════════ */
function renderCandidates() {
  const data    = Store.load();
  const tv      = Store.totalVotes(data);
  const sorted  = Store.sortedCandidates(data);
  const grid    = document.getElementById('candidates-grid');

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
   STEP HELPERS
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
    else if (i === n) { dot.classList.add('active'); dot.textContent = i; }
    else              { dot.textContent = i; }
    if (line) line.classList.toggle('done', i < n);
  });
}

/* ══════════════════════════════════════
   MODAL — OPEN / CLOSE
══════════════════════════════════════ */
function openPayModal(candidateId) {
  selectedCandidate = PAA.CANDIDATES.find(c => c.id === candidateId);
  if (!selectedCandidate) return;

  MpesaService.stopAll();
  pendingVoteState = {};

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
  MpesaService.stopAll();
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
  const payBtn  = document.getElementById('pay-btn-label');

  if (votes > 0) {
    count.textContent = votes;
    count.className   = 'preview-count active';
    preview.className = 'vote-preview has-votes';
    payBtn.textContent = `Send M-Pesa Prompt — KES ${amount} (${votes} vote${votes > 1 ? 's' : ''})`;
  } else {
    count.textContent  = '—';
    count.className    = 'preview-count';
    preview.className  = 'vote-preview';
    payBtn.textContent = 'Enter a valid amount';
  }
}

function setAmount(amount) {
  document.getElementById('vote-amount').value = amount;
  updateVotePreview();
  document.querySelectorAll('.quick-btn').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

/* ══════════════════════════════════════
   VALIDATION
══════════════════════════════════════ */
function validateForm() {
  const rawPhone = document.getElementById('voter-phone').value.trim();
  const amount   = parseInt(document.getElementById('vote-amount').value, 10);
  const name     = document.getElementById('voter-name').value.trim();

  if (!MpesaService.formatPhone(rawPhone)) {
    Toast.show('Enter a valid Safaricom number (07XX or 01XX)', '⚠️', true);
    document.getElementById('voter-phone').focus();
    return false;
  }
  if (!amount || amount < PAA.VOTE_COST) {
    Toast.show(`Minimum amount is KES ${PAA.VOTE_COST} (1 vote).`, '⚠️', true);
    document.getElementById('vote-amount').focus();
    return false;
  }
  if (amount % PAA.VOTE_COST !== 0) {
    Toast.show(`Amount must be a multiple of KES ${PAA.VOTE_COST}. e.g. 20, 40, 100…`, '⚠️', true);
    document.getElementById('vote-amount').focus();
    return false;
  }
  if (name.length < 2) {
    Toast.show('Please enter your full name to proceed.', '⚠️', true);
    document.getElementById('voter-name').focus();
    return false;
  }
  return true;
}

/* ══════════════════════════════════════
   PAY BUTTON — initiates real STK Push
══════════════════════════════════════ */
async function submitVote() {
  if (!validateForm() || !selectedCandidate) return;

  const rawPhone  = document.getElementById('voter-phone').value.trim();
  const phone     = MpesaService.formatPhone(rawPhone);
  const amount    = parseInt(document.getElementById('vote-amount').value, 10);
  const voterName = document.getElementById('voter-name').value.trim();
  const votes     = Math.floor(amount / PAA.VOTE_COST);

  // Lock button
  const btn = document.getElementById('pay-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-spinner"></span> Sending prompt…';

  let stkResult;
  try {
    stkResult = await MpesaService.initiateStkPush({
      phone,
      amount,
      candidateId:   selectedCandidate.id,
      candidateName: selectedCandidate.name,
      voterName,
      votes,
    });
  } catch (err) {
    stkResult = { success: false, message: 'Network error — check your connection.' };
  }

  if (!stkResult.success) {
    Toast.show('❌ ' + (stkResult.message || 'Could not send M-Pesa prompt.'), '❌', true);
    resetPayBtn();
    return;
  }

  /* ── STK Push sent — save pending state ── */
  pendingVoteState = {
    checkoutRequestId: stkResult.checkoutRequestId,
    phone:    rawPhone,
    amount,
    votes,
    voterName,
    candidateId:   selectedCandidate.id,
    candidateName: selectedCandidate.name,
  };

  /* ── Move to Step 2 ── */
  showStep('stk');
  setProgressStep(2);

  document.getElementById('stk-phone-display').textContent = rawPhone;
  document.getElementById('stk-vote-summary').textContent  =
    `KES ${amount} · ${votes} vote${votes !== 1 ? 's' : ''} for ${selectedCandidate.name}`;

  /* ── Start polling for payment confirmation ── */
  MpesaService.startPolling(
    stkResult.checkoutRequestId,
    (mpesaCode) => onPaymentSuccess(mpesaCode),
    (status)    => onPaymentFailed(status)
  );

  /* ── Start countdown ── */
  MpesaService.startCountdown(
    'stk-countdown',
    document.getElementById('manual-confirm-section'),
    () => {
      Toast.show('⏱ Prompt expired. Please try again.', '⏱', true);
      showStep('form');
      setProgressStep(1);
      resetPayBtn();
    }
  );
}

/* ══════════════════════════════════════
   PAYMENT SUCCESS HANDLER
══════════════════════════════════════ */
function onPaymentSuccess(mpesaCode) {
  const s = pendingVoteState;

  // Record locally
  Store.recordVote(s.voterName, s.candidateId, s.amount, mpesaCode);

  // Fill success screen
  document.getElementById('s-candidate').textContent = s.candidateName;
  document.getElementById('s-votes').textContent     = `+${s.votes} vote${s.votes !== 1 ? 's' : ''}`;
  document.getElementById('s-amount').textContent    = `KES ${s.amount}`;
  document.getElementById('s-code').textContent      = mpesaCode || '—';
  document.getElementById('s-voter').textContent     = s.voterName;

  showStep('success');
  setProgressStep(3);

  renderCandidates();
  renderStandings();

  Toast.show(
    `🎉 ${s.votes} vote${s.votes !== 1 ? 's' : ''} for ${s.candidateName} confirmed!`,
    '✅'
  );
}

/* ══════════════════════════════════════
   PAYMENT FAILED HANDLER
══════════════════════════════════════ */
function onPaymentFailed(status) {
  const msg = status === 'CANCELLED'
    ? 'You cancelled the M-Pesa request.'
    : 'Payment was not completed. Please try again.';
  Toast.show('❌ ' + msg, '❌', true);
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
    Toast.show('Enter a valid M-Pesa transaction code (e.g. QJK7XXXXXX)', '⚠️', true);
    return;
  }

  const btn = document.getElementById('manual-confirm-btn');
  btn.disabled     = true;
  btn.textContent  = 'Verifying…';

  let res;
  try {
    res = await MpesaService.manualConfirm({
      mpesaCode:         code,
      checkoutRequestId: pendingVoteState.checkoutRequestId,
      candidateId:       pendingVoteState.candidateId,
      candidateName:     pendingVoteState.candidateName,
      votes:             pendingVoteState.votes,
      amount:            pendingVoteState.amount,
      voterName:         pendingVoteState.voterName,
      phone:             MpesaService.formatPhone(pendingVoteState.phone) || pendingVoteState.phone,
    });
  } catch (e) {
    res = { success: false, message: 'Network error. Please try again.' };
  }

  if (res.success) {
    MpesaService.stopAll();
    onPaymentSuccess(code);
  } else {
    Toast.show('❌ ' + (res.message || 'Could not verify code. Try again.'), '❌', true);
    btn.disabled    = false;
    btn.textContent = 'Confirm with Code';
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

  // Amount live preview
  document.getElementById('vote-amount').addEventListener('input', updateVotePreview);

  // Pay button
  document.getElementById('pay-btn').addEventListener('click', submitVote);

  // Cancel STK step — go back to form
  document.getElementById('cancel-stk-btn').addEventListener('click', () => {
    MpesaService.stopAll();
    showStep('form');
    setProgressStep(1);
    resetPayBtn();
  });

  // Manual confirm button
  document.getElementById('manual-confirm-btn').addEventListener('click', submitManualCode);

  // Success close
  document.getElementById('success-close-btn').addEventListener('click', () => {
    closePayModal();
    document.getElementById('standings-section')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Modal close button
  document.getElementById('modal-close-btn').addEventListener('click', closePayModal);

  // Close on overlay click
  document.getElementById('pay-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('pay-modal')) closePayModal();
  });

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePayModal();
  });

  // Auto-refresh every 6 seconds
  setInterval(() => {
    renderCandidates();
    renderStandings();
  }, 6000);
});
