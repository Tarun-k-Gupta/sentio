# Reputation Smart Contract (Soroban)

## Overview
This contract manages on-chain reputation scores for Knapp users.
Deployed on the Stellar testnet using Soroban.

## Contract Interface

```rust
#[contractimpl]
impl ReputationContract {
    /// Initialize the contract with admin
    pub fn init(env: Env, admin: Address) { }

    /// Like a user: +3 to their reputation (max 100)
    /// Requires auth from `from`. Prevents self-likes. 30s cooldown per pair.
    pub fn like(env: Env, from: Address, to: Address) -> i32 { }

    /// Report a user: -5 to their reputation (min 0)
    /// Requires auth from `from`. Prevents self-reports. 30s cooldown per pair.
    pub fn report(env: Env, from: Address, to: Address) -> i32 { }

    /// Get reputation score for a user (default: 50)
    pub fn get_reputation(env: Env, user: Address) -> i32 { }

    /// Get the admin address
    pub fn get_admin(env: Env) -> Address { }
}
```

## Storage
- `DataKey::Admin` → `Address` (instance storage)
- `DataKey::Reputation(Address)` → `i32` (persistent, score 0-100)
- `DataKey::LastAction(Address, Address)` → `u64` (temporary, cooldown tracking)
- Default score: 50 for new users

## Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli --features opt

# Configure testnet
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Generate deployer identity
stellar keys generate deployer --network testnet --fund
```

## Deployment

```bash
cd contracts/reputation
chmod +x deploy.sh
./deploy.sh
```

The script will:
1. Build the WASM binary
2. Deploy to Stellar testnet
3. Initialize the contract with admin
4. Output the contract ID

## After Deployment

Add the contract ID to your `.env` file:
```
SOROBAN_CONTRACT_ID=<contract_id_from_deploy>
ADMIN_SECRET_KEY=<stellar_keys_show_deployer>
```

Then restart the server: `npm run dev`
