# How to Run the Anchor Smart Contract

This guide explains how to build, test, and deploy the Anchor smart contract for the Inheritance Demo.

## Prerequisites

-   **Rust**: Install via rustup.
-   **Solana CLI**: Ensure `solana-test-validator` and `solana` are in your PATH.
-   **Anchor CLI**: Install via avm (Anchor Version Manager) or cargo.
-   **Yarn/Npm**: For installing JavaScript dependencies.

## Setup

1.  **Install Root Dependencies**:
    Navigate to the project root and install the dependencies:
    ```bash
    npm install
    # or
    yarn install
    ```

## Building the Program

To compile the Rust smart contract:

```bash
anchor build
```

This generates the IDL and keys in `target/idl/` and `target/deploy/`.

## Running Tests (Localnet)

The easiest way to run the smart contract logic is via the test suite, which spins up a local validator autonomously.

### Using the Helper Script
We have a script that automatically switches the cluster to `localnet` and runs tests:

```bash
./test_local.sh
```

### Manual Method
1.  Ensure `Anchor.toml` has `[programs.localnet]` configured and `cluster = "localnet"`.
2.  Run the tests:
    ```bash
    anchor test
    ```

## Running a Local Validator

If you want to keep the validator running efficiently for frontend/backend development:

1.  **Start the Validator**:
    ```bash
    solana-test-validator
    ```

2.  **Deploy the Program** (in a new terminal):
    ```bash
    anchor deploy --provider.cluster localnet
    ```

3.  **Run Scripts**:
    You can now interact with the deployed program using your own client scripts or the backend server.

## Troubleshooting

-   **"Account not found"**: Ensure your local wallet has SOL.
    ```bash
    solana airdrop 2
    ```
-   **Program ID Mismatch**: If you rebuilt the program, the Program ID might have changed.
    -   Check `target/deploy/inheritance_demo-keypair.json`.
    -   Run `solana address -k target/deploy/inheritance_demo-keypair.json` to get the new ID.
    -   Update `lib.rs` and `Anchor.toml` with this new ID against your validator.
