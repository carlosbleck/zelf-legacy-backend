# ⚙️ Zelf Legacy: Backend Technical Reference

This directory contains the Node.js backend for the **Zelf Legacy** protocol. It acts as the bridge between the Android client, the Solana smart contract, and the **Light Protocol ZK Compression** layer.

## 🚀 Responsibilities

1. **Light Protocol Orchestration**: Handles the creation and update of compressed liveness accounts.
2. **ZK Proof Generation**: Interacts with Photon RPC to fetch validity proofs for compressed state.
3. **Identity Masking**: Implements SHA-256 hashing for beneficiary PII (Emails, IDs).
4. **Transaction Relay**: Acts as a fee-payer and transaction builder for complex multi-signer inheritance operations.

---

## 🛠️ API Documentation

### 1. Liveness Service (`/api/liveness`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/update` | `POST` | Updates testator liveness using ZK Compression. |
| `/status/:vaultAddress` | `GET` | Returns current liveness/timeout status. |

#### **Example: Liveness Update**
```json
// POST /api/liveness/update
{
  "testatorMnemonic": "...",
  "beneficiaryAddress": "...",
  "vaultAddress": "..."
}
```

### 2. Inheritance Service (`/api/inheritance`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/create` | `POST` | Initializes a new private inheritance vault. |
| `/execute` | `POST` | Triggers vault execution (Beneficiary claim). |
| `/cancel` | `POST` | Testator cancels a pending will. |
| `/:vaultAddress` | `GET` | Fetches vault metadata (public parts). |

---

## 🔧 Environment Configuration

| Variable | Description |
|----------|-------------|
| `SOLANA_RPC_URL` | Solana Devnet/Mainnet RPC. |
| `PHOTON_RPC_URL` | Photon RPC (Helius/Light) for ZK Compression indexing. |
| `PROGRAM_ID` | The Anchor program ID of the inheritance contract. |
| `FEE_PAYER_MNEMONIC` | Mnemonic of the wallet funding transactions. |

---

## 🧪 Integration with Light Protocol

The backend uses `@lightprotocol/stateless.js` to manage compressed accounts.

```javascript
// Example: Fetching valid proofs for compressed liveness
const validityProof = await connection.getValidityProof([account.hash]);
const root = validityProof.compressedProof?.root;
```

## 🏃 Running Locally

```bash
npm install
npm run dev
```

---
*Part of the Zelf Legacy Project.*
