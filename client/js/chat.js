// ─── Chat Page Orchestrator ───────────────────────────────
import * as Socket from './socket.js';
import * as WebRTC from './webrtc.js';
import * as UI from './ui.js';

let state = 'idle';
let sessionTimer = null;
let sessionSeconds = 0;
let preferences = {};

const token = sessionStorage.getItem('knapp_token');
const walletAddress = sessionStorage.getItem('knapp_wallet');
if (!token || !walletAddress) {
  window.location.href = '/';
}

preferences = {
  gender: sessionStorage.getItem('knapp_gender') || 'any',
  genderPreference: sessionStorage.getItem('knapp_genderPref') || 'any'
};

async function init() {
  try {
    const stream = await WebRTC.getUserMedia();
    document.getElementById('local-video').srcObject = stream;
    Socket.connect();
    setupSocketListeners();
    setupControls();
    Socket.on('connected', () => Socket.authenticate(token));
  } catch (err) {
    console.error('Init failed:', err);
    UI.showToast('Camera/mic access required.', 'error', 5000);
  }
}

function setupSocketListeners() {
  Socket.on('authenticated', (data) => {
    UI.setMyReputation(data.reputation);
    UI.showToast('Connected! Click Next to find a stranger.', 'success');
    setState('idle');
  });
  Socket.on('auth-error', () => { sessionStorage.clear(); window.location.href = '/'; });
  Socket.on('queue-joined', () => setState('searching'));
  Socket.on('matched', async (data) => {
    setState('connected');
    UI.setPartnerReputation(data.partnerReputation);
    WebRTC.createPeerConnection({
      onIceCandidate: (c) => Socket.sendIceCandidate(c),
      onTrack: handleRemoteTrack,
      onConnectionStateChange: handleConnectionState
    });
    if (data.role === 'offerer') {
      const offer = await WebRTC.createOffer();
      Socket.sendOffer(offer);
    }
  });
  Socket.on('offer', async ({ offer }) => { Socket.sendAnswer(await WebRTC.handleOffer(offer)); });
  Socket.on('answer', async ({ answer }) => { await WebRTC.handleAnswer(answer); });
  Socket.on('ice-candidate', async ({ candidate }) => { await WebRTC.addIceCandidate(candidate); });
  Socket.on('stranger-disconnected', () => {
    setState('ended'); WebRTC.closePeerConnection();
    UI.showToast('Stranger disconnected', 'info'); clearRemoteVideo();
  });
  Socket.on('liked', () => UI.showToast('Someone liked you! 👍', 'success'));
  Socket.on('reputation-update', (data) => UI.setMyReputation(data.reputation));
  Socket.on('action-success', (data) => UI.showToast(data.message, 'success'));
  Socket.on('action-error', (data) => UI.showToast(data.error, 'error'));
}

function handleRemoteTrack(event) {
  const rv = document.getElementById('remote-video');
  if (event.streams && event.streams[0]) rv.srcObject = event.streams[0];
  UI.hidePlaceholder();
}

function handleConnectionState(s) {
  if (s === 'disconnected' || s === 'failed') {
    setState('ended'); UI.showToast('Connection lost', 'error'); clearRemoteVideo();
  }
}

function clearRemoteVideo() {
  document.getElementById('remote-video').srcObject = null;
  UI.showPlaceholder('Stranger disconnected. Click Next to continue.');
  UI.showSearchAnimation(false); UI.hidePartnerReputation();
}

function setState(newState) {
  state = newState;
  const map = {
    idle: () => { UI.setStatus('idle','Ready'); UI.showPlaceholder('Click "Next" to find a stranger'); UI.showSearchAnimation(false); UI.setActionsEnabled(false); UI.hidePartnerReputation(); stopTimer(); },
    searching: () => { UI.setStatus('searching','Searching...'); UI.showPlaceholder('Looking for a stranger...'); UI.showSearchAnimation(true); UI.setActionsEnabled(false); UI.hidePartnerReputation(); stopTimer(); },
    connected: () => { UI.setStatus('connected','Connected'); UI.setActionsEnabled(true); startTimer(); },
    ended: () => { UI.setStatus('ended','Disconnected'); UI.setActionsEnabled(false); stopTimer(); }
  };
  map[state]?.();
}

function startTimer() {
  sessionSeconds = 0; UI.updateTimer(0);
  sessionTimer = setInterval(() => { sessionSeconds++; UI.updateTimer(sessionSeconds); }, 1000);
}
function stopTimer() { if (sessionTimer) { clearInterval(sessionTimer); sessionTimer = null; } }

function setupControls() {
  document.getElementById('btn-mic').addEventListener('click', () => {
    const on = WebRTC.toggleMic();
    document.getElementById('btn-mic').classList.toggle('muted', !on);
    document.getElementById('mic-icon').textContent = on ? '🎤' : '🔇';
  });
  document.getElementById('btn-camera').addEventListener('click', () => {
    const on = WebRTC.toggleCamera();
    document.getElementById('btn-camera').classList.toggle('muted', !on);
    document.getElementById('camera-icon').textContent = on ? '📷' : '🚫';
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    WebRTC.closePeerConnection(); clearRemoteVideo(); Socket.next(preferences);
  });
  document.getElementById('btn-like').addEventListener('click', () => Socket.like());
  document.getElementById('btn-report').addEventListener('click', () => UI.showReportModal(true));
  document.querySelectorAll('.report-reason-btn').forEach(btn => {
    btn.addEventListener('click', () => { Socket.report(btn.dataset.reason); UI.showReportModal(false); });
  });
  document.getElementById('report-cancel-btn').addEventListener('click', () => UI.showReportModal(false));
}

init();
