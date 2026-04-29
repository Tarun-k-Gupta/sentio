// ─── Stellar / Freighter Integration ──────────────────────
// Handles wallet connection, message signing, and Soroban interaction.
// Uses the @stellar/freighter-api npm package (v6+).

import {
  isConnected,
  isAllowed,
  requestAccess,
  getAddress,
  getNetwork,
  signMessage,
  signTransaction as freighterSignTransaction
} from '@stellar/freighter-api';

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve
 * within the given time, it rejects with a TimeoutError.
 */
function withTimeout(promise, ms, label = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    )
  ]);
}

/**
 * Check if Freighter wallet extension is available.
 * Uses the official @stellar/freighter-api isConnected() method.
 * @returns {Promise<boolean>}
 */
export async function isFreighterAvailable() {
  try {
    const result = await isConnected();
    // isConnected returns { isConnected: boolean }
    return result.isConnected === true;
  } catch (err) {
    console.log('Freighter detection failed:', err);
    return false;
  }
}

/**
 * Connect to Freighter wallet.
 * Requests access and returns the public key.
 * @returns {Promise<string|null>} Public key or null on failure
 */
export async function connectFreighter() {
  const available = await isFreighterAvailable();
  if (!available) {
    console.log('Freighter not installed or not connected');
    return null;
  }

  try {
    // Request access to the user's Freighter wallet (60s timeout for user approval)
    const accessResult = await withTimeout(requestAccess(), 60000, 'Freighter access request');
    if (accessResult.error) {
      console.error('Freighter access denied:', accessResult.error);
      return null;
    }

    // Get the public key
    const addressResult = await withTimeout(getAddress(), 10000, 'Freighter getAddress');
    if (addressResult.error) {
      console.error('Failed to get address:', addressResult.error);
      return null;
    }

    const publicKey = addressResult.address;
    console.log('🔗 Freighter connected:', publicKey.slice(0, 8) + '...');

    // Ensure we're on testnet
    const networkResult = await withTimeout(getNetwork(), 10000, 'Freighter getNetwork');
    if (networkResult.network !== 'TESTNET') {
      console.warn('⚠️  Freighter is not on TESTNET. Please switch to testnet.');
    }

    return publicKey;
  } catch (err) {
    console.error('Freighter connection failed:', err);
    return null;
  }
}

/**
 * Sign a challenge string with Freighter.
 * Used for wallet authentication.
 * 
 * Uses signMessage which signs an arbitrary string.
 * Freighter prefixes with "Stellar Signed Message:\n" before SHA-256 hashing
 * and signing with ed25519.
 * 
 * @param {string} challenge - The challenge string to sign
 * @param {string} publicKey - The user's public key
 * @returns {Promise<string|null>} Base64 encoded signature or null
 */
export async function signChallenge(challenge, publicKey) {
  const available = await isFreighterAvailable();
  if (!available) return null;

  try {
    const result = await withTimeout(
      signMessage(challenge, { address: publicKey }),
      60000,
      'Freighter sign message'
    );

    if (result.error) {
      console.error('Challenge signing failed:', result.error);
      return null;
    }

    console.log('✅ Challenge signed');
    return result.signedMessage;
  } catch (err) {
    console.error('Signing error:', err);
    return null;
  }
}

/**
 * Sign a Soroban transaction XDR with Freighter.
 * Used for on-chain reputation transactions (non-custodial wallets).
 *
 * @param {string} txXdr - Transaction XDR to sign
 * @returns {Promise<string|null>} Signed transaction XDR or null
 */
export async function signTransaction(txXdr) {
  const available = await isFreighterAvailable();
  if (!available) return null;

  try {
    const addressResult = await getAddress();
    const result = await freighterSignTransaction(txXdr, {
      networkPassphrase: 'Test SDF Network ; September 2015',
      address: addressResult.address
    });

    if (result.error) {
      console.error('Transaction signing failed:', result.error);
      return null;
    }

    return result.signedTxXdr;
  } catch (err) {
    console.error('TX signing error:', err);
    return null;
  }
}

/**
 * Display wallet info in the UI.
 */
export function displayWalletInfo(publicKey) {
  const short = publicKey.slice(0, 6) + '...' + publicKey.slice(-4);
  console.log(`💳 Wallet: ${short}`);
  return short;
}
