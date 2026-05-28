/* auth.js — Auth modal logic */

const SESSION_KEY = 'rangmudra_session';

function isLoggedIn() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!session) return false;
    return Date.now() < session.expiresAt;
  } catch {
    return false;
  }
}

function getUser() {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!session || Date.now() >= session.expiresAt) return null;
    return { phone: session.phone, token: session.token };
  } catch {
    return null;
  }
}

function saveSession(phone, token) {
  const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ phone, token, expiresAt }));
  window.dispatchEvent(new CustomEvent('auth-changed', { detail: { loggedIn: true } }));
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new CustomEvent('auth-changed', { detail: { loggedIn: false } }));
  window.location.href = 'index.html';
}

function openAuthModal(onSuccess) {
  const backdrop = document.getElementById('auth-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (onSuccess) backdrop._onSuccess = onSuccess;

  const phoneInput = document.getElementById('phone-input');
  if (phoneInput) setTimeout(() => phoneInput.focus(), 100);
}

function closeAuthModal() {
  const backdrop = document.getElementById('auth-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
  backdrop._onSuccess = null;
  showScreen('a');
}

function showScreen(screen) {
  const a = document.getElementById('auth-screen-a');
  const b = document.getElementById('auth-screen-b');
  if (!a || !b) return;
  if (screen === 'a') {
    a.style.display = 'block'; b.style.display = 'none';
  } else {
    a.style.display = 'none'; b.style.display = 'block';
  }
}

function validatePhone(phone) {
  const stripped = phone.replace(/[\s\-\(\)]/g, '');
  return /^\d{7,15}$/.test(stripped);
}

function formatPhone(countryCode, phone) {
  return `${countryCode} ${phone.replace(/[\s\-\(\)]/g, '')}`;
}

let resendTimer = null;
let failedAttempts = 0;

function startResendCountdown() {
  const timerEl = document.getElementById('resend-timer');
  const countdownEl = document.getElementById('resend-countdown');
  const resendBtn = document.getElementById('resend-btn');
  if (!timerEl || !countdownEl || !resendBtn) return;

  let seconds = 30;
  timerEl.style.display = 'inline';
  resendBtn.style.display = 'none';
  countdownEl.textContent = seconds;

  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    seconds--;
    countdownEl.textContent = seconds;
    if (seconds <= 0) {
      clearInterval(resendTimer);
      timerEl.style.display = 'none';
      resendBtn.style.display = 'inline';
    }
  }, 1000);
}

function initAuthModal() {
  const backdrop = document.getElementById('auth-modal-backdrop');
  if (!backdrop) return;

  const phoneInput = document.getElementById('phone-input');
  const continueBtn = document.getElementById('continue-btn');
  const verifyBtn = document.getElementById('verify-btn');
  const backBtn = document.getElementById('auth-back-btn');
  const closeA = document.getElementById('auth-close-a');
  const closeB = document.getElementById('auth-close-b');
  const phoneError = document.getElementById('phone-error');
  const otpError = document.getElementById('otp-error');
  const otpSubtext = document.getElementById('otp-subtext');
  const resendBtn = document.getElementById('resend-btn');

  let selectedCode = '+91';

  if (closeA) closeA.addEventListener('click', closeAuthModal);
  if (closeB) closeB.addEventListener('click', closeAuthModal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeAuthModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeAuthModal();
  });

  if (phoneInput) {
    phoneInput.addEventListener('input', () => {
      const valid = validatePhone(phoneInput.value);
      if (continueBtn) continueBtn.disabled = !valid;
      if (phoneError) phoneError.style.display = 'none';
    });

    phoneInput.addEventListener('blur', () => {
      if (phoneInput.value && !validatePhone(phoneInput.value)) {
        if (phoneError) {
          phoneError.textContent = 'Please enter a valid phone number';
          phoneError.style.display = 'block';
        }
      }
    });
  }

  if (continueBtn) {
    continueBtn.addEventListener('click', async () => {
      if (!validatePhone(phoneInput.value)) return;
      continueBtn.textContent = '...';
      continueBtn.disabled = true;

      await new Promise(r => setTimeout(r, 400));

      const formatted = formatPhone(selectedCode, phoneInput.value);
      if (otpSubtext) {
        otpSubtext.innerHTML = `We've sent a 6-digit code to <strong>${formatted}</strong> <button id="edit-phone-btn" style="color:var(--pr-b2);text-decoration:underline;background:none;border:none;cursor:pointer;font-size:inherit;letter-spacing:inherit;font-family:inherit;">Edit</button>`;
        document.getElementById('edit-phone-btn')?.addEventListener('click', () => showScreen('a'));
      }

      showScreen('b');
      failedAttempts = 0;
      startResendCountdown();

      const firstBox = document.querySelector('.otp-box');
      if (firstBox) setTimeout(() => firstBox.focus(), 100);

      continueBtn.textContent = 'CONTINUE';
      continueBtn.disabled = false;
    });
  }

  if (backBtn) backBtn.addEventListener('click', () => showScreen('a'));

  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      const boxes = document.querySelectorAll('.otp-box');
      const otp = [...boxes].map(b => b.value).join('');
      if (otp.length !== 6) return;

      verifyBtn.textContent = '...';
      verifyBtn.disabled = true;
      await new Promise(r => setTimeout(r, 600));

      /* Mock: any 6-digit code works except 000000 */
      if (otp === '000000') {
        failedAttempts++;
        boxes.forEach(b => b.classList.add('error'));
        const grid = document.getElementById('otp-grid');
        if (grid) { grid.classList.add('shake'); setTimeout(() => grid.classList.remove('shake'), 1000); }
        if (otpError) {
          if (failedAttempts >= 3) {
            otpError.textContent = 'Too many attempts. Please wait 60s.';
            verifyBtn.disabled = true;
            setTimeout(() => { verifyBtn.disabled = false; otpError.style.display = 'none'; }, 60000);
          } else {
            otpError.textContent = 'Incorrect code. Please try again.';
          }
          otpError.style.display = 'block';
        }
        boxes.forEach(b => { b.value = ''; b.classList.remove('error'); });
        if (boxes[0]) boxes[0].focus();
      } else {
        boxes.forEach(b => b.classList.add('success'));
        await new Promise(r => setTimeout(r, 400));

        saveSession(phoneInput?.value || '', 'mock_token_' + Date.now());
        closeAuthModal();

        const onSuccess = backdrop._onSuccess;
        if (onSuccess) onSuccess();
        else window.location.href = 'profile.html';
      }

      verifyBtn.textContent = 'VERIFY';
      if (otp !== '000000' || failedAttempts < 3) verifyBtn.disabled = false;
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener('click', () => {
      const boxes = document.querySelectorAll('.otp-box');
      boxes.forEach(b => { b.value = ''; b.classList.remove('error', 'success'); });
      if (otpError) otpError.style.display = 'none';
      startResendCountdown();
    });
  }

  /* Profile button wiring */
  const profileBtn = document.getElementById('profile-btn');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => {
      if (isLoggedIn()) {
        window.location.href = 'profile.html';
      } else {
        openAuthModal();
      }
    });
  }
}

export { isLoggedIn, getUser, saveSession, logout, openAuthModal, closeAuthModal, initAuthModal };
