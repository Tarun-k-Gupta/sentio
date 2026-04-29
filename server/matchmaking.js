// ─── Queue-based Random Matchmaking ────────────────────────
// Each entry: { socketId, publicKey, gender, genderPreference, reputation, joinedAt }

const queue = [];
const recentPartners = new Map(); // publicKey -> [recent partner publicKeys]

/**
 * Add a user to the matchmaking queue.
 * Low-reputation users are pushed to the end.
 */
function addToQueue(socketId, { publicKey, gender, genderPreference, reputation }) {
  // Remove if already in queue
  removeFromQueue(socketId);

  const entry = {
    socketId,
    publicKey,
    gender: gender || 'any',
    genderPreference: genderPreference || 'any',
    reputation: reputation || 50,
    joinedAt: Date.now()
  };

  // Low rep users go to the back of the queue
  if (reputation < 20) {
    queue.push(entry);
  } else {
    // Insert based on wait time (FIFO for normal rep users)
    queue.push(entry);
  }
}

/**
 * Remove a user from the queue.
 */
function removeFromQueue(socketId) {
  const idx = queue.findIndex(e => e.socketId === socketId);
  if (idx !== -1) queue.splice(idx, 1);
}

/**
 * Find a compatible match for the given socket.
 * Returns the matched queue entry or null.
 */
function findMatch(socketId) {
  const userIdx = queue.findIndex(e => e.socketId === socketId);
  if (userIdx === -1) return null;

  const user = queue[userIdx];
  const userRecent = recentPartners.get(user.publicKey) || [];

  for (let i = 0; i < queue.length; i++) {
    if (i === userIdx) continue;

    const candidate = queue[i];

    // Prevent immediate rematch with recent partners
    if (userRecent.includes(candidate.publicKey)) continue;
    const candidateRecent = recentPartners.get(candidate.publicKey) || [];
    if (candidateRecent.includes(user.publicKey)) continue;

    // Gender preference matching
    if (user.genderPreference !== 'any' && candidate.gender !== 'any' && candidate.gender !== user.genderPreference) continue;
    if (candidate.genderPreference !== 'any' && user.gender !== 'any' && user.gender !== candidate.genderPreference) continue;

    // Match found! Remove both from queue
    // Remove higher index first to avoid index shift
    const removeFirst = Math.max(userIdx, i);
    const removeSecond = Math.min(userIdx, i);
    queue.splice(removeFirst, 1);
    queue.splice(removeSecond, 1);

    return candidate;
  }

  return null;
}

/**
 * Get current queue size.
 */
function getQueueSize() {
  return queue.length;
}

module.exports = { addToQueue, removeFromQueue, findMatch, getQueueSize, recentPartners };
