<?php
// ============================================================
// mpesa_stk.php — Single-file M-Pesa Handler
// Presidential Annual Awards
// Handles: STK Push initiation + status poll + manual confirm
// PUT THIS FILE in the SAME FOLDER as vote.html / index.html
// ============================================================

// ── Always return JSON, never HTML ──────────────────────────
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Kill PHP error display — errors must NOT print HTML into our JSON
ini_set('display_errors', 0);
error_reporting(0);

// Handle preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ============================================================
// ★ EDIT THESE — your Daraja credentials
// ============================================================
$CONSUMER_KEY    = 'YOUR_CONSUMER_KEY';       // from developer.safaricom.co.ke
$CONSUMER_SECRET = 'YOUR_CONSUMER_SECRET';    // from developer.safaricom.co.ke
$SHORTCODE       = '174379';                  // sandbox test shortcode OR your real paybill e.g. 4564811
$PASSKEY         = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919'; // sandbox passkey OR your real one
$CALLBACK_URL    = 'https://yourdomain.com/mpesa_stk.php'; // ← MUST be a public HTTPS URL (not localhost)

// sandbox or production
$ENV             = 'sandbox'; // change to 'production' when going live
$BASE_URL        = $ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// ============================================================
// ★ OPTIONAL: SQLite vote log (auto-created, no DB setup needed)
//   Set to false if you don't want any local storage
// ============================================================
$USE_STORAGE = true;
$DB_FILE     = __DIR__ . '/votes.db';

// ── Read incoming JSON ────────────────────────────────────
$raw     = file_get_contents('php://input');
$payload = json_decode($raw, true);

if (!$payload) {
    // Also accept GET ?action=callback for Safaricom callback
    if (!empty($_GET['action'])) {
        $payload = ['action' => $_GET['action']];
    } else {
        echo json_encode(['success' => false, 'message' => 'Invalid request body']);
        exit;
    }
}

// FIX: action now correctly read — defaults to 'stk_push' only if missing
$action = $payload['action'] ?? 'stk_push';

// ============================================================
// ROUTER
// ============================================================
try {
    switch ($action) {
        case 'stk_push':
            handleStkPush($payload, $BASE_URL, $CONSUMER_KEY, $CONSUMER_SECRET, $SHORTCODE, $PASSKEY, $CALLBACK_URL, $USE_STORAGE, $DB_FILE);
            break;

        case 'poll':
            handlePoll($payload, $BASE_URL, $CONSUMER_KEY, $CONSUMER_SECRET, $SHORTCODE, $PASSKEY, $USE_STORAGE, $DB_FILE);
            break;

        case 'manual_confirm':
            handleManualConfirm($payload, $USE_STORAGE, $DB_FILE);
            break;

        case 'callback':
            handleCallback($payload, $USE_STORAGE, $DB_FILE);
            break;

        default:
            echo json_encode(['success' => false, 'message' => 'Unknown action: ' . htmlspecialchars($action)]);
    }
} catch (Throwable $e) {
    echo json_encode(['success' => false, 'message' => 'Server error: ' . $e->getMessage()]);
}

// ============================================================
// FUNCTION: Get OAuth token
// ============================================================
function getToken($baseUrl, $key, $secret) {
    $credentials = base64_encode("$key:$secret");
    $ch = curl_init("$baseUrl/oauth/v1/generate?grant_type=client_credentials");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ["Authorization: Basic $credentials"],
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $res = curl_exec($ch);
    $err = curl_error($ch);
    curl_close($ch);
    if ($err || !$res) return null;
    $data = json_decode($res, true);
    return $data['access_token'] ?? null;
}

