<?php
// ================================
// DEBUG (REMOVE IN PRODUCTION)
// ================================
error_reporting(E_ALL);
ini_set('display_errors', 1);

// ================================
// CONFIG (EDIT THESE)
// ================================
$consumerKey    = "YOUR_CONSUMER_KEY";
$consumerSecret = "YOUR_CONSUMER_SECRET";
$shortcode      = "174379"; // or your paybill (e.g. 4564811)
$passkey        = "YOUR_PASSKEY";
$callbackUrl    = "https://yourdomain.com/callback.php"; // MUST be public (not localhost)

// ================================
// GET JSON INPUT
// ================================
$data = json_decode(file_get_contents("php://input"), true);

$phone  = $data['phone'] ?? '';
$amount = $data['amount'] ?? 0;

// ================================
// FORMAT PHONE (2547XXXXXXXX)
// ================================
$phone = preg_replace('/\D/', '', $phone);

if (substr($phone, 0, 1) == "0") {
    $phone = "254" . substr($phone, 1);
}

// ================================
// GET ACCESS TOKEN
// ================================
$credentials = base64_encode($consumerKey . ":" . $consumerSecret);

$ch = curl_init("https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials");
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Authorization: Basic $credentials"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
$result   = json_decode($response);

$access_token = $result->access_token ?? null;

if (!$access_token) {
    echo json_encode([
        "success" => false,
        "message" => "Failed to get access token"
    ]);
    exit;
}

// ================================
// STK PUSH REQUEST
// ================================
$timestamp = date("YmdHis");
$password  = base64_encode($shortcode . $passkey . $timestamp);

$stkData = [
    "BusinessShortCode" => $shortcode,
    "Password"          => $password,
    "Timestamp"         => $timestamp,
    "TransactionType"   => "CustomerPayBillOnline",
    "Amount"            => $amount,
    "PartyA"            => $phone,
    "PartyB"            => $shortcode,
    "PhoneNumber"       => $phone,
    "CallBackURL"       => $callbackUrl,
    "AccountReference"  => "Vote",
    "TransactionDesc"   => "Voting Payment"
];

$ch = curl_init("https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest");

curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Content-Type: application/json",
    "Authorization: Bearer $access_token"
]);

curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($stkData));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
$res      = json_decode($response, true);

// ================================
// RESPONSE BACK TO JS
// ================================
if (isset($res['CheckoutRequestID'])) {
    echo json_encode([
        "success" => true,
        "checkoutRequestId" => $res['CheckoutRequestID']
    ]);
} else {
    echo json_encode([
        "success" => false,
        "message" => $res['errorMessage'] ?? "STK Push failed"
    ]);
}
