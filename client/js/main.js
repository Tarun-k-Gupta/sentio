// ─── Landing Page Logic — Wallet Connect ──────────────────
import * as Stellar from './stellar.js';

const API_BASE = import.meta.env.VITE_API_URL || '';

let userToken = null;
let userGender = 'any';
let genderPreference = 'any';

// ─── DOM refs ───
const authStepWallet = document.getElementById('auth-step-wallet');
const authStepReady = document.getElementById('auth-step-ready');
const connectFreighterBtn = document.getElementById('connect-freighter-btn');
const createCustodialBtn = document.getElementById('create-custodial-btn');
const freighterStatus = document.getElementById('freighter-status');
const startChatBtn = document.getElementById('start-chat-btn');
const disconnectBtn = document.getElementById('disconnect-wallet-btn');
const authError = document.getElementById('auth-error');
const userWalletDisplay = document.getElementById('user-wallet-display');
const userRepDisplay = document.getElementById('user-rep-display');
const userRepBar = document.getElementById('user-rep-bar');
const walletTypeBadge = document.getElementById('wallet-type-badge');

// ─── Step transitions ───
function showStep(step) {
  [authStepWallet, authStepReady].forEach(s => s.classList.remove('active'));
  step.classList.add('active');
}

function showError(msg) {
  authError.textContent = msg;
  setTimeout(() => { authError.textContent = ''; }, 5000);
}

function setLoading(btn, loading) {
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function displayWallet(publicKey, reputation, isCustodial) {
  const short = publicKey.slice(0, 6) + '...' + publicKey.slice(-6);
  userWalletDisplay.textContent = short;
  userRepDisplay.textContent = reputation;
  userRepBar.style.width = `${reputation}%`;

  if (isCustodial) {
    walletTypeBadge.textContent = 'Custodial';
    walletTypeBadge.classList.add('custodial');
  } else {
    walletTypeBadge.textContent = 'Freighter';
    walletTypeBadge.classList.remove('custodial');
  }
}

// ─── Detect Freighter ───
let freighterDetected = false;

async function detectFreighter() {
  // Poll a few times — extensions can take a moment to initialize
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(r => setTimeout(r, 400));
    const available = await Stellar.isFreighterAvailable();
    if (available) {
      freighterDetected = true;
      freighterStatus.textContent = '✓ Freighter detected';
      freighterStatus.classList.remove('not-detected');
      freighterStatus.classList.add('detected');
      connectFreighterBtn.disabled = false;
      return;
    }
  }

  // Not found after all attempts
  freighterStatus.textContent = 'Freighter not detected — click to install';
  freighterStatus.classList.add('not-detected');
  connectFreighterBtn.disabled = false; // allow click to open install page
}

// ─── Connect Freighter ───
connectFreighterBtn.addEventListener('click', async () => {
  // Re-check at click time in case extension loaded late
  const available = await Stellar.isFreighterAvailable();
  if (!available) {
    window.open('https://www.freighter.app/', '_blank');
    showError('Please install the Freighter extension and refresh the page.');
    return;
  }

  setLoading(connectFreighterBtn, true);
  try {
    // Step 1: Get public key from Freighter
    const publicKey = await Stellar.connectFreighter();
    if (!publicKey) {
      showError('Failed to connect Freighter. Please try again.');
      return;
    }

    // Step 2: Get challenge from server
    const challengeRes = await fetch(`${API_BASE}/api/auth/challenge?pubkey=${publicKey}`);
    const challengeData = await challengeRes.json();
    if (!challengeData.success) {
      showError('Failed to get auth challenge');
      return;
    }

    // Step 3: Sign the challenge with Freighter
    const signature = await Stellar.signChallenge(challengeData.challenge, publicKey);
    if (!signature) {
      showError('Signature rejected or failed');
      return;
    }

    // Step 4: Verify with server
    const verifyRes = await fetch(`${API_BASE}/api/auth/verify-wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey, signature })
    });
    const verifyData = await verifyRes.json();

    if (verifyData.success) {
      userToken = verifyData.token;
      sessionStorage.setItem('knapp_token', userToken);
      sessionStorage.setItem('knapp_wallet', publicKey);
      sessionStorage.setItem('knapp_custodial', 'false');

      displayWallet(publicKey, verifyData.reputation, false);
      showStep(authStepReady);
    } else {
      showError(verifyData.error || 'Wallet verification failed');
    }
  } catch (err) {
    console.error('Freighter connect error:', err);
    showError('Service temporarily unavailable. Please try again later.');
  } finally {
    setLoading(connectFreighterBtn, false);
  }
});

// ─── Create Custodial Wallet ───
createCustodialBtn.addEventListener('click', async () => {
  setLoading(createCustodialBtn, true);
  try {
    const res = await fetch(`${API_BASE}/api/auth/create-custodial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (data.success) {
      userToken = data.token;
      sessionStorage.setItem('knapp_token', userToken);
      sessionStorage.setItem('knapp_wallet', data.wallet.publicKey);
      sessionStorage.setItem('knapp_custodial', 'true');

      displayWallet(data.wallet.publicKey, data.reputation, true);
      showStep(authStepReady);
    } else {
      showError(data.error || 'Failed to create wallet');
    }
  } catch (err) {
    console.error('Custodial wallet error:', err);
    showError('Service temporarily unavailable. Please try again later.');
  } finally {
    setLoading(createCustodialBtn, false);
  }
});

// ─── Gender toggle groups ───
document.querySelectorAll('.toggle-group').forEach(group => {
  group.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (group.id === 'gender-select') userGender = btn.dataset.value;
      if (group.id === 'gender-pref-select') genderPreference = btn.dataset.value;
    });
  });
});

// ─── Start Chat ───
startChatBtn.addEventListener('click', () => {
  sessionStorage.setItem('knapp_gender', userGender);
  sessionStorage.setItem('knapp_genderPref', genderPreference);
  window.location.href = '/chat.html';
});

// ─── Disconnect Wallet ───
disconnectBtn.addEventListener('click', () => {
  sessionStorage.clear();
  userToken = null;
  showStep(authStepWallet);
});

// ─── Check existing session ───
(async function checkSession() {
  const token = sessionStorage.getItem('knapp_token');
  if (!token) {
    detectFreighter();
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/session`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      userToken = token;
      displayWallet(data.publicKey, data.reputation, data.isCustodial);
      showStep(authStepReady);
    } else {
      // Invalid session, clear and show wallet connect
      sessionStorage.clear();
      detectFreighter();
    }
  } catch (e) {
    detectFreighter();
  }
})();