// ============================================================
// FUNCTION: STK Push initiation
// ============================================================
function handleStkPush($p, $baseUrl, $key, $secret, $shortcode, $passkey, $callbackUrl, $useDb, $dbFile) {
    // Validate
    $phone  = sanitizePhone($p['phone'] ?? '');
    $amount = (int)($p['amount'] ?? 0);

    if (!$phone) {
        echo json_encode(['success' => false, 'message' => 'Invalid phone number. Use 07XX or 01XX format.']);
        return;
    }
    if ($amount < 20 || $amount % 20 !== 0) {
        echo json_encode(['success' => false, 'message' => 'Amount must be a multiple of KES 20.']);
        return;
    }

    $candidateId   = $p['candidateId']   ?? '';
    $candidateName = $p['candidateName'] ?? 'Candidate';
    $voterName     = $p['voterName']     ?? '';
    $votes         = (int)($p['votes']   ?? ($amount / 20));

    // Get token
    $token = getToken($baseUrl, $key, $secret);
    if (!$token) {
        echo json_encode(['success' => false, 'message' => 'Could not authenticate with M-Pesa. Check your Consumer Key & Secret.']);
        return;
    }

    // Build STK Push body
    $timestamp = date('YmdHis');
    $password  = base64_encode($shortcode . $passkey . $timestamp);

    // FIX: callback URL action param properly appended
    $callbackWithAction = rtrim($callbackUrl, '?') . (strpos($callbackUrl, '?') !== false ? '&' : '?') . 'action=callback';

    $body = [
        'BusinessShortCode' => $shortcode,
        'Password'          => $password,
        'Timestamp'         => $timestamp,
        'TransactionType'   => 'CustomerPayBillOnline',
        'Amount'            => $amount,
        'PartyA'            => $phone,
        'PartyB'            => $shortcode,
        'PhoneNumber'       => $phone,
        'CallBackURL'       => $callbackWithAction,
        'AccountReference'  => substr($candidateName, 0, 12),
        'TransactionDesc'   => 'Vote',
    ];

    $ch = curl_init("$baseUrl/mpesa/stkpush/v1/processrequest");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($body),
        CURLOPT_HTTPHEADER     => [
            "Authorization: Bearer $token",
            "Content-Type: application/json",
        ],
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $res  = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($err) {
        echo json_encode(['success' => false, 'message' => 'cURL error: ' . $err]);
        return;
    }

    $data = json_decode($res, true);

    if (($data['ResponseCode'] ?? '') === '0') {
        $checkoutId = $data['CheckoutRequestID'];

        // Save to SQLite
        if ($useDb) {
            $db = openDb($dbFile);
            if ($db) {
                $stmt = $db->prepare(
                    "INSERT OR IGNORE INTO transactions
                     (checkout_id, candidate_id, candidate_name, voter_name, phone, amount, votes, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')"
                );
                $stmt->execute([$checkoutId, $candidateId, $candidateName, $voterName, $phone, $amount, $votes]);
            }
        }

        echo json_encode([
            'success'           => true,
            'checkoutRequestId' => $checkoutId,
            'message'           => 'STK push sent',
        ]);
    } else {
        $msg = $data['errorMessage'] ?? $data['ResponseDescription'] ?? 'STK Push failed. Check your shortcode and passkey.';
        echo json_encode(['success' => false, 'message' => $msg]);
    }
}

// ============================================================
// FUNCTION: Poll payment status
// FIX: this action was never reachable before because vote.js
//      was calling a non-existent mpesa_poll.php file
// ============================================================
function handlePoll($p, $baseUrl, $key, $secret, $shortcode, $passkey, $useDb, $dbFile) {
    $checkoutId = trim($p['checkoutRequestId'] ?? '');
    if (!$checkoutId) {
        echo json_encode(['status' => 'ERROR', 'message' => 'Missing checkoutRequestId']);
        return;
    }

    // Check SQLite first (fastest path)
    if ($useDb) {
        $db = openDb($dbFile);
        if ($db) {
            $stmt = $db->prepare("SELECT status, mpesa_code, votes FROM transactions WHERE checkout_id = ?");
            $stmt->execute([$checkoutId]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                if ($row['status'] === 'COMPLETED') {
                    echo json_encode(['status' => 'COMPLETED', 'mpesaCode' => $row['mpesa_code']]);
                    return;
                }
                if (in_array($row['status'], ['FAILED', 'CANCELLED'])) {
                    echo json_encode(['status' => $row['status']]);
                    return;
                }
            }
        }
    }

    // Query Safaricom STK Query API
    $token = getToken($baseUrl, $key, $secret);
    if (!$token) {
        echo json_encode(['status' => 'PENDING']); // keep polling
        return;
    }

    $timestamp = date('YmdHis');
    $password  = base64_encode($shortcode . $passkey . $timestamp);

    $body = [
        'BusinessShortCode' => $shortcode,
        'Password'          => $password,
        'Timestamp'         => $timestamp,
        'CheckoutRequestID' => $checkoutId,
    ];

    $ch = curl_init("$baseUrl/mpesa/stkpushquery/v1/query");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($body),
        CURLOPT_HTTPHEADER     => [
            "Authorization: Bearer $token",
            "Content-Type: application/json",
        ],
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $res  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code === 200) {
        $data = json_decode($res, true);
        $rc   = (string)($data['ResultCode'] ?? '');

        if ($rc === '0') {
            // SUCCESS — update DB
            if ($useDb) {
                $db = openDb($dbFile);
                if ($db) {
                    $stmt = $db->prepare("UPDATE transactions SET status='COMPLETED' WHERE checkout_id = ?");
                    $stmt->execute([$checkoutId]);
                    addVotes($db, $checkoutId);
                }
            }
            echo json_encode(['status' => 'COMPLETED', 'mpesaCode' => 'API_CONFIRMED']);
            return;
        }

        if ($rc !== '') {
            // Any non-empty non-0 result = failed/cancelled
            $newStatus = ($rc === '1032') ? 'CANCELLED' : 'FAILED';
            if ($useDb) {
                $db = openDb($dbFile);
                if ($db) {
                    $stmt = $db->prepare("UPDATE transactions SET status=? WHERE checkout_id = ?");
                    $stmt->execute([$newStatus, $checkoutId]);
                }
            }
            echo json_encode(['status' => $newStatus]);
            return;
        }
    }

    echo json_encode(['status' => 'PENDING']);
}

