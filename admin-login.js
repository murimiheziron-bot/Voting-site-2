/* ═══════════════════════════════════════════════════
   PRESIDENTIAL ANNUAL AWARDS — admin-login.js
   Logic for the admin login page
═══════════════════════════════════════════════════ */

'use strict';

/* Redirect immediately if already logged in */
if (Auth.isLoggedIn()) {
  window.location.href = 'admin.html';
}

/* ── DOM refs ── */
const usernameInput = document.getElementById('admin-username');
const passwordInput = document.getElementById('admin-password');
const loginBtn      = document.getElementById('login-btn');
const loginError    = document.getElementById('login-error');

/* ── Attempt login ── */
function attemptLogin() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  loginError.classList.remove('visible');

  if (!username || !password) {
    Toast.show('Please enter both username and password.', '⚠️');
    return;
  }

  loginBtn.disabled    = true;
  loginBtn.textContent = 'Verifying…';

  // Small delay for UX feel
  setTimeout(() => {
    if (Auth.login(username, password)) {
      Toast.show('Login successful. Redirecting…', '✅');
      setTimeout(() => {
        window.location.href = 'admin.html';
      }, 700);
    } else {
      loginError.classList.add('visible');
      passwordInput.value  = '';
      loginBtn.disabled    = false;
      loginBtn.textContent = 'Enter Dashboard →';
      passwordInput.focus();
    }
  }, 600);
}

/* ── Event listeners ── */
document.addEventListener('DOMContentLoaded', () => {
  loginBtn.addEventListener('click', attemptLogin);

  // Allow Enter key from either input
  [usernameInput, passwordInput].forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attemptLogin();
    });
  });

  // Auto-focus username
  usernameInput.focus();
});
