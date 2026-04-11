/* ═══════════════════════════════════════════════════
   PRESIDENTIAL ANNUAL AWARDS — data.js
   Shared data store, utilities & state management
═══════════════════════════════════════════════════ */

'use strict';

/* ── CONSTANTS ── */
const PAA = {
  VOTE_COST:   20,
  MIN_AMOUNT:  20,
  PAYBILL:     '4564811',
  ACCOUNT:     'Your Name',
  ADMIN_USER:  'admin',
  ADMIN_PASS:  'paa2025',
  STORAGE_KEY: 'paa_data_v2',

  /* ── M-Pesa API endpoints (your PHP backend) ── */
  STK_ENDPOINT:  'mpesa_stk.php',
  POLL_ENDPOINT: 'mpesa_poll.php',
  POLL_INTERVAL: 3000,   // ms between status checks
  STK_TIMEOUT:   120,    // seconds before showing manual fallback

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

  _default() {
    const votes = {};
    PAA.CANDIDATES.forEach(c => { votes[c.id] = 0; });
    return { votes, log: [] };
  },

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

  save(data) {
    try {
      localStorage.setItem(PAA.STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('PAA: storage write failed', e);
    }
  },

  /** Record votes locally after confirmed M-Pesa payment */
  recordVote(voterName, candidateId, amount, mpesaCode) {
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
      mpesaCode:   mpesaCode || '',
      time:        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date:        now.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }),
      ts:          now.toISOString(),
    });

    if (data.log.length > 500) data.log = data.log.slice(0, 500);
    this.save(data);
    return { data, voteCount };
  },

  totalVotes(data) {
    return PAA.CANDIDATES.reduce((sum, c) => sum + (data.votes[c.id] || 0), 0);
  },

  sortedCandidates(data) {
    return [...PAA.CANDIDATES].sort(
      (a, b) => (data.votes[b.id] || 0) - (data.votes[a.id] || 0)
    );
  },

  uniqueVoters(data) {
    return new Set(data.log.map(l => l.voter.trim().toLowerCase())).size;
  },
};

/* ── MPESA SERVICE ── */
const MpesaService = {

  _pollTimer:      null,
  _countdownTimer: null,
  _secondsLeft:    0,
  _checkoutId:     null,
  _onSuccess:      null,
  _onFailure:      null,

  /**
   * Initiate STK Push
   * Calls mpesa_stk.php → returns { success, checkoutRequestId, message }
   */
  async initiateStkPush({ phone, amount, candidateId, candidateName, voterName, votes }) {
    const res = await fetch(PAA.STK_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        phone,
        amount,
        candidateId,
        candidateName,
        voterName,
        votes,
        paybill:      PAA.PAYBILL,
        accountRef:   candidateName,
        description:  `Vote ${candidateName}`,
      }),
    });

    /* Guard: if server returned HTML instead of JSON show clear error */
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text();
      console.error('STK endpoint returned non-JSON:', text.slice(0, 200));
      return { success: false, message: 'Server error — mpesa_stk.php not found or returned an error. Check your server setup.' };
    }

    return res.json();
  },

  /**
   * Poll mpesa_poll.php every POLL_INTERVAL ms
   * Calls onSuccess(mpesaCode) or onFailure()
   */
  startPolling(checkoutRequestId, onSuccess, onFailure) {
    this._checkoutId = checkoutRequestId;
    this._onSuccess  = onSuccess;
    this._onFailure  = onFailure;
    this.stopPolling();
    this._pollTimer = setInterval(() => this._poll(), PAA.POLL_INTERVAL);
  },

  async _poll() {
    try {
      const res = await fetch(PAA.POLL_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ checkoutRequestId: this._checkoutId }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return; // silent — keep polling

      const data = await res.json();

      if (data.status === 'COMPLETED') {
        this.stopAll();
        this._onSuccess && this._onSuccess(data.mpesaCode || 'CONFIRMED');
      } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
        this.stopAll();
        this._onFailure && this._onFailure(data.status);
      }
      // PENDING → keep polling
    } catch (e) {
      // network hiccup — keep polling
    }
  },

  stopPolling() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  },

  stopCountdown() {
    clearInterval(this._countdownTimer);
    this._countdownTimer = null;
  },

  stopAll() {
    this.stopPolling();
    this.stopCountdown();
  },

  /**
   * Start a visual countdown. After 30s shows manual-confirm fallback.
   * After timeout calls onExpire().
   */
  startCountdown(elId, manualConfirmEl, onExpire) {
    this._secondsLeft = PAA.STK_TIMEOUT;
    const el = document.getElementById(elId);
    if (el) el.textContent = this._secondsLeft;
    if (manualConfirmEl) manualConfirmEl.style.display = 'none';

    this.stopCountdown();
    this._countdownTimer = setInterval(() => {
      this._secondsLeft--;
      if (el) el.textContent = this._secondsLeft;

      if (this._secondsLeft === 30 && manualConfirmEl) {
        manualConfirmEl.style.display = '';
      }

      if (this._secondsLeft <= 0) {
        this.stopAll();
        onExpire && onExpire();
      }
    }, 1000);
  },

  /**
   * Manual confirmation via M-Pesa code
   */
  async manualConfirm({ mpesaCode, checkoutRequestId, candidateId, candidateName, votes, amount, voterName, phone }) {
    const res = await fetch(PAA.STK_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action: 'manual_confirm',
        mpesaCode,
        checkoutRequestId,
        candidateId,
        candidateName,
        votes,
        amount,
        voterName,
        phone,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { success: false, message: 'Server error — check mpesa_stk.php' };
    }
    return res.json();
  },

  /** Format phone to Safaricom format: 2547XXXXXXXX */
  formatPhone(raw) {
    let p = raw.replace(/[\s\-]/g, '');
    if (p.startsWith('0'))  p = '254' + p.slice(1);
    if (p.startsWith('+'))  p = p.slice(1);
    if (/^254(7|1)\d{8}$/.test(p)) return p;
    return null;
  },
};

/* ── TOAST UTILITY ── */
const Toast = {
  _timer: null,

  show(message, icon = '🗳', isError = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.querySelector('.toast-icon').textContent  = icon;
    el.querySelector('.toast-msg').textContent   = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(this._timer);
    this._timer = setTimeout(() => el.classList.remove('show'), 4000);
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

  logout()    { sessionStorage.removeItem(this.SESSION_KEY); },
  isLoggedIn(){ return sessionStorage.getItem(this.SESSION_KEY) === '1'; },
};

/* ── FORMAT HELPERS ── */
const Fmt = {
  currency: (n)    => `KES ${Number(n).toLocaleString()}`,
  number:   (n)    => Number(n).toLocaleString(),
  percent:  (n)    => `${n}%`,
  initials: (name) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
};
