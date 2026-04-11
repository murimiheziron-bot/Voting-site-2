/* ═══════════════════════════════════════════════════
   PRESIDENTIAL ANNUAL AWARDS — admin.js
   Logic for the admin dashboard (admin.html)
═══════════════════════════════════════════════════ */

'use strict';

/* ── Auth guard: redirect if not logged in ── */
if (!Auth.isLoggedIn()) {
  window.location.href = 'admin-login.html';
}

/* ══════════════════════════════════════
   RENDER — STAT CARDS
══════════════════════════════════════ */
function renderStats(data) {
  const tv     = Store.totalVotes(data);
  const sorted = Store.sortedCandidates(data);
  const leader = sorted[0];

  document.getElementById('stat-total-votes').textContent = Fmt.number(tv);
  document.getElementById('stat-revenue').textContent     = Fmt.currency(tv * PAA.VOTE_COST);
  document.getElementById('stat-unique').textContent      = Fmt.number(Store.uniqueVoters(data));

  if (leader && (data.votes[leader.id] || 0) > 0) {
    document.getElementById('stat-leader').textContent       = leader.name;
    document.getElementById('stat-leader-votes').textContent =
      `${Fmt.number(data.votes[leader.id])} votes`;
  } else {
    document.getElementById('stat-leader').textContent       = '—';
    document.getElementById('stat-leader-votes').textContent = 'No votes yet';
  }
}

/* ══════════════════════════════════════
   RENDER — RESULTS TABLE
══════════════════════════════════════ */
function renderTable(data) {
  const tv     = Store.totalVotes(data);
  const sorted = Store.sortedCandidates(data);
  const tbody  = document.getElementById('results-tbody');
  const rankClasses = ['r1', 'r2', 'r3'];

  tbody.innerHTML = sorted.map((c, i) => {
    const votes   = data.votes[c.id] || 0;
    const pct     = tv > 0 ? Math.round((votes / tv) * 100) : 0;
    const revenue = votes * PAA.VOTE_COST;
    const rankCls = rankClasses[i] || '';

    return `
      <tr>
        <td>
          <div class="rank-circle ${rankCls}">${i + 1}</div>
        </td>
        <td class="td-candidate">${c.name}</td>
        <td><strong>${Fmt.number(votes)}</strong></td>
        <td>
          <div class="prog-wrap">
            <div class="prog-track">
              <div class="prog-fill" style="width:${pct}%"></div>
            </div>
            <span class="prog-pct">${pct}%</span>
          </div>
        </td>
        <td class="td-revenue">${Fmt.currency(revenue)}</td>
      </tr>
    `;
  }).join('');
}

/* ══════════════════════════════════════
   RENDER — DISTRIBUTION CHART
══════════════════════════════════════ */
function renderChart(data) {
  const tv      = Store.totalVotes(data);
  const sorted  = Store.sortedCandidates(data);
  const maxV    = Math.max(...PAA.CANDIDATES.map(c => data.votes[c.id] || 0), 1);
  const chart   = document.getElementById('dist-chart');
  const MAXH    = 120; // max bar height in px

  chart.innerHTML = sorted.map((c, i) => {
    const votes   = data.votes[c.id] || 0;
    const barH    = Math.round((votes / maxV) * MAXH);
    const isLeader = i === 0 && votes > 0;

    return `
      <div class="dist-bar-col">
        <div class="dist-bar-count">${Fmt.number(votes)}</div>
        <div
          class="dist-bar-fill ${isLeader ? 'leader' : ''}"
          style="height:${barH}px"
          title="${c.name}: ${votes} votes"
        ></div>
        <div class="dist-bar-label">${c.name.split(' ')[0]}</div>
      </div>
    `;
  }).join('');
}

/* ══════════════════════════════════════
   RENDER — VOTER LOG
══════════════════════════════════════ */
function renderLog(data) {
  const log    = data.log || [];
  const logEl  = document.getElementById('voter-log');
  const countEl = document.getElementById('log-count');

  countEl.textContent = `${Fmt.number(log.length)} transaction${log.length !== 1 ? 's' : ''}`;

  if (log.length === 0) {
    logEl.innerHTML = '<div class="log-empty">No votes recorded yet. Waiting for first voter…</div>';
    return;
  }

  logEl.innerHTML = log.slice(0, 80).map(entry => {
    const initials  = Fmt.initials(entry.voter);
    const voteCount = entry.votes || 1;
    return `
      <div class="log-item">
        <div class="log-avatar">${initials}</div>
        <div class="log-info">
          <div class="log-voter">${entry.voter}</div>
          <div class="log-detail">
            Voted for <strong>${entry.candidate}</strong>
            &nbsp;·&nbsp;
            <span style="color:var(--gold-light)">${voteCount} vote${voteCount > 1 ? 's' : ''}</span>
          </div>
        </div>
        <div class="log-meta">
          <div class="log-amount">${Fmt.currency(entry.amount)}</div>
          <div class="log-time">${entry.date} · ${entry.time}</div>
        </div>
      </div>
    `;
  }).join('');
}

/* ══════════════════════════════════════
   MASTER RENDER FUNCTION
══════════════════════════════════════ */
function renderAll() {
  const data = Store.load();
  renderStats(data);
  renderTable(data);
  renderChart(data);
  renderLog(data);

  // Flash the refresh indicator
  const dot = document.getElementById('refresh-indicator');
  dot.classList.add('flash');
  setTimeout(() => dot.classList.remove('flash'), 600);
}

/* ══════════════════════════════════════
   LOGOUT
══════════════════════════════════════ */
function doLogout() {
  Auth.logout();
  window.location.href = 'admin-login.html';
}

/* ══════════════════════════════════════
   EVENT LISTENERS & INIT
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  renderAll();

  // Logout button
  document.getElementById('logout-btn').addEventListener('click', doLogout);

  // Manual refresh button
  document.getElementById('manual-refresh-btn').addEventListener('click', () => {
    renderAll();
    Toast.show('Dashboard refreshed.', '↻');
  });

  // Auto-refresh every 5 seconds
  setInterval(renderAll, 5000);
});
