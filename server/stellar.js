// ─── Stellar Wallet & Soroban Contract Service ────────────
const {
  Keypair,
  Networks,
  TransactionBuilder,
  SorobanRpc,
  Contract,
  Address,
  nativeToScVal,
  xdr,
  BASE_FEE
} = require('@stellar/stellar-sdk');

const SOROBAN_RPC_URL = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL = process.env.FRIENDBOT_URL || 'https://friendbot.stellar.org';
const NETWORK_PASSPHRASE = Networks.TESTNET;
const CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID || '';

const server = new SorobanRpc.Server(SOROBAN_RPC_URL);

/**
 * Create a new custodial Stellar wallet.
 * Returns { publicKey, secret }.
 * Funding via Friendbot is attempted but non-blocking for MVP.
 */
async function createCustodialWallet() {
  const pair = Keypair.random();
  const publicKey = pair.publicKey();
  const secret = pair.secret();

  // Fund on testnet via Friendbot (non-blocking)
  try {
    const response = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
    if (response.ok) {
      console.log(`💰 Wallet funded on testnet: ${publicKey}`);
    } else {
      console.log(`⚠️  Friendbot funding failed for ${publicKey} (non-blocking)`);
    }
  } catch (err) {
    console.log(`⚠️  Friendbot unavailable (non-blocking): ${err.message}`);
  }

  return { publicKey, secret, isCustodial: true };
}

/**
 * Get wallet info (balance check).
 */
async function getWalletInfo(publicKey) {
  try {
    const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (response.ok) {
      const data = await response.json();
      const xlmBalance = data.balances.find(b => b.asset_type === 'native');
      return { publicKey, balance: xlmBalance ? xlmBalance.balance : '0' };
    }
  } catch (err) {
    console.log(`⚠️  Could not fetch wallet info: ${err.message}`);
  }
  return { publicKey, balance: '0' };
}

// ─── Soroban Contract Interaction ─────────────────────────

/**
 * Build, simulate, and submit a Soroban contract invocation.
 * Used for like() and report() calls.
 *
 * @param {string} method - Contract method name ('like' or 'report')
 * @param {Keypair} fromKeypair - The caller's keypair (for custodial) 
 * @param {string} toPublicKey - The target user's public key
 * @returns {Promise<{success: boolean, result: any, txHash: string}>}
 */
async function invokeContract(method, fromKeypair, toPublicKey) {
  if (!CONTRACT_ID) {
    console.log(`⚠️  No contract ID configured. Using in-memory fallback.`);
    return { success: false, result: null, txHash: null, fallback: true };
  }

  try {
    const fromPublicKey = fromKeypair.publicKey();

    // Load the source account
    const account = await server.getAccount(fromPublicKey);

    // Build the contract call
    const contract = new Contract(CONTRACT_ID);

    const fromAddress = new Address(fromPublicKey);
    const toAddress = new Address(toPublicKey);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(
        contract.call(
          method,
          fromAddress.toScVal(),
          toAddress.toScVal()
        )
      )
      .setTimeout(30)
      .build();

    // Simulate first
    const simulated = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simulated)) {
      console.error(`❌ Simulation error for ${method}:`, simulated.error);
      return { success: false, result: null, txHash: null, error: simulated.error };
    }

    // Prepare and sign
    const preparedTx = SorobanRpc.assembleTransaction(tx, simulated).build();
    preparedTx.sign(fromKeypair);

    // Submit
    const sendResponse = await server.sendTransaction(preparedTx);

    if (sendResponse.status === 'ERROR') {
      console.error(`❌ Transaction send error for ${method}:`, sendResponse);
      return { success: false, result: null, txHash: null, error: 'Send failed' };
    }

    // Wait for confirmation
    let getResponse;
    let attempts = 0;
    do {
      await new Promise(r => setTimeout(r, 1000));
      getResponse = await server.getTransaction(sendResponse.hash);
      attempts++;
    } while (getResponse.status === 'NOT_FOUND' && attempts < 30);

    if (getResponse.status === 'SUCCESS') {
      // Extract the return value (i32 reputation score)
      let resultValue = null;
      if (getResponse.returnValue) {
        resultValue = getResponse.returnValue.value();
      }

      console.log(`⛓️  ${method} tx confirmed: ${sendResponse.hash} (result: ${resultValue})`);
      return {
        success: true,
        result: resultValue,
        txHash: sendResponse.hash
      };
    } else {
      console.error(`❌ Transaction failed for ${method}:`, getResponse);
      return { success: false, result: null, txHash: sendResponse.hash, error: 'TX failed' };
    }
  } catch (err) {
    console.error(`❌ Contract invocation error (${method}):`, err.message);
    return { success: false, result: null, txHash: null, error: err.message };
  }
}

/**
 * Like a user on-chain.
 */
async function likeOnChain(fromKeypair, toPublicKey) {
  return invokeContract('like', fromKeypair, toPublicKey);
}

/**
 * Report/dislike a user on-chain.
 */
async function reportOnChain(fromKeypair, toPublicKey) {
  return invokeContract('report', fromKeypair, toPublicKey);
}

/**
 * Get reputation from on-chain.
 */
async function getReputationOnChain(publicKey) {
  if (!CONTRACT_ID) {
    return { success: false, score: 50, fallback: true };
  }

  try {
    const contract = new Contract(CONTRACT_ID);
    const userAddress = new Address(publicKey);

    // Use a random keypair to build a read-only transaction
    const tempKeypair = Keypair.random();
    let tempAccount;
    try {
      tempAccount = await server.getAccount(tempKeypair.publicKey());
    } catch {
      // For read-only calls, we can simulate without a real account
      // Use a dummy account
      const dummyKeypair = Keypair.random();
      await fetch(`${FRIENDBOT_URL}?addr=${dummyKeypair.publicKey()}`);
      tempAccount = await server.getAccount(dummyKeypair.publicKey());
    }

    const tx = new TransactionBuilder(tempAccount, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(
        contract.call('get_reputation', userAddress.toScVal())
      )
      .setTimeout(30)
      .build();

    const simulated = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationSuccess(simulated) && simulated.result) {
      const retVal = simulated.result.retval;
      const score = retVal.value();
      return { success: true, score: Number(score) };
    }

    return { success: false, score: 50 };
  } catch (err) {
    console.log(`⚠️  Could not read on-chain reputation: ${err.message}`);
    return { success: false, score: 50 };
  }
}

module.exports = {
  createCustodialWallet,
  getWalletInfo,
  likeOnChain,
  reportOnChain,
  getReputationOnChain
};
