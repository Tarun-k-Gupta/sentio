// ─── Reputation System (On-Chain + In-Memory Cache) ───────
// Uses Soroban contract when available, falls back to in-memory.
// In-memory cache provides fast reads; on-chain is source of truth.

const { Keypair } = require('@stellar/stellar-sdk');
const { likeOnChain, reportOnChain, getReputationOnChain } = require('./stellar');

const reputationCache = new Map(); // publicKey -> score
const custodialKeys = new Map();   // publicKey -> Keypair (for custodial wallets)

const DEFAULT_REPUTATION = 50;
const LIKE_BONUS = 3;
const REPORT_PENALTY = 5;
const MIN_REPUTATION = 0;
const MAX_REPUTATION = 100;

/**
 * Register a custodial keypair for on-chain transactions.
 */
function registerCustodialKey(publicKey, secret) {
  custodialKeys.set(publicKey, Keypair.fromSecret(secret));
}

/**
 * Get reputation score for a user.
 * Reads from cache first, falls back to on-chain.
 */
async function getReputation(publicKey) {
  if (!publicKey) return DEFAULT_REPUTATION;

  // Check cache first
  if (reputationCache.has(publicKey)) {
    return reputationCache.get(publicKey);
  }

  // Try on-chain
  const result = await getReputationOnChain(publicKey);
  const score = result.score ?? DEFAULT_REPUTATION;
  reputationCache.set(publicKey, score);
  return score;
}

/**
 * Get reputation synchronously from cache only.
 * Used for quick reads where async is inconvenient.
 */
function getReputationCached(publicKey) {
  if (!publicKey) return DEFAULT_REPUTATION;
  return reputationCache.get(publicKey) ?? DEFAULT_REPUTATION;
}

/**
 * Like a user: +LIKE_BONUS to their reputation.
 * Attempts on-chain transaction for custodial wallets.
 * Returns the new reputation score.
 */
async function likeUser(fromPublicKey, toPublicKey) {
  // Update cache immediately for responsive UI
  const current = getReputationCached(toPublicKey);
  const newRep = Math.min(MAX_REPUTATION, current + LIKE_BONUS);
  reputationCache.set(toPublicKey, newRep);

  // Try on-chain transaction (non-blocking for UX)
  const fromKeypair = custodialKeys.get(fromPublicKey);
  if (fromKeypair) {
    // Custodial wallet — server signs
    likeOnChain(fromKeypair, toPublicKey).then(result => {
      if (result.success && result.result != null) {
        reputationCache.set(toPublicKey, Number(result.result));
        console.log(`⛓️  On-chain like confirmed: ${toPublicKey} -> ${result.result}`);
      }
    }).catch(err => {
      console.log(`⚠️  On-chain like failed (cache updated): ${err.message}`);
    });
  } else {
    console.log(`ℹ️  Freighter user — on-chain like will be handled client-side`);
  }

  return newRep;
}

/**
 * Report a user: -REPORT_PENALTY to their reputation.
 * Attempts on-chain transaction for custodial wallets.
 * Returns the new reputation score.
 */
async function reportUser(fromPublicKey, toPublicKey, reason) {
  // Update cache immediately
  const current = getReputationCached(toPublicKey);
  const newRep = Math.max(MIN_REPUTATION, current - REPORT_PENALTY);
  reputationCache.set(toPublicKey, newRep);

  console.log(`📋 Report logged: ${fromPublicKey.slice(0, 8)}... → ${toPublicKey.slice(0, 8)}... | Reason: ${reason}`);

  // Try on-chain (non-blocking)
  const fromKeypair = custodialKeys.get(fromPublicKey);
  if (fromKeypair) {
    reportOnChain(fromKeypair, toPublicKey).then(result => {
      if (result.success && result.result != null) {
        reputationCache.set(toPublicKey, Number(result.result));
        console.log(`⛓️  On-chain report confirmed: ${toPublicKey} -> ${result.result}`);
      }
    }).catch(err => {
      console.log(`⚠️  On-chain report failed (cache updated): ${err.message}`);
    });
  }

  return newRep;
}

/**
 * Check if session duration meets minimum (30 seconds).
 */
function isSessionValid(sessionStartMs) {
  return (Date.now() - sessionStartMs) >= 30000;
}

module.exports = {
  getReputation,
  getReputationCached,
  likeUser,
  reportUser,
  isSessionValid,
  registerCustodialKey
};
