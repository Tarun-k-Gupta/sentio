// ─── WebRTC Peer Connection Module ────────────────────────

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

let peerConnection = null;
let localStream = null;

/**
 * Get user media (camera + microphone).
 */
export async function getUserMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: true
    });
    return localStream;
  } catch (err) {
    console.error('Failed to get user media:', err);
    throw err;
  }
}

/**
 * Get current local stream.
 */
export function getLocalStream() {
  return localStream;
}

/**
 * Create a new RTCPeerConnection.
 * @param {Function} onIceCandidate - Called with ICE candidate
 * @param {Function} onTrack - Called with remote track event
 * @param {Function} onConnectionStateChange - Called with state
 */
export function createPeerConnection({ onIceCandidate, onTrack, onConnectionStateChange }) {
  closePeerConnection();

  peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  // ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && onIceCandidate) {
      onIceCandidate(event.candidate);
    }
  };

  // Remote tracks
  peerConnection.ontrack = (event) => {
    if (onTrack) onTrack(event);
  };

  // Connection state
  peerConnection.onconnectionstatechange = () => {
    if (onConnectionStateChange) {
      onConnectionStateChange(peerConnection.connectionState);
    }
  };

  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE state:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'failed') {
      peerConnection.restartIce();
    }
  };

  return peerConnection;
}

/**
 * Create an SDP offer.
 */
export async function createOffer() {
  if (!peerConnection) return null;
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  return offer;
}

/**
 * Handle an incoming SDP offer and create an answer.
 */
export async function handleOffer(offer) {
  if (!peerConnection) return null;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  return answer;
}

/**
 * Handle an incoming SDP answer.
 */
export async function handleAnswer(answer) {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

/**
 * Add an ICE candidate.
 */
export async function addIceCandidate(candidate) {
  if (!peerConnection) return;
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn('Failed to add ICE candidate:', err);
  }
}

/**
 * Close the peer connection.
 */
export function closePeerConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
}

/**
 * Toggle microphone on/off.
 */
export function toggleMic() {
  if (!localStream) return false;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    return audioTrack.enabled;
  }
  return false;
}

/**
 * Toggle camera on/off.
 */
export function toggleCamera() {
  if (!localStream) return false;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = !videoTrack.enabled;
    return videoTrack.enabled;
  }
  return false;
}
