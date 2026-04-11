<?php
// ============================================================
// mpesa_stk.php — M-Pesa STK Push Initiator
// Presidential Annual Awards Voting System
// ============================================================

// ── Send JSON headers FIRST — before ANY output or errors ────
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// IMPORTANT: Turn OFF display_errors — PHP error HTML breaks JSON parsing in the browser
error_reporting(E_ALL);
ini_set('display_errors', 0);   // Must be 0 for a JSON API endpoint
ini_set('log_errors', 1);       // Errors go to server log instead

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ============================================================
// CONFIG — Fill in your Safaricom Daraja credentials
// Get them from: https://developer.safaricom.co.ke/
// ============================================================
$consumerKey    = "YOUR_CONSUMER_KEY";       // From Daraja portal
$consumerSecret = "YOUR_CONSUMER_SECRET";    // From Daraja portal
$shortcode      = "174379";                  // Sandbox: 174379 | Production: your paybill e.g. 4564811
$passkey        = "YOUR_PASSKEY";            // Lipa Na M-Pesa Online Passkey from Daraja
$callbackUrl    = "https://yourdomain.com/mpesa_callback.php"; // Public HTTPS URL — not localhost
$environment    = "sandbox";                 // "sandbox" or "production"

$baseUrl = ($environment === "production")
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

// ============================================================
// READ INPUT
// ============================================================
$raw  = file_get_contents("php://input");
$data = json_decode($raw, true);

if (!$data) {
    echo json_encode(["success" => false, "message" => "Invalid request — no JSON body received"]);
    exit;
}

// ── Route: manual confirmation fallback ──────────────────────
$action = $data['action'] ?? 'stk_push';

if ($action === 'manual_confirm') {
    $mpesaCode = strtoupper(trim($data['mpesaCode'] ?? ''));
    if (strlen($mpesaCode) < 8) {
        echo json_encode(["success" => false, "message" => "Invalid M-Pesa transaction code"]);
        exit;
    }
    // You can add DB update logic here if needed
    echo json_encode(["success" => true, "mpesaCode" => $mpesaCode]);
    exit;
}

// ── Extract STK Push fields ───────────────────────────────────
$phone         = trim($data['phone']         ?? '');
$amount        = (int)($data['amount']       ?? 0);
$candidateId   = $data['candidateId']        ?? '';
$candidateName = $data['candidateName']      ?? 'Candidate';
$voterName     = $data['voterName']          ?? '';
$votes         = (int)($data['votes']        ?? 1);

// ── Validate inputs ───────────────────────────────────────────
if (empty($phone)) {
    echo json_encode(["success" => false, "message" => "Phone number is required"]);
    exit;
}
if ($amount < 20) {
    echo json_encode(["success" => false, "message" => "Minimum amount is KES 20"]);
    exit;
}
if ($amount % 20 !== 0) {
    echo json_encode(["success" => false, "message" => "Amount must be a multiple of KES 20"]);
    exit;
}

// ── Normalise phone to 2547XXXXXXXX ──────────────────────────
$phone = preg_replace('/\D/', '', $phone);          // strip non-digits
if (substr($phone, 0, 1) === '0') {
    $phone = '254' . substr($phone, 1);             // 07XX → 2547XX
}
if (substr($phone, 0, 1) === '+') {
    $phone = ltrim($phone, '+');                    // +254 → 254
}

if (!preg_match('/^254(7|1)\d{8}$/', $phone)) {
    echo json_encode([
        "success" => false,
        "message" => "Invalid phone number. Use Safaricom format: 07XX XXX XXX or 01XX XXX XXX"
    ]);
    exit;
}

// ============================================================
// STEP 1 — Get OAuth Access Token from Safaricom
// ============================================================
$credentials = base64_encode("$consumerKey:$consumerSecret");

$ch = curl_init("$baseUrl/oauth/v1/generate?grant_type=client_credentials");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ["Authorization: Basic $credentials"],
    CURLOPT_SSL_VERIFYPEER => ($environment === 'production'),
    CURLOPT_TIMEOUT        => 15,
]);
$tokenRaw   = curl_exec($ch);
$tokenCurlErr = curl_error($ch);
curl_close($ch);

if ($tokenCurlErr || !$tokenRaw) {
    echo json_encode([
        "success" => false,
        "message" => "Cannot reach Safaricom servers. Check your internet connection."
    ]);
    exit;
}

$tokenData   = json_decode($tokenRaw, true);
$accessToken = $tokenData['access_token'] ?? null;

if (!$accessToken) {
    $detail = $tokenData['error_description'] ?? $tokenData['errorMessage'] ?? 'Check Consumer Key & Secret';
    echo json_encode(["success" => false, "message" => "M-Pesa authentication failed: $detail"]);
    exit;
}

// ============================================================
// STEP 2 — Build & Send STK Push Request
// ============================================================
$timestamp = date("YmdHis");
$password  = base64_encode($shortcode . $passkey . $timestamp);

// Safaricom limits: AccountReference ≤ 12 chars, TransactionDesc ≤ 13 chars
$accountRef  = substr('Vote-' . preg_replace('/[^a-zA-Z0-9]/', '', $candidateName), 0, 12);
$description = substr("Vote $candidateName", 0, 13);

$stkBody = [
    "BusinessShortCode" => $shortcode,
    "Password"          => $password,
    "Timestamp"         => $timestamp,
    "TransactionType"   => "CustomerPayBillOnline",
    "Amount"            => $amount,
    "PartyA"            => $phone,
    "PartyB"            => $shortcode,
    "PhoneNumber"       => $phone,
    "CallBackURL"       => $callbackUrl,
    "AccountReference"  => $accountRef ?: 'Vote',
    "TransactionDesc"   => $description ?: 'Vote',
];

$ch = curl_init("$baseUrl/mpesa/stkpush/v1/processrequest");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($stkBody),
    CURLOPT_HTTPHEADER     => [
        "Content-Type: application/json",
        "Authorization: Bearer $accessToken",
    ],
    CURLOPT_SSL_VERIFYPEER => ($environment === 'production'),
    CURLOPT_TIMEOUT        => 30,
]);

$stkRaw    = curl_exec($ch);
$stkCurlErr= curl_error($ch);
$httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($stkCurlErr) {
    echo json_encode(["success" => false, "message" => "STK Push curl error: $stkCurlErr"]);
    exit;
}

$res = json_decode($stkRaw, true);

// ============================================================
// STEP 3 — Return result to vote.js
// ResponseCode "0" = STK sent successfully
// ============================================================
if (isset($res['CheckoutRequestID']) && ($res['ResponseCode'] ?? '') === '0') {

    echo json_encode([
        "success"           => true,
        "checkoutRequestId" => $res['CheckoutRequestID'],
        "message"           => "M-Pesa prompt sent. Check your phone and enter your PIN.",
    ]);

} else {

    // Surface a readable error to the frontend
    $errMsg = $res['errorMessage']
        ?? $res['ResponseDescription']
        ?? $res['ResultDesc']
        ?? "STK Push failed (HTTP $httpCode). Check your credentials and callback URL.";

    echo json_encode([
        "success" => false,
        "message" => $errMsg,
        // Remove 'debug' key in production:
        "debug"   => [
            "httpCode"    => $httpCode,
            "safaricomResponse" => $res,
        ],
    ]);
}
