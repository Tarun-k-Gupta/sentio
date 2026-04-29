#!/bin/bash
# ─── Knapp Reputation Contract Deployment ──────────────────
# Deploy the Soroban reputation contract to Stellar testnet.
#
# Prerequisites:
#   1. Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
#   2. Add WASM target: rustup target add wasm32-unknown-unknown
#   3. Install Stellar CLI: cargo install --locked stellar-cli --features opt
#   4. Configure testnet:
#      stellar network add testnet \
#        --rpc-url https://soroban-testnet.stellar.org \
#        --network-passphrase "Test SDF Network ; September 2015"
#   5. Generate a deployer identity (or use existing):
#      stellar keys generate deployer --network testnet --fund
#
# Usage:
#   cd contracts/reputation
#   chmod +x deploy.sh
#   ./deploy.sh

set -e

echo "═══════════════════════════════════════════════════════"
echo "  Knapp Reputation Contract — Deployment Script"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Build ─────────────────────────────────────────
echo "📦 Step 1: Building the contract..."
stellar contract build
echo "✅ Build complete!"
echo ""

# ─── Step 2: Optimize WASM ─────────────────────────────────
echo "🔧 Step 2: Optimizing WASM..."
WASM_PATH="target/wasm32-unknown-unknown/release/reputation.wasm"
if [ ! -f "$WASM_PATH" ]; then
  echo "❌ WASM file not found at $WASM_PATH"
  exit 1
fi
echo "   WASM size: $(wc -c < "$WASM_PATH") bytes"
echo ""

# ─── Step 3: Deploy ────────────────────────────────────────
echo "🚀 Step 3: Deploying to testnet..."
CONTRACT_ID=$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source deployer \
  --network testnet)

echo "✅ Deployed! Contract ID:"
echo "   $CONTRACT_ID"
echo ""

# ─── Step 4: Initialize ───────────────────────────────────
echo "🔑 Step 4: Initializing contract..."
ADMIN_ADDRESS=$(stellar keys address deployer)

stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source deployer \
  --network testnet \
  -- \
  init \
  --admin "$ADMIN_ADDRESS"

echo "✅ Contract initialized with admin: $ADMIN_ADDRESS"
echo ""

# ─── Step 5: Verify ───────────────────────────────────────
echo "🔍 Step 5: Verifying deployment..."
REP=$(stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source deployer \
  --network testnet \
  -- \
  get_reputation \
  --user "$ADMIN_ADDRESS")

echo "   Admin reputation: $REP (should be 50)"
echo ""

# ─── Done ──────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "  ✅ DEPLOYMENT COMPLETE"
echo ""
echo "  Contract ID: $CONTRACT_ID"
echo "  Admin:       $ADMIN_ADDRESS"
echo ""
echo "  Next steps:"
echo "  1. Add to your .env file:"
echo "     SOROBAN_CONTRACT_ID=$CONTRACT_ID"
echo "     ADMIN_SECRET_KEY=$(stellar keys show deployer)"
echo ""
echo "  2. Restart the Knapp server:"
echo "     npm run dev"
echo "═══════════════════════════════════════════════════════"
