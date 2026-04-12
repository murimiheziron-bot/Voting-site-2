// ============================================================
// mpesa_stk.js — Node.js M-Pesa STK Push Server
// Presidential Annual Awards
// Handles: STK Push · Poll · Manual Confirm · Callback
//
// SETUP:
//   npm install express cors axios better-sqlite3
//   node mpesa_stk.js
//
// Server runs on http://localhost:3000
// In production put this behind Nginx/Caddy with HTTPS
// ============================================================

const express    = require('express');
const cors       = require('cors');
const axios      = require('axios');
const Database   = require('better-sqlite3');
const path       = require('path');
const fs         = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve your frontend static files from the same folder
// Put vote.html, vote.js, data.js, styles.css etc. in ./public
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ★ EDIT THESE — your Daraja credentials
// ============================================================
const CONFIG = {
  CONSUMER_KEY:    process.env.MPESA_CONSUMER_KEY    || 'YOUR_CONSUMER_KEY',
  CONSUMER_SECRET: process.env.MPESA_CONSUMER_SECRET || 'YOUR_CONSUMER_SECRET',
  SHORTCODE:       process.env.MPESA_SHORTCODE        || '174379',       // sandbox default
  PASSKEY:         process.env.MPESA_PASSKEY          || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  CALLBACK_URL:    process.env.MPESA_CALLBACK_URL     || 'https://yourdomain.com/mpesa/callback',
  ENV:             process.env.MPESA_ENV              || 'sandbox',      // 'sandbox' | 'production'
};

CONFIG.BASE_URL = CONFIG.ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

// ============================================================
// SQLite Database Setup (auto-created, no config needed)
// ============================================================
const DB_FILE = path.join(__dirname, 'votes.db');
let db;

function openDb() {
  if (db) return db;
  db = new Database(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      checkout_id    TEXT PRIMARY KEY,
      candidate_id   TEXT,
      candidate_name TEXT,
      voter_name     TEXT,
      phone          TEXT,
      amount         INTEGER DEFAULT 0,
      votes          INTEGER DEFAULT 0,
      mpesa_code     TEXT DEFAULT '',
      status         TEXT DEFAULT 'PENDING',
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS candidate_votes (
      candidate_id   TEXT PRIMARY KEY,
      candidate_name TEXT,
      total_votes    INTEGER DEFAULT 0
    );
  `);
  return db;
}

// ============================================================
// HELPER: Get M-Pesa OAuth Token
// ============================================================
async function getToken() {
  const credentials = Buffer.from(`${CONFIG.CONSUMER_KEY}:${CONFIG.CONSUMER_SECRET}`).toString('base64');
  const res = await axios.get(`${CONFIG.BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    timeout: 15000,
  });
  return res.data.access_token;
}

// ============================================================
// HELPER: Sanitize phone to Safaricom format (2547XXXXXXXX)
// ============================================================
function sanitizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[\s\-()]/g, '');
  if (p.startsWith('0'))  p = '254' + p.slice(1);
  if (p.startsWith('+'))  p = p.slice(1);
  return /^254(7|1)\d{8}$/.test(p) ? p : null;
}

// ============================================================
// HELPER: Add votes to candidate_votes table
// ============================================================
function addVotes(dbInstance, checkoutId) {
  const row = dbInstance
    .prepare('SELECT candidate_id, candidate_name, votes FROM transactions WHERE checkout_id = ?')
    .get(checkoutId);
  if (!row) return;

  dbInstance.prepare(`
    INSERT INTO candidate_votes (candidate_id, candidate_name, total_votes)
    VALUES (?, ?, ?)
    ON CONFLICT(candidate_id) DO UPDATE SET total_votes = total_votes + ?
  `).run(row.candidate_id, row.candidate_name, row.votes, row.votes);
}

// ============================================================
// HELPER: Build timestamp + password for Safaricom
// ============================================================
function buildTimestampAndPassword() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestamp =
    now.getFullYear()          +
    pad(now.getMonth() + 1)    +
    pad(now.getDate())         +
    pad(now.getHours())        +
    pad(now.getMinutes())      +
    pad(now.getSeconds());
  const password = Buffer.from(`${CONFIG.SHORTCODE}${CONFIG.PASSKEY}${timestamp}`).toString('base64');
  return { timestamp, password };
}