// ============================================================
// FUNCTION: Manual code confirmation
// ============================================================
function handleManualConfirm($p, $useDb, $dbFile) {
    $code       = strtoupper(trim($p['mpesaCode'] ?? ''));
    $checkoutId = $p['checkoutRequestId'] ?? '';

    if (strlen($code) < 8) {
        echo json_encode(['success' => false, 'message' => 'Code too short. Enter the full M-Pesa confirmation code.']);
        return;
    }

    if ($useDb) {
        $db = openDb($dbFile);
        if ($db) {
            $stmt = $db->prepare("UPDATE transactions SET status='COMPLETED', mpesa_code=? WHERE checkout_id = ?");
            $stmt->execute([$code, $checkoutId]);
            addVotes($db, $checkoutId);
        }
    }

    echo json_encode(['success' => true, 'mpesaCode' => $code]);
}

// ============================================================
// FUNCTION: Safaricom callback (called by Safaricom servers)
// ============================================================
function handleCallback($payload, $useDb, $dbFile) {
    // Log raw callback
    file_put_contents(__DIR__ . '/mpesa_log.txt', date('[Y-m-d H:i:s] ') . json_encode($payload) . "\n", FILE_APPEND | LOCK_EX);

    $cb          = $payload['Body']['stkCallback']    ?? [];
    $checkoutId  = $cb['CheckoutRequestID']           ?? '';
    $resultCode  = (int)($cb['ResultCode']            ?? 1);

    if (!$checkoutId) {
        echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
        return;
    }

    if ($useDb) {
        $db = openDb($dbFile);
        if ($db) {
            if ($resultCode === 0) {
                $items     = $cb['CallbackMetadata']['Item'] ?? [];
                $mpesaCode = '';
                foreach ($items as $item) {
                    if ($item['Name'] === 'MpesaReceiptNumber') $mpesaCode = $item['Value'] ?? '';
                }
                $stmt = $db->prepare("UPDATE transactions SET status='COMPLETED', mpesa_code=? WHERE checkout_id = ?");
                $stmt->execute([$mpesaCode, $checkoutId]);
                addVotes($db, $checkoutId);
            } else {
                $status = ($resultCode === 1032) ? 'CANCELLED' : 'FAILED';
                $stmt = $db->prepare("UPDATE transactions SET status=? WHERE checkout_id = ?");
                $stmt->execute([$status, $checkoutId]);
            }
        }
    }

    echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
}

// ============================================================
// HELPERS
// ============================================================
function sanitizePhone($raw) {
    $p = preg_replace('/[\s\-]/', '', $raw);
    if (substr($p, 0, 1) === '0') $p = '254' . substr($p, 1);
    if (substr($p, 0, 1) === '+') $p = substr($p, 1);
    if (preg_match('/^254(7|1)\d{8}$/', $p)) return $p;
    return null;
}

function openDb($file) {
    try {
        $db = new PDO("sqlite:$file");
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->exec("
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
        ");
        return $db;
    } catch (Exception $e) {
        return null;
    }
}

function addVotes($db, $checkoutId) {
    // FIX: replaced raw $db->quote() string interpolation with prepared statement
    $stmt = $db->prepare("SELECT candidate_id, candidate_name, votes FROM transactions WHERE checkout_id = ?");
    $stmt->execute([$checkoutId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) return;

    $upsert = $db->prepare("
        INSERT INTO candidate_votes (candidate_id, candidate_name, total_votes)
        VALUES (?, ?, ?)
        ON CONFLICT(candidate_id) DO UPDATE SET total_votes = total_votes + ?
    ");
    $upsert->execute([
        $row['candidate_id'],
        $row['candidate_name'],
        (int)$row['votes'],
        (int)$row['votes'],
    ]);
}
