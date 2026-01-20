import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { InheritanceDemo } from "../target/types/inheritance_demo";
import { assert } from "chai";
import { expect } from "chai";

describe("inheritance demo", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .InheritanceDemo as Program<InheritanceDemo>;

  it("runs inheritance flow", async () => {
    const beneficiary = anchor.web3.Keypair.generate();

    // Derive vault PDA deterministically
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Get initial balances
    const testatorInitialBalance = await provider.connection.getBalance(
      provider.wallet.publicKey
    );
    const beneficiaryInitialBalance = await provider.connection.getBalance(
      beneficiary.publicKey
    );
    const depositAmount = new anchor.BN(1000000000); // 1 SOL

    // Initialize inheritance with SOL deposit
    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        new anchor.BN(2),
        depositAmount
      )
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Verify vault was created and has the deposit
    const vaultAccount = await program.account.vault.fetch(vault);
    assert.equal(vaultAccount.testator.toString(), provider.wallet.publicKey.toString());
    assert.equal(vaultAccount.beneficiary.toString(), beneficiary.publicKey.toString());
    assert.equal(vaultAccount.lamports.toString(), depositAmount.toString());
    assert.equal(vaultAccount.executed, false);

    // Verify SOL was transferred to vault
    const vaultBalance = await provider.connection.getBalance(vault);
    assert.isAbove(vaultBalance, depositAmount.toNumber());

    // Update liveness with mock Light Protocol commitment
    const mockCommitment = new Uint8Array(32).fill(1); // Mock commitment
    await program.methods
      .updateLiveness(beneficiary.publicKey, [...mockCommitment])
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Wait for timeout period (2 seconds + buffer for clock precision)
    await new Promise((r) => setTimeout(r, 3500));

    // Execute inheritance
    await program.methods
      .executeInheritance()
      .accounts({
        testator: provider.wallet.publicKey,
        beneficiary: beneficiary.publicKey,
      })
      .signers([beneficiary])
      .rpc();

    // Verify execution
    const finalVaultAccount = await program.account.vault.fetch(vault);
    assert.equal(finalVaultAccount.executed, true);
    assert.equal(finalVaultAccount.lamports.toString(), "0");

    // Verify SOL was transferred to beneficiary
    const beneficiaryFinalBalance = await provider.connection.getBalance(
      beneficiary.publicKey
    );
    assert.equal(
      beneficiaryFinalBalance,
      beneficiaryInitialBalance + depositAmount.toNumber()
    );
  });

  it("prevents execution by non-beneficiary", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const unauthorized = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const depositAmount = new anchor.BN(1000000000);

    // Initialize inheritance
    await program.methods
      .initInheritance(beneficiary.publicKey, new anchor.BN(2), depositAmount)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 3000));

    // Try to execute with unauthorized signer (but correct beneficiary account for PDA)
    try {
      await program.methods
        .executeInheritance()
        .accounts({
          testator: provider.wallet.publicKey,
          beneficiary: beneficiary.publicKey, // Correct beneficiary for PDA derivation
        })
        .signers([unauthorized]) // Wrong signer!
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      // Should fail because unauthorized is not the beneficiary signer
      const errStr = err.toString();
      assert.isTrue(
        errStr.includes("unknown signer") || errStr.includes("Signature verification failed"),
        `Expected signer error, got: ${errStr}`
      );
    }
  });

  it("prevents execution before timeout", async () => {
    const beneficiary = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const depositAmount = new anchor.BN(1000000000);

    // Initialize inheritance with 10 second timeout
    await program.methods
      .initInheritance(beneficiary.publicKey, new anchor.BN(10), depositAmount)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Try to execute immediately (should fail)
    try {
      await program.methods
        .executeInheritance()
        .accounts({
          testator: provider.wallet.publicKey,
          beneficiary: beneficiary.publicKey,
        })
        .signers([beneficiary])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      // Should get StillAlive error when executing before timeout
      expect(err.toString()).to.include("StillAlive");
    }
  });

  it("prevents double execution", async () => {
    const beneficiary = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const depositAmount = new anchor.BN(1000000000);

    // Initialize inheritance
    await program.methods
      .initInheritance(beneficiary.publicKey, new anchor.BN(2), depositAmount)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 3000));

    // Execute first time (should succeed)
    await program.methods
      .executeInheritance()
      .accounts({
        testator: provider.wallet.publicKey,
        beneficiary: beneficiary.publicKey,
      })
      .signers([beneficiary])
      .rpc();

    // Try to execute again (should fail)
    try {
      await program.methods
        .executeInheritance()
        .accounts({
          testator: provider.wallet.publicKey,
          beneficiary: beneficiary.publicKey,
        })
        .signers([beneficiary])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      // Should get AlreadyExecuted error after first execution
      expect(err.toString()).to.include("AlreadyExecuted");
    }
  });

  it("prevents execution with no assets", async () => {
    const beneficiary = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Initialize inheritance with 0 lamports
    await program.methods
      .initInheritance(beneficiary.publicKey, new anchor.BN(2), new anchor.BN(0))
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 3000));

    // Try to execute (should fail - no assets)
    try {
      await program.methods
        .executeInheritance()
        .accounts({
          testator: provider.wallet.publicKey,
          beneficiary: beneficiary.publicKey,
        })
        .signers([beneficiary])
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      // Should get NoAssets error when executing with 0 lamports
      expect(err.toString()).to.include("NoAssets");
    }
  });

  it("prevents update_liveness by non-testator", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const unauthorized = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const depositAmount = new anchor.BN(1000000000);

    // Initialize inheritance
    await program.methods
      .initInheritance(beneficiary.publicKey, new anchor.BN(2), depositAmount)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Airdrop to unauthorized account so it can sign
    const airdropSig = await provider.connection.requestAirdrop(
      unauthorized.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Try to update liveness with unauthorized signer using correct beneficiary
    const mockCommitment = new Uint8Array(32).fill(1);
    try {
      await program.methods
        .updateLiveness(beneficiary.publicKey, [...mockCommitment])
        .accounts({
          testator: provider.wallet.publicKey, // Correct testator for PDA
          vault: vault, // Explicitly pass the vault PDA
        })
        .signers([unauthorized]) // Wrong signer!
        .rpc();
      assert.fail("Should have thrown an error");
    } catch (err) {
      // Should fail because unauthorized is not the testator
      const errStr = err.toString();
      assert.isTrue(
        errStr.includes("unknown signer") || errStr.includes("Signature verification failed"),
        `Expected signer error, got: ${errStr}`
      );
    }
  });

  it("stores Light Protocol commitment", async () => {
    const beneficiary = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const depositAmount = new anchor.BN(1000000000);

    // Initialize inheritance
    await program.methods
      .initInheritance(beneficiary.publicKey, new anchor.BN(10), depositAmount)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Update liveness with commitment
    const mockCommitment = new Uint8Array(32).fill(42); // Different commitment value
    await program.methods
      .updateLiveness(beneficiary.publicKey, [...mockCommitment])
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Verify commitment was stored
    const vaultAccount = await program.account.vault.fetch(vault);
    assert.isNotNull(vaultAccount.lightCommitment);
    const storedCommitment = new Uint8Array(vaultAccount.lightCommitment);
    assert.deepEqual(storedCommitment, mockCommitment);

    // Update liveness without commitment (null)
    await program.methods
      .updateLiveness(beneficiary.publicKey, null)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    // Commitment should still be there (doesn't clear on null)
    const vaultAccount2 = await program.account.vault.fetch(vault);
    assert.isNotNull(vaultAccount2.lightCommitment);
  });

  it("ensures PDA determinism", async () => {
    const beneficiary = anchor.web3.Keypair.generate();

    // Derive vault PDA multiple times
    const [vault1] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const [vault2] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    // PDAs should be identical
    assert.equal(vault1.toString(), vault2.toString());

    // Different beneficiary should produce different PDA
    const beneficiary2 = anchor.web3.Keypair.generate();
    const [vault3] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary2.publicKey.toBuffer(),
      ],
      program.programId
    );

    assert.notEqual(vault1.toString(), vault3.toString());
  });

  it("allows testator to update liveness multiple times", async () => {
    const beneficiary = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const depositAmount = new anchor.BN(1000000000);

    // Initialize inheritance
    await program.methods
      .initInheritance(beneficiary.publicKey, new anchor.BN(10), depositAmount)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    const initialPing = (await program.account.vault.fetch(vault)).lastPing;

    // Update liveness first time
    await new Promise((r) => setTimeout(r, 1000));
    await program.methods
      .updateLiveness(beneficiary.publicKey, null)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    const firstUpdate = (await program.account.vault.fetch(vault)).lastPing;
    assert.isAbove(Number(firstUpdate), Number(initialPing));

    // Update liveness second time
    await new Promise((r) => setTimeout(r, 1000));
    await program.methods
      .updateLiveness(beneficiary.publicKey, null)
      .accounts({
        testator: provider.wallet.publicKey,
      })
      .rpc();

    const secondUpdate = (await program.account.vault.fetch(vault)).lastPing;
    assert.isAbove(Number(secondUpdate), Number(firstUpdate));
  });
});
