/* ═══════════════════════════════════════════════════
   PRESIDENTIAL ANNUAL AWARDS — data.js
   Shared data store, utilities & state management
═══════════════════════════════════════════════════ */

'use strict';

/* ── CONSTANTS ── */
const PAA = {
  VOTE_COST:   20,          // KES per vote
  MIN_AMOUNT:  20,          // minimum payment
  PAYBILL:     '4564811',
  ACCOUNT:     'Your Name',
  ADMIN_USER:  'admin',
  ADMIN_PASS:  'paa2025',
  STORAGE_KEY: 'paa_data_v2',

  CANDIDATES: [
    { id: 'mariga',    name: 'Mariga Strong',  initials: 'MS' },
    { id: 'jimmy',     name: 'Jimmy',           initials: 'JM' },
    { id: 'brayo',     name: 'Brayo',           initials: 'BR' },
    { id: 'tonny',     name: 'Tonny',           initials: 'TO' },
    { id: 'bamalekei', name: 'Bamalekei',       initials: 'BK' },
  ],
};

/* ── DATA LAYER ── */
const Store = {

  /** Return a fresh default data structure */
  _default() {
    const votes = {};
    PAA.CANDIDATES.forEach(c => { votes[c.id] = 0; });
    return { votes, log: [] };
  },

  /** Load data from localStorage */
  load() {
    try {
      const raw = localStorage.getItem(PAA.STORAGE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.votes && Array.isArray(d.log)) return d;
      }
    } catch (e) {}
    return this._default();
  },

  /** Persist data to localStorage */
  save(data) {
    try {
      localStorage.setItem(PAA.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('PAA: storage write failed', e);
    }
  },

  /** Record votes — voteCount is derived from amount ÷ VOTE_COST */
  recordVote(voterName, candidateId, amount) {
    const voteCount = Math.floor(amount / PAA.VOTE_COST);
    const data = this.load();
    data.votes[candidateId] = (data.votes[candidateId] || 0) + voteCount;

    const now = new Date();
    data.log.unshift({
      voter:       voterName,
      candidateId: candidateId,
      candidate:   PAA.CANDIDATES.find(c => c.id === candidateId)?.name || candidateId,
      amount:      amount,
      votes:       voteCount,
      time:        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date:        now.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }),
      ts:          now.toISOString(),
    });

    // Cap log at 500 entries
    if (data.log.length > 500) data.log = data.log.slice(0, 500);
    this.save(data);
    return { data, voteCount };
  },

  /** Get total votes across all candidates */
  totalVotes(data) {
    return PAA.CANDIDATES.reduce((sum, c) => sum + (data.votes[c.id] || 0), 0);
  },

  /** Get candidates sorted by vote count descending */
  sortedCandidates(data) {
    return [...PAA.CANDIDATES].sort(
      (a, b) => (data.votes[b.id] || 0) - (data.votes[a.id] || 0)
    );
  },

  /** Get count of unique voters by name */
  uniqueVoters(data) {
    return new Set(data.log.map(l => l.voter.trim().toLowerCase())).size;
  },
};

/* ── TOAST UTILITY ── */
const Toast = {
  _timer: null,

  show(message, icon = '🗳') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.querySelector('.toast-icon').textContent = icon;
    el.querySelector('.toast-msg').textContent = message;
    el.classList.add('show');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => el.classList.remove('show'), 3600);
  },
};

/* ── AUTH UTILITY ── */
const Auth = {
  SESSION_KEY: 'paa_admin_session',

  login(username, password) {
    if (username === PAA.ADMIN_USER && password === PAA.ADMIN_PASS) {
      sessionStorage.setItem(this.SESSION_KEY, '1');
      return true;
    }
    return false;
  },

  logout() {
    sessionStorage.removeItem(this.SESSION_KEY);
  },

  isLoggedIn() {
    return sessionStorage.getItem(this.SESSION_KEY) === '1';
  },
};

/* ── FORMAT HELPERS ── */
const Fmt = {
  currency: (n)  => `KES ${Number(n).toLocaleString()}`,
  number:   (n)  => Number(n).toLocaleString(),
  percent:  (n)  => `${n}%`,
  initials: (name) =>
    name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
};
