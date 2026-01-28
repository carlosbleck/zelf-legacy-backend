# Light Protocol Backend

Backend service for handling Light Protocol ZK compression in the inheritance liveness verification system.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm start

# For development with auto-reload
npm run dev
```

## API Endpoints

### POST /api/liveness/update

Update the testator's liveness timestamp using Light Protocol.

**Request:**
```json
{
  "testatorMnemonic": "your mnemonic phrase or base58 private key",
  "beneficiaryAddress": "BeneficiaryPublicKeyBase58"
}
```

**Response:**
```json
{
  "success": true,
  "signature": "5Kj2...",
  "lightRoot": "a1b2c3...",
  "usesLightProtocol": false,
  "testatorAddress": "TestatorPublicKey",
  "vaultAddress": "VaultPDA",
  "timestamp": "2026-01-28T12:00:00.000Z"
}
```

### GET /api/liveness/status/:vaultAddress

Get the current status of a vault.

**Response:**
```json
{
  "success": true,
  "vault": {
    "address": "VaultPDA",
    "testator": "TestatorPublicKey",
    "beneficiary": "BeneficiaryPublicKey",
    "lastPing": "2026-01-28T12:00:00.000Z",
    "state": "Active",
    "timeSincePingSeconds": 120
  }
}
```

### GET /health

Health check endpoint.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_RPC_URL` | Solana RPC endpoint | https://api.devnet.solana.com |
| `PROGRAM_ID` | Your inheritance program ID | PQ6EV39W9BQE... |
| `PORT` | Server port | 3000 |

## Current Status

This backend currently runs in **debug mode** (`is_debug = true` in the smart contract).
The Light Protocol proofs are mocked for development purposes.

For production Light Protocol integration:
1. Get a Helius API key with ZK Compression support
2. Update `SOLANA_RPC_URL` to use Helius
3. Set `is_debug = false` in the smart contract
