# 🛡️ Zelf Legacy: Private Heritage on Solana

### *Secure, Private, and Cost-Effective Inheritance powered by Light Protocol ZK Compression*

[![Solana Privacy Hack](https://img.shields.io/badge/Solana-Privacy_Hack-blueviolet?style=for-the-badge&logo=solana)](https://solana.com/es/privacyhack)
[![Light Protocol](https://img.shields.io/badge/Powered_by-Light_Protocol-green?style=for-the-badge)](https://www.lightprotocol.com/)

---

## 📖 Overview

**Zelf Legacy** is a decentralized inheritance protocol that solves the "Dead Man's Switch" problem without compromising user privacy. By leveraging **Light Protocol's ZK Compression**, Zelf enables testators to maintain a "Proof of Life" on-chain at a fraction of the cost of traditional state, while keeping sensitive beneficiary data and asset details completely private through Zero-Knowledge proofs and selective disclosure.

## 🏗️ Architecture & Flow

The following diagram illustrates how Zelf Legacy utilizes Light Protocol to maintain privacy and efficiency:

```mermaid
sequenceDiagram
    participant T as Testator (User)
    participant B as Beneficiary
    participant ZB as Zelf Backend (Node.js)
    participant LP as Light Protocol (ZK Compression)
    participant SC as Inheritance Smart Contract (Solana)

    Note over T, SC: Phase 1: Creation & Privacy
    T->>ZB: Create Will (Encrypted PII + Beneficiary Hash)
    ZB->>SC: Initialize Vault (Stored on-chain)
    ZB->>LP: Create Compressed Liveness Account
    LP-->>ZB: ZK Proof of Initial State

    Note over T, SC: Phase 2: Maintenance (Cost-Efficient)
    loop Every 30 Days
        T->>ZB: Liveness Update (Selfie/Auth)
        ZB->>LP: Update Compressed State
        LP-->>ZB: New Root + Validity Proof
        ZB->>SC: Update Liveness with ZK Proof
    end

    Note over T, SC: Phase 3: Inheritance Execution
    B->>ZB: Request Inheritance (Identity Verification)
    ZB->>SC: Execute Inheritance (Verifier signs)
    SC->>B: Transfer Assets + Release Encrypted Password
    B->>B: Decrypt Legacy Files
```

## 🔐 Privacy-First Features

- **ZK-Compressed Liveness**: Instead of storing every liveness heartbeat in expensive account data, we use Light Protocol to compress the "Proof of Life" history into a single ZK-root.
- **Beneficiary PII Hashing**: Sensitive data like emails and Document IDs are NEVER stored in plain text. We use SHA-256 hashing to ensure only the rightful owner can verify their identity.
- **Encrypted Legacy Vaults**: The access keys to inheritance files are stored as encrypted blobs, only decryptable by the beneficiary after a successful on-chain execution.
- **Selective Disclosure**: No one on the network knows who the beneficiary is or what assets are being inherited until the "Proof of Death" (timeout) is triggered.

## 🛠️ Technology Stack

- **Smart Contract**: Anchor (Solana) with custom Light Protocol verification logic.
- **Backend (this repo)**: Node.js / Express with `@lightprotocol/stateless.js`.
- **Privacy**: Zero-Knowledge Proofs for state validity and SHA-256 for identity masking.
- **Storage**: ZK Compression for minimized on-chain footprint.

## 🚀 Hackathon Implementation Details

During the **Solana Privacy Hack**, we focused on:
1. **Real ZK Compression**: Moving from standard Solana accounts to compressed accounts for liveness tracking.
2. **Identity Obfuscation**: Implementing the hashing layer for all beneficiary metadata.
3. **Photon Integration**: Using the Photon RPC to index and retrieve compressed liveness accounts for the testator.

---

## ⚙️ Development & Setup

For technical instructions on how to run the components of this project, please refer to the following guides:

- **[Backend Setup Guide](app/README.md)**: Node.js server, API documentation, and Light Protocol integration.
- **[Smart Contract Guide](RUN_SMART_CONTRACT.md)**: Building, testing, and deploying the Anchor program.

### Quick Start (Backend)
```bash
cd app
npm install
npm start
```

---

*Built with ❤️ for the Solana Privacy Hack 2026.*