// ============================================================
// ROUTE: POST /mpesa/stk  — initiate STK Push
// ============================================================
app.post('/mpesa/stk', async (req, res) => {
  const { phone: rawPhone, amount: rawAmount, candidateId, candidateName, voterName, votes: rawVotes } = req.body;

  const phone  = sanitizePhone(rawPhone);
  const amount = parseInt(rawAmount, 10);

  if (!phone) {
    return res.json({ success: false, message: 'Invalid phone number. Use 07XX or 01XX format.' });
  }
  if (!amount || amount < 20 || amount % 20 !== 0) {
    return res.json({ success: false, message: 'Amount must be a multiple of KES 20.' });
  }

  const votes = parseInt(rawVotes, 10) || Math.floor(amount / 20);

  try {
    const token = await getToken();
    const { timestamp, password } = buildTimestampAndPassword();

    const stkRes = await axios.post(
      `${CONFIG.BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: CONFIG.SHORTCODE,
        Password:          password,
        Timestamp:         timestamp,
        TransactionType:   'CustomerPayBillOnline',
        Amount:            amount,
        PartyA:            phone,
        PartyB:            CONFIG.SHORTCODE,
        PhoneNumber:       phone,
        CallBackURL:       CONFIG.CALLBACK_URL,
        AccountReference:  String(candidateName).slice(0, 12),
        TransactionDesc:   'Vote',
      },
      {
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const data = stkRes.data;

    if (String(data.ResponseCode) === '0') {
      const checkoutId = data.CheckoutRequestID;

      // Save to SQLite
      try {
        const dbInst = openDb();
        dbInst.prepare(`
          INSERT OR IGNORE INTO transactions
            (checkout_id, candidate_id, candidate_name, voter_name, phone, amount, votes, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
        `).run(checkoutId, candidateId, candidateName, voterName, phone, amount, votes);
      } catch (dbErr) {
        console.error('DB insert error:', dbErr.message);
      }

      return res.json({ success: true, checkoutRequestId: checkoutId, message: 'STK push sent' });
    }

    const msg = data.errorMessage || data.ResponseDescription || 'STK Push failed. Check your shortcode and passkey.';
    return res.json({ success: false, message: msg });

  } catch (err) {
    console.error('STK push error:', err.response?.data || err.message);
    const msg = err.response?.data?.errorMessage || 'Could not connect to M-Pesa. Check your credentials.';
    return res.json({ success: false, message: msg });
  }
});

// ============================================================
// ROUTE: POST /mpesa/poll — check payment status
// ============================================================
app.post('/mpesa/poll', async (req, res) => {
  const { checkoutRequestId } = req.body;

  if (!checkoutRequestId) {
    return res.json({ status: 'ERROR', message: 'Missing checkoutRequestId' });
  }

  // Check SQLite first (fastest path — avoids Safaricom API call)
  try {
    const dbInst = openDb();
    const row = dbInst
      .prepare('SELECT status, mpesa_code FROM transactions WHERE checkout_id = ?')
      .get(checkoutRequestId);

    if (row) {
      if (row.status === 'COMPLETED') {
        return res.json({ status: 'COMPLETED', mpesaCode: row.mpesa_code });
      }
      if (['FAILED', 'CANCELLED'].includes(row.status)) {
        return res.json({ status: row.status });
      }
    }
  } catch (dbErr) {
    console.error('DB poll error:', dbErr.message);
  }

  // Query Safaricom STK Query API
  try {
    const token = await getToken();
    const { timestamp, password } = buildTimestampAndPassword();

    const queryRes = await axios.post(
      `${CONFIG.BASE_URL}/mpesa/stkpushquery/v1/query`,
      {
        BusinessShortCode: CONFIG.SHORTCODE,
        Password:          password,
        Timestamp:         timestamp,
        CheckoutRequestID: checkoutRequestId,
      },
      {
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const data = queryRes.data;
    const rc   = String(data.ResultCode ?? '');

    if (rc === '0') {
      // Payment successful
      try {
        const dbInst = openDb();
        dbInst.prepare("UPDATE transactions SET status='COMPLETED' WHERE checkout_id = ?")
              .run(checkoutRequestId);
        addVotes(dbInst, checkoutRequestId);
      } catch (dbErr) {
        console.error('DB update error:', dbErr.message);
      }
      return res.json({ status: 'COMPLETED', mpesaCode: 'API_CONFIRMED' });
    }

    if (rc !== '') {
      const newStatus = rc === '1032' ? 'CANCELLED' : 'FAILED';
      try {
        const dbInst = openDb();
        dbInst.prepare('UPDATE transactions SET status=? WHERE checkout_id = ?')
              .run(newStatus, checkoutRequestId);
      } catch (dbErr) {
        console.error('DB update error:', dbErr.message);
      }
      return res.json({ status: newStatus });
    }

  } catch (err) {
    console.error('Poll API error:', err.response?.data || err.message);
    // Silently return PENDING so frontend keeps retrying
  }

  return res.json({ status: 'PENDING' });
});

// ============================================================
// ROUTE: POST /mpesa/manual-confirm — voter pastes M-Pesa code
// ============================================================
app.post('/mpesa/manual-confirm', (req, res) => {
  const { mpesaCode: rawCode, checkoutRequestId } = req.body;
  const code = String(rawCode || '').toUpperCase().trim();

  if (code.length < 8) {
    return res.json({ success: false, message: 'Code too short. Enter the full M-Pesa confirmation code.' });
  }

  try {
    const dbInst = openDb();
    dbInst.prepare("UPDATE transactions SET status='COMPLETED', mpesa_code=? WHERE checkout_id = ?")
          .run(code, checkoutRequestId);
    addVotes(dbInst, checkoutRequestId);
    return res.json({ success: true, mpesaCode: code });
  } catch (err) {
    console.error('Manual confirm DB error:', err.message);
    return res.json({ success: false, message: 'Could not confirm code. Try again.' });
  }
});

// ============================================================
// ROUTE: POST /mpesa/callback — Safaricom calls this after payment
// ============================================================
app.post('/mpesa/callback', (req, res) => {
  const payload = req.body;

  // Log raw callback
  const logLine = `[${new Date().toISOString()}] ${JSON.stringify(payload)}\n`;
  fs.appendFile(path.join(__dirname, 'mpesa_log.txt'), logLine, () => {});

  const cb         = payload?.Body?.stkCallback ?? {};
  const checkoutId = cb.CheckoutRequestID ?? '';
  const resultCode = Number(cb.ResultCode ?? 1);

  if (!checkoutId) {
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  try {
    const dbInst = openDb();

    if (resultCode === 0) {
      const items     = cb.CallbackMetadata?.Item ?? [];
      const codeItem  = items.find(i => i.Name === 'MpesaReceiptNumber');
      const mpesaCode = codeItem?.Value ?? '';

      dbInst.prepare("UPDATE transactions SET status='COMPLETED', mpesa_code=? WHERE checkout_id = ?")
            .run(mpesaCode, checkoutId);
      addVotes(dbInst, checkoutId);
    } else {
      const status = resultCode === 1032 ? 'CANCELLED' : 'FAILED';
      dbInst.prepare('UPDATE transactions SET status=? WHERE checkout_id = ?')
            .run(status, checkoutId);
    }
  } catch (err) {
    console.error('Callback DB error:', err.message);
  }

  return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ============================================================
// ROUTE: GET /mpesa/standings — optional: live vote totals API
// ============================================================
app.get('/mpesa/standings', (req, res) => {
  try {
    const dbInst = openDb();
    const rows   = dbInst.prepare('SELECT candidate_id, candidate_name, total_votes FROM candidate_votes ORDER BY total_votes DESC').all();
    return res.json({ success: true, standings: rows });
  } catch (err) {
    return res.json({ success: false, standings: [] });
  }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Presidential Annual Awards — M-Pesa   ║
║   Server running on port ${PORT}            ║
║   ENV: ${CONFIG.ENV.padEnd(33)}║
╚══════════════════════════════════════════╝
  `);
  console.log('Endpoints:');
  console.log(`  POST /mpesa/stk`);
  console.log(`  POST /mpesa/poll`);
  console.log(`  POST /mpesa/manual-confirm`);
  console.log(`  POST /mpesa/callback`);
  console.log(`  GET  /mpesa/standings`);
});
