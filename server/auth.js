// ─── Wallet-Based Auth (Stellar / Freighter) ──────────────
const { Keypair } = require('@stellar/stellar-sdk');
const crypto = require('crypto');

const sessions = new Map();     // token -> session data
const challenges = new Map();   // publicKey -> { challenge, expiresAt }

const CHALLENGE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a random challenge string for wallet signature verification.
 * The user signs this with their Stellar private key to prove ownership.
 */
function generateChallenge(publicKey) {
  const challenge = `knapp-auth-${crypto.randomBytes(32).toString('hex')}-${Date.now()}`;
  challenges.set(publicKey, {
    challenge,
    expiresAt: Date.now() + CHALLENGE_TTL
  });
  return challenge;
}

/**
 * Verify that a signature matches the challenge for the given public key.
 * Freighter's signMessage() prefixes the message with "Stellar Signed Message:\n",
 * then SHA-256 hashes the result, and signs the hash with ed25519.
 * We must reproduce that process here to verify.
 */
function verifyChallenge(publicKey, signature) {
  const stored = challenges.get(publicKey);
  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    challenges.delete(publicKey);
    return false;
  }

  try {
    const keypair = Keypair.fromPublicKey(publicKey);
    const signatureBuffer = Buffer.from(signature, 'base64');

    // Freighter signs SHA256("Stellar Signed Message:\n" + message)
    const SIGN_MESSAGE_PREFIX = 'Stellar Signed Message:\n';
    const prefixedMessage = SIGN_MESSAGE_PREFIX + stored.challenge;
    const messageHash = crypto.createHash('sha256').update(prefixedMessage, 'utf-8').digest();

    const valid = keypair.verify(messageHash, signatureBuffer);
    challenges.delete(publicKey);
    return valid;
  } catch (err) {
    console.error('Signature verification failed:', err.message);
    challenges.delete(publicKey);
    return false;
  }
}

/**
 * Get the stored challenge for a public key (used by custodial flow).
 */
function getChallenge(publicKey) {
  const stored = challenges.get(publicKey);
  if (!stored || Date.now() > stored.expiresAt) return null;
  return stored.challenge;
}

/**
 * Create a new session for an authenticated wallet.
 */
function createSession(publicKey, walletData = {}) {
  const token = crypto.randomUUID();
  sessions.set(token, {
    publicKey,
    token,
    wallet: walletData,
    isCustodial: walletData.isCustodial || false,
    createdAt: Date.now()
  });
  return token;
}

/**
 * Get session by token.
 */
function getSession(token) {
  return sessions.get(token) || null;
}

/**
 * Find a session by public key.
 */
function getSessionByPublicKey(publicKey) {
  for (const [, session] of sessions) {
    if (session.publicKey === publicKey) return session;
  }
  return null;
}

module.exports = {
  generateChallenge,
  verifyChallenge,
  getChallenge,
  createSession,
  getSession,
  getSessionByPublicKey,
  sessions
};
