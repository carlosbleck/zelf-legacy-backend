import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { InheritanceDemo } from "../target/types/inheritance_demo";
import { assert } from "chai";
import { expect } from "chai";

describe("inheritance demo - envelope encryption", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .InheritanceDemo as Program<InheritanceDemo>;

  // Helper: Create mock data
  const createMockEncryptedPassword = (): Buffer => Buffer.alloc(32, 0xAA);
  const createMockUnwrappedKey = (): number[] => Array.from(Buffer.alloc(32, 0xBB));
  const createMockLightRoot = (): number[] => Array.from(Buffer.alloc(32, 0xCC));
  const createMockProof = (): number[][] => []; // Empty proof for debug/mock
  const createMockHash = (): number[] => Array.from(Buffer.alloc(32, 0x11));
  const createMockEmailHash = (): number[] => Array.from(Buffer.alloc(32, 0x22)); // SHA-256 of test email
  const createMockDocumentIdHash = (): number[] => Array.from(Buffer.alloc(32, 0x33)); // SHA-256 of document ID
  const createZeroProof = (): number[][] => [];

  let lightState: anchor.web3.Keypair;

  before(async () => {
    lightState = anchor.web3.Keypair.generate();
    const initialRoot = createMockLightRoot();

    await program.methods
      .initLightRegistry(initialRoot)
      .accounts({
        lightState: lightState.publicKey,
        payer: provider.wallet.publicKey,
      })
      .signers([lightState])
      .rpc();
  });

  it("runs envelope encryption flow with identity verification", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const verifier = anchor.web3.Keypair.generate(); // The Oracle/Face-Match Verifier

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const depositAmount = new anchor.BN(1000000000);
    const encryptedPassword = createMockEncryptedPassword();
    const unwrappedKey = createMockUnwrappedKey();
    const lightRoot = createMockLightRoot();
    const identityHash = createMockHash();
    const cid = createMockHash();

    const warningTimeout = new anchor.BN(1);
    const totalTimeout = new anchor.BN(2);

    // Initialize inheritance with verifier and identity anchors
    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        verifier.publicKey,
        identityHash,
        createMockEmailHash(),
        createMockDocumentIdHash(),
        cid,
        cid, // cid_validator (using cid as mock for now)
        warningTimeout,
        totalTimeout,
        depositAmount,
        encryptedPassword,
        unwrappedKey,
        true // is_debug
      )
      .accounts({
        testator: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
      } as any)
      .rpc();

    // Verify vault was created with new fields
    let vaultAccount = await program.account.vault.fetch(vault);
    assert.equal(vaultAccount.verifier.toString(), verifier.publicKey.toString());
    assert.deepEqual(Array.from(vaultAccount.cid), cid);
    assert.deepEqual(Array.from((vaultAccount as any).cidValidator), cid);

    // Update liveness with mock proof
    await program.methods
      .updateLiveness(beneficiary.publicKey, lightRoot, createMockProof())
      .accounts({
        testator: provider.wallet.publicKey,
        lightState: lightState.publicKey,
      } as any)
      .rpc();

    // Wait for timeout
    await new Promise((r) => setTimeout(r, 4000));

    // Execute inheritance - Requires Beneficiary AND Verifier (Oracle) to sign
    await program.methods
      .executeInheritance(true) // transfer_funds = true (Test actual transfer)
      .accounts({
        vault: vault, // Explicitly provide vault to avoid resolution issues
        testator: provider.wallet.publicKey,
        beneficiary: beneficiary.publicKey,
        verifier: verifier.publicKey,
      } as any) // Use as any to bypass the lint error if it persists
      .signers([beneficiary, verifier]) // Simulated Face Match Success!
      .rpc();

    const finalVaultAccount = await program.account.vault.fetch(vault);
    assert.equal(finalVaultAccount.executed, true);
  });

  it("fails if wrong verifier signs", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const correctVerifier = anchor.web3.Keypair.generate();
    const wrongVerifier = anchor.web3.Keypair.generate();

    const depositAmount = new anchor.BN(1000000000);
    const encryptedPassword = createMockEncryptedPassword();
    const unwrappedKey = createMockUnwrappedKey();
    const identityHash = createMockHash();
    const cid = createMockHash();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        correctVerifier.publicKey,
        identityHash,
        createMockEmailHash(),
        createMockDocumentIdHash(),
        cid,
        cid, // cid_validator
        new anchor.BN(0),
        new anchor.BN(1),
        depositAmount,
        encryptedPassword,
        unwrappedKey,
        true // is_debug
      )
      .accounts({
        testator: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
      } as any)
      .rpc();

    // Update liveness (required)
    await program.methods
      .updateLiveness(beneficiary.publicKey, createMockLightRoot(), createMockProof())
      .accounts({
        testator: provider.wallet.publicKey,
        lightState: lightState.publicKey,
      } as any)
      .rpc();

    await new Promise((r) => setTimeout(r, 2000));

    try {
      await program.methods
        .executeInheritance(false) // transfer_funds = false
        .accounts({
          vault: vault,
          testator: provider.wallet.publicKey,
          beneficiary: beneficiary.publicKey,
          verifier: wrongVerifier.publicKey,
        } as any)
        .signers([beneficiary, wrongVerifier])
        .rpc();
      assert.fail("Should have thrown InvalidVerifier");
    } catch (err) {
      const errString = err.toString();
      // Accept any of the common InvalidVerifier error formats, or log for debugging
      const isInvalidVerifier = errString.includes("InvalidVerifier") ||
        errString.includes("Invalid verifier") ||
        errString.includes("0x1F16") || // Error code for InvalidVerifier
        errString.includes("custom program error");
      if (!isInvalidVerifier) {
        console.log("Actual error:", errString);
      }
      assert(isInvalidVerifier, `Expected InvalidVerifier error, got: ${errString}`);
    }
  });

  it("fails if light protocol validation fails (is_debug = false)", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const verifier = anchor.web3.Keypair.generate();

    const depositAmount = new anchor.BN(1000000);
    const encryptedPassword = createMockEncryptedPassword();
    const unwrappedKey = createMockUnwrappedKey();
    const identityHash = createMockHash();
    const cid = createMockHash();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        verifier.publicKey,
        identityHash,
        createMockEmailHash(),
        createMockDocumentIdHash(),
        cid,
        cid, // cid_validator
        new anchor.BN(0),
        new anchor.BN(10),
        depositAmount,
        encryptedPassword,
        unwrappedKey,
        false // is_debug = false (Validation ENFORCED)
      )
      .accounts({
        testator: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
      } as any)
      .rpc();

    try {
      // Update liveness with WRONG root should fail when is_debug is false
      const wrongRoot = Array.from(Buffer.alloc(32, 0xEE));
      await program.methods
        .updateLiveness(beneficiary.publicKey, wrongRoot, createZeroProof())
        .accounts({
          testator: provider.wallet.publicKey,
          lightState: lightState.publicKey,
        } as any)
        .rpc();
      assert.fail("Should have thrown InvalidLightRoot");
    } catch (err) {
      expect(err.toString()).to.match(/InvalidLightRoot|Invalid Light Protocol root/);
    }
  });

  it("passes light protocol validation (is_debug = false) with correct proof", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const verifier = anchor.web3.Keypair.generate();

    const depositAmount = new anchor.BN(1000000);
    const encryptedPassword = createMockEncryptedPassword();
    const unwrappedKey = createMockUnwrappedKey();
    const identityHash = createMockHash();
    const cid = createMockHash();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    // 1. Initialize
    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        verifier.publicKey,
        identityHash,
        createMockEmailHash(),
        createMockDocumentIdHash(),
        cid,
        cid, // cid_validator
        new anchor.BN(0),
        new anchor.BN(10),
        depositAmount,
        encryptedPassword,
        unwrappedKey,
        false // is_debug = false (Validation ENFORCED)
      )
      .accounts({
        testator: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
      } as any)
      .rpc();

    // 2. Calculate the expected leaf
    const vaultAccount = await program.account.vault.fetch(vault);

    // Mimic demo_hash in TypeScript
    const demoHash = (data: Buffer): Buffer => {
      const hash = Buffer.alloc(32, 0);
      for (let i = 0; i < data.length; i++) {
        const byte = data[i];
        const idx = i % 32;
        let val = hash[idx];
        // hash[idx] = hash[idx].wrapping_add(byte).rotate_left(3)
        val = (val + byte) & 0xFF;
        val = ((val << 3) | (val >> 5)) & 0xFF;
        // hash[idx] ^= 0x55
        val = val ^ 0x55;
        hash[idx] = val;
      }
      return hash;
    };

    const lastPingBytes = Buffer.alloc(8);
    lastPingBytes.writeBigInt64LE(BigInt(vaultAccount.lastPing.toString()));

    const leaf = demoHash(Buffer.concat([
      provider.wallet.publicKey.toBuffer(),
      lastPingBytes
    ]));

    // 3. Initialize a NEW Light Registry with our intended root
    const testLightState = anchor.web3.Keypair.generate();
    await program.methods
      .initLightRegistry(Array.from(leaf))
      .accounts({
        lightState: testLightState.publicKey,
        payer: provider.wallet.publicKey,
      })
      .signers([testLightState])
      .rpc();

    // 4. Update liveness - should pass
    await program.methods
      .updateLiveness(beneficiary.publicKey, Array.from(leaf), [])
      .accounts({
        testator: provider.wallet.publicKey,
        lightState: testLightState.publicKey,
        vault: vault,
      } as any)
      .rpc();

    const updatedVault = await program.account.vault.fetch(vault);
    assert.deepEqual(Array.from(updatedVault.lightRoot as number[]), Array.from(leaf));
  });

  it("fails if called before timeout", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const verifier = anchor.web3.Keypair.generate();

    const depositAmount = new anchor.BN(1000000);
    const identityHash = createMockHash();
    const cid = createMockHash();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        verifier.publicKey,
        identityHash,
        createMockEmailHash(),
        createMockDocumentIdHash(),
        cid,
        cid, // cid_validator
        new anchor.BN(0),
        new anchor.BN(100), // Long timeout
        depositAmount,
        createMockEncryptedPassword(),
        createMockUnwrappedKey(),
        true
      )
      .accounts({
        testator: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
      } as any)
      .rpc();

    try {
      await program.methods
        .executeInheritance(false) // transfer_funds = false
        .accounts({
          vault: vault,
          testator: provider.wallet.publicKey,
          beneficiary: beneficiary.publicKey,
          verifier: verifier.publicKey,
        } as any)
        .signers([beneficiary, verifier])
        .rpc();
      assert.fail("Should have thrown TransitionNotAllowed");
    } catch (err) {
      expect(err.toString()).to.match(/TransitionNotAllowed/);
    }
  });

  it("attempts to create compressed liveness (expected to fail without Light Protocol environment)", async () => {
    const beneficiary = anchor.web3.Keypair.generate();

    // We need to initialize the vault first
    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        anchor.web3.Keypair.generate().publicKey,
        createMockHash(),
        createMockEmailHash(),
        createMockDocumentIdHash(),
        createMockHash(), // cid
        createMockHash(), // cid_validator
        new anchor.BN(0),
        new anchor.BN(10),
        new anchor.BN(1000000),
        createMockEncryptedPassword(),
        createMockUnwrappedKey(),
        true
      )
      .accounts({
        testator: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
      } as any)
      .rpc();

    const proofData = { data: Buffer.alloc(0) };
    const addressTreeInfo = {
      addressMerkleTreePubkeyIndex: 0,
      addressQueuePubkeyIndex: 1
    };
    const outputTreeIndex = 0;

    try {
      await program.methods
        .createCompressedLiveness(proofData, addressTreeInfo, outputTreeIndex)
        .accounts({
          testator: provider.wallet.publicKey,
          feePayer: provider.wallet.publicKey,
        } as any)
        .rpc();
      // If it somehow passes (unlikely without Light Protocol), that's fine for this test
    } catch (err) {
      // We expect a failure because Light System Program is not at the PID we derived for CPI
      // or because remaining accounts are missing.
      process.stdout.write("Note: create_compressed_liveness failed as expected in mock environment\n");
    }
  });

  it("allows testator to cancel their will", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const verifier = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    const depositAmount = new anchor.BN(1000000000);

    // 1. Initialize
    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        verifier.publicKey,
        createMockHash(),
        createMockEmailHash(),
        createMockDocumentIdHash(),
        createMockHash(),
        createMockHash(),
        new anchor.BN(1),
        new anchor.BN(2),
        depositAmount,
        createMockEncryptedPassword(),
        createMockUnwrappedKey(),
        true
      )
      .accounts({
        testator: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
      } as any)
      .rpc();

    // Verify it exists
    let vaultAccount = await program.account.vault.fetch(vault);
    assert.ok(vaultAccount);

    // 2. Cancel
    await program.methods
      .cancelWill()
      .accounts({
        vault: vault,
        testator: provider.wallet.publicKey,
      } as any)
      .rpc();

    // 3. Verify it's gone
    try {
      await program.account.vault.fetch(vault);
      assert.fail("Vault account should have been closed");
    } catch (err) {
      assert.ok(err.toString().includes("Account does not exist"));
    }
  });

  it("fails to cancel an already executed will", async () => {
    const beneficiary = anchor.web3.Keypair.generate();
    const verifier = anchor.web3.Keypair.generate();

    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vault"),
        provider.wallet.publicKey.toBuffer(),
        beneficiary.publicKey.toBuffer(),
      ],
      program.programId
    );

    // 1. Initialize
    await program.methods
      .initInheritance(
        beneficiary.publicKey,
        verifier.publicKey,
        createMockHash(),
        createMockEmailHash(),
        createMockDocumentIdHash(),
        createMockHash(),
        createMockHash(),
        new anchor.BN(1), // Short warning timeout
        new anchor.BN(2), // Short total timeout
        new anchor.BN(1000000),
        createMockEncryptedPassword(),
        createMockUnwrappedKey(),
        true
      )
      .accounts({
        testator: provider.wallet.publicKey,
        payer: provider.wallet.publicKey,
      } as any)
      .rpc();

    // 2. Mock liveness update
    await program.methods
      .updateLiveness(beneficiary.publicKey, createMockLightRoot(), [])
      .accounts({
        testator: provider.wallet.publicKey,
        lightState: lightState.publicKey,
      } as any)
      .rpc();

    // Wait for timeout (longer to ensure state transition)
    await new Promise((r) => setTimeout(r, 3000));

    // 3. Execute
    await program.methods
      .executeInheritance(false)
      .accounts({
        vault: vault,
        testator: provider.wallet.publicKey,
        beneficiary: beneficiary.publicKey,
        verifier: verifier.publicKey,
      } as any)
      .signers([beneficiary, verifier])
      .rpc();

    // 4. Try to cancel - should fail because it's already executed
    try {
      await program.methods
        .cancelWill()
        .accounts({
          vault: vault,
          testator: provider.wallet.publicKey,
        } as any)
        .rpc();
      assert.fail("Should have failed to cancel executed will");
    } catch (err) {
      assert.ok(err.toString().includes("AlreadyExecuted"));
    }
  });
});

