/* ═══════════════════════════════════════════════════
   PRESIDENTIAL ANNUAL AWARDS — vote.js
   Logic for the public voting page (index.html)
═══════════════════════════════════════════════════ */

'use strict';

/* ── STATE ── */
let selectedCandidate = null;

/* ══════════════════════════════════════
   RENDER — CANDIDATES GRID
══════════════════════════════════════ */
function renderCandidates() {
  const data    = Store.load();
  const tv      = Store.totalVotes(data);
  const sorted  = Store.sortedCandidates(data);
  const grid    = document.getElementById('candidates-grid');

  // Build a rank map: candidateId → rank (1 = leading)
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
            <img src="images/${c.id}.jpg" alt="${c.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
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

  // Update topbar counter
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
   MODAL — OPEN / CLOSE
══════════════════════════════════════ */
function openPayModal(candidateId) {
  selectedCandidate = PAA.CANDIDATES.find(c => c.id === candidateId);
  if (!selectedCandidate) return;

  // Reset to step 1
  document.getElementById('step-form').style.display    = 'block';
  document.getElementById('step-stk').style.display     = 'none';
  document.getElementById('step-success').style.display = 'none';
  document.getElementById('voter-name').value           = '';
  document.getElementById('vote-amount').value          = '20';
  document.getElementById('modal-candidate-name').textContent = selectedCandidate.name;

  // Trigger preview update for default amount
  updateVotePreview();

  document.getElementById('pay-modal').classList.add('open');
}

function closePayModal() {
  document.getElementById('pay-modal').classList.remove('open');
  selectedCandidate = null;
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
    count.textContent   = votes;
    count.className     = 'preview-count active';
    preview.className   = 'vote-preview has-votes';
    payBtn.textContent  = `Confirm ${votes} Vote${votes > 1 ? 's' : ''} — KES ${amount}`;
  } else {
    count.textContent   = '—';
    count.className     = 'preview-count';
    preview.className   = 'vote-preview';
    payBtn.textContent  = 'Enter a valid amount';
  }
}

/* Quick-amount shortcut buttons */
function setAmount(amount) {
  document.getElementById('vote-amount').value = amount;
  updateVotePreview();

  // Highlight the active quick button
  document.querySelectorAll('.quick-btn').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');
}

/* ══════════════════════════════════════
   MODAL — SUBMIT VOTE
══════════════════════════════════════ */
function submitVote() {
  const nameInput   = document.getElementById('voter-name');
  const amountInput = document.getElementById('vote-amount');
  const name        = nameInput.value.trim();
  const amount      = parseInt(amountInput.value, 10);
  const voteCount   = Math.floor(amount / PAA.VOTE_COST);

  if (!name) {
    Toast.show('Please enter your full name to proceed.', '⚠️');
    nameInput.focus();
    return;
  }

  if (!amount || amount < PAA.VOTE_COST) {
    Toast.show(`Minimum amount is KES ${PAA.VOTE_COST} (1 vote).`, '⚠️');
    amountInput.focus();
    return;
  }

  if (amount % PAA.VOTE_COST !== 0) {
    Toast.show(`Amount must be a multiple of KES ${PAA.VOTE_COST}. e.g. 20, 40, 100…`, '⚠️');
    amountInput.focus();
    return;
  }

  if (!selectedCandidate) return;

  // Move to STK push step
  document.getElementById('step-form').style.display = 'none';
  document.getElementById('step-stk').style.display  = 'block';

  // Update STK message with vote count
  document.getElementById('stk-vote-summary').innerHTML =
    `Sending <strong style="color:var(--gold)">KES ${amount}</strong> for
     <strong style="color:var(--gold)">${voteCount} vote${voteCount > 1 ? 's' : ''}</strong>
     for ${selectedCandidate.name}…`;

  // Simulate M-Pesa STK push delay
  setTimeout(() => {
    const result = Store.recordVote(name, selectedCandidate.id, amount);

    document.getElementById('step-stk').style.display     = 'none';
    document.getElementById('step-success').style.display = 'block';

    document.getElementById('success-msg').innerHTML =
      `<strong style="color:var(--gold)">${result.voteCount} vote${result.voteCount > 1 ? 's' : ''}</strong>
       cast for <strong style="color:var(--gold)">${selectedCandidate.name}</strong>.<br/>
       KES ${amount} deducted via M-Pesa. Thank you, ${name}!`;

    renderCandidates();
    renderStandings();

    Toast.show(
      `${name} cast ${result.voteCount} vote${result.voteCount > 1 ? 's' : ''} for ${selectedCandidate.name}!`,
      '✅'
    );
  }, 3500);
}

/* ══════════════════════════════════════
   EVENT LISTENERS
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  renderCandidates();
  renderStandings();

  // Live preview on amount change
  document.getElementById('vote-amount').addEventListener('input', updateVotePreview);

  // Pay button
  document.getElementById('pay-btn').addEventListener('click', submitVote);

  // Success close
  document.getElementById('success-close-btn').addEventListener('click', closePayModal);

  // Modal close button
  document.getElementById('modal-close-btn').addEventListener('click', closePayModal);

  // Close on overlay click
  document.getElementById('pay-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('pay-modal')) closePayModal();
  });

  // Auto-refresh every 6 seconds
  setInterval(() => {
    renderCandidates();
    renderStandings();
  }, 6000);
});
