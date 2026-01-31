import { Router } from 'express';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { createLightRpc } from '../services/lightProtocol.js';

const router = Router();

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'PQ6EV39W9BQECUnf4v7MPbPCxJwgmwvUwrLY67u13QE');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Demo Verifier - matches InheritanceManager.getVerifierKeypair() in Android
const DEMO_VERIFIER_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

// Fee Payer Wallet - absorbs all transaction fees
const FEE_PAYER_MNEMONIC = process.env.FEE_PAYER_MNEMONIC || "brother stumble impact brick still member palm weekend expand team income marine";


/**
 * POST /api/inheritance/create
 * 
 * Creates a new inheritance/will on Solana.
 */
router.post('/create', async (req, res) => {
    try {
        const {
            testatorMnemonic,
            beneficiaryAddress,
            beneficiaryEmail,
            beneficiaryDocumentId,
            verifierAddress,
            beneficiaryIdentityHash,
            cid,
            cidValidator,
            warningTimeoutSecs,
            timeoutSecs,
            lamports,
            encryptedPassword,
            unwrappedKey,
            isDebug = false
        } = req.body;

        // Validate required inputs
        if (!testatorMnemonic || !beneficiaryAddress) {
            return res.status(400).json({
                error: 'testatorMnemonic and beneficiaryAddress are required',
                success: false
            });
        }

        console.log(`\n🔐 Create Inheritance Request`);
        console.log(`   Beneficiary: ${beneficiaryAddress}`);
        console.log(`   Beneficiary Email: ${beneficiaryEmail || 'Not provided'}`);
        console.log(`   Is Debug: ${isDebug}`);

        const testatorKeypair = deriveKeypairFromMnemonic(testatorMnemonic);
        const beneficiaryPubkey = new PublicKey(beneficiaryAddress);
        const verifierPubkey = verifierAddress
            ? new PublicKey(verifierAddress)
            : testatorKeypair.publicKey;

        console.log(`   Testator: ${testatorKeypair.publicKey.toBase58()}`);

        const connection = new Connection(RPC_URL, 'confirmed');

        // Derive fee payer early since we check its balance (not testator's)
        const feePayerKeypair = deriveKeypairFromMnemonic(FEE_PAYER_MNEMONIC);
        console.log(`   Fee Payer: ${feePayerKeypair.publicKey.toBase58()}`);

        // Check fee payer's balance (not testator's) since fee payer now funds everything
        const balance = await connection.getBalance(feePayerKeypair.publicKey);
        const requiredLamports = (lamports || 100_000_000) + 10_000_000; // Plus fees

        if (balance < requiredLamports) {
            return res.status(400).json({
                error: `Fee payer has insufficient balance. Have: ${balance}, Need: ${requiredLamports}. Please fund the fee payer wallet: ${feePayerKeypair.publicKey.toBase58()}`,
                success: false,
                feePayerAddress: feePayerKeypair.publicKey.toBase58(),
                currentBalance: balance,
                requiredBalance: requiredLamports
            });
        }

        // Derive Vault PDA
        const [vaultPda, bump] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('vault'),
                testatorKeypair.publicKey.toBuffer(),
                beneficiaryPubkey.toBuffer()
            ],
            PROGRAM_ID
        );

        console.log(`   Vault PDA: ${vaultPda.toBase58()}, Bump: ${bump}`);

        // Check if vault already exists
        const existingVault = await connection.getAccountInfo(vaultPda);
        if (existingVault) {
            return res.status(409).json({
                error: 'Inheritance already exists for this testator/beneficiary pair',
                success: false,
                vaultAddress: vaultPda.toBase58()
            });
        }

        // Build init_inheritance instruction
        const discriminator = calculateDiscriminator('init_inheritance');

        // Prepare parameter buffers
        const beneficiaryIdentityHashBuf = beneficiaryIdentityHash
            ? Buffer.from(beneficiaryIdentityHash, 'hex')
            : Buffer.alloc(32);

        // Hash email and document ID for on-chain storage (SHA-256)
        const beneficiaryEmailHashBuf = beneficiaryEmail
            ? crypto.createHash('sha256').update(beneficiaryEmail.toLowerCase().trim()).digest()
            : Buffer.alloc(32);
        const beneficiaryDocumentIdHashBuf = beneficiaryDocumentId
            ? crypto.createHash('sha256').update(beneficiaryDocumentId.trim()).digest()
            : Buffer.alloc(32);

        let cidBuf = cid ? Buffer.from(cid).slice(0, 32) : Buffer.alloc(32);
        if (cidBuf.length < 32) {
            const padded = Buffer.alloc(32);
            cidBuf.copy(padded);
            cidBuf = padded;
        }
        let cidValidatorBuf = cidValidator ? Buffer.from(cidValidator).slice(0, 32) : Buffer.alloc(32);
        if (cidValidatorBuf.length < 32) {
            const padded = Buffer.alloc(32);
            cidValidatorBuf.copy(padded);
            cidValidatorBuf = padded;
        }


        // Encode encrypted password as Vec<u8>
        const encryptedPasswordBytes = encryptedPassword
            ? Buffer.from(encryptedPassword, 'utf8')
            : Buffer.alloc(0);
        const encryptedPasswordLenBuf = Buffer.alloc(4);
        encryptedPasswordLenBuf.writeUInt32LE(encryptedPasswordBytes.length, 0);

        // Encode unwrapped key
        const unwrappedKeyBuf = unwrappedKey
            ? Buffer.from(unwrappedKey, 'hex')
            : Buffer.alloc(32);

        // Encode timeouts and lamports
        const warningTimeoutBuf = Buffer.alloc(8);
        warningTimeoutBuf.writeBigInt64LE(BigInt(warningTimeoutSecs || 60), 0);

        const timeoutBuf = Buffer.alloc(8);
        timeoutBuf.writeBigInt64LE(BigInt(timeoutSecs || 180), 0);

        const lamportsBuf = Buffer.alloc(8);
        lamportsBuf.writeBigUInt64LE(BigInt(lamports || 100_000_000), 0);

        const isDebugBuf = Buffer.from([isDebug ? 1 : 0]);

        // Build instruction data
        // Build instruction data
        const instructionData = Buffer.concat([
            discriminator,
            beneficiaryPubkey.toBuffer(),
            verifierPubkey.toBuffer(),
            beneficiaryIdentityHashBuf,
            beneficiaryEmailHashBuf,
            beneficiaryDocumentIdHashBuf,
            cidBuf,
            cidValidatorBuf,
            warningTimeoutBuf,
            timeoutBuf,
            lamportsBuf,
            encryptedPasswordLenBuf,
            encryptedPasswordBytes,
            unwrappedKeyBuf,
            isDebugBuf
        ]);

        // feePayerKeypair already derived above for balance check

        // Keys must match Anchor InitInheritance struct order: vault, testator, payer, system_program
        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: vaultPda, isSigner: false, isWritable: true },
                { pubkey: testatorKeypair.publicKey, isSigner: true, isWritable: false },
                { pubkey: feePayerKeypair.publicKey, isSigner: true, isWritable: true }, // payer funds vault
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data: instructionData,
        });


        const { blockhash } = await connection.getLatestBlockhash();
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = feePayerKeypair.publicKey;
        tx.add(instruction);

        // Sign with fee payer and testator
        const signature = await connection.sendTransaction(tx, [feePayerKeypair, testatorKeypair], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        });

        await connection.confirmTransaction(signature, 'confirmed');

        console.log(`✅ Inheritance created!`);
        console.log(`   Signature: ${signature}`);
        console.log(`   Vault: ${vaultPda.toBase58()}`);

        res.json({
            success: true,
            signature,
            vaultAddress: vaultPda.toBase58(),
            testatorAddress: testatorKeypair.publicKey.toBase58(),
            beneficiaryAddress: beneficiaryPubkey.toBase58(),
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('❌ Create inheritance failed:', error);
        res.status(500).json({
            error: error.message || 'Failed to create inheritance',
            success: false
        });
    }
});

/**
 * POST /api/inheritance/execute
 * 
 * Executes an inheritance (beneficiary claims the will).
 */
router.post('/execute', async (req, res) => {
    try {
        const {
            beneficiaryMnemonic,
            vaultAddress,
            testatorAddress,
            verifierMnemonic,
            transferAssets = true,
            debugMode = false
        } = req.body;

        if (!beneficiaryMnemonic || !vaultAddress) {
            return res.status(400).json({
                error: 'beneficiaryMnemonic and vaultAddress are required',
                success: false
            });
        }

        console.log(`\n🔐 Execute Inheritance Request`);
        console.log(`   Vault: ${vaultAddress}`);

        const beneficiaryKeypair = deriveKeypairFromMnemonic(beneficiaryMnemonic);
        const vaultPubkey = new PublicKey(vaultAddress);

        console.log(`   Beneficiary: ${beneficiaryKeypair.publicKey.toBase58()}`);

        const connection = new Connection(RPC_URL, 'confirmed');

        // Get vault data
        const vaultAccount = await connection.getAccountInfo(vaultPubkey);
        if (!vaultAccount) {
            return res.status(404).json({
                error: 'Vault not found',
                success: false
            });
        }

        // Parse vault to get testator and beneficiary addresses from vault data
        const vaultData = vaultAccount.data;

        // Vault struct layout (after 8-byte discriminator):
        // testator: 32 bytes (offset 8)
        // beneficiary: 32 bytes (offset 40)
        const storedTestator = new PublicKey(vaultData.slice(8, 40));
        const storedBeneficiary = new PublicKey(vaultData.slice(40, 72));

        console.log(`   Stored Testator: ${storedTestator.toBase58()}`);
        console.log(`   Stored Beneficiary: ${storedBeneficiary.toBase58()}`);
        console.log(`   Derived Beneficiary (from mnemonic): ${beneficiaryKeypair.publicKey.toBase58()}`);

        // Check if beneficiary matches
        if (storedBeneficiary.toBase58() !== beneficiaryKeypair.publicKey.toBase58()) {
            return res.status(400).json({
                error: `Beneficiary mismatch. Vault expects: ${storedBeneficiary.toBase58()}, but got: ${beneficiaryKeypair.publicKey.toBase58()}`,
                success: false
            });
        }

        // Use stored testator from vault (more reliable than parsing from request)
        const testatorPubkey = testatorAddress
            ? new PublicKey(testatorAddress)
            : storedTestator;

        // Verify vault PDA matches
        const [expectedVaultPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('vault'), testatorPubkey.toBuffer(), beneficiaryKeypair.publicKey.toBuffer()],
            PROGRAM_ID
        );

        console.log(`   Expected Vault PDA: ${expectedVaultPda.toBase58()}`);
        console.log(`   Provided Vault: ${vaultPubkey.toBase58()}`);

        if (expectedVaultPda.toBase58() !== vaultPubkey.toBase58()) {
            return res.status(400).json({
                error: `Vault PDA mismatch. Expected: ${expectedVaultPda.toBase58()}, but got: ${vaultPubkey.toBase58()}. Seeds: testator=${testatorPubkey.toBase58()}, beneficiary=${beneficiaryKeypair.publicKey.toBase58()}`,
                success: false
            });
        }

        // Verifier (use provided or default to demo verifier)
        const verifierKeypair = verifierMnemonic
            ? deriveKeypairFromMnemonic(verifierMnemonic)
            : deriveKeypairFromMnemonic(DEMO_VERIFIER_MNEMONIC);

        console.log(`   Testator: ${testatorPubkey.toBase58()}`);
        console.log(`   Verifier: ${verifierKeypair.publicKey.toBase58()}`);

        // Derive fee payer (same as in /create route)
        const feePayerKeypair = deriveKeypairFromMnemonic(FEE_PAYER_MNEMONIC);
        console.log(`   Fee Payer: ${feePayerKeypair.publicKey.toBase58()}`);

        // Build execute_inheritance instruction
        const discriminator = calculateDiscriminator('execute_inheritance');

        // Encode parameters
        const transferAssetsBuf = Buffer.from([transferAssets ? 1 : 0]);
        const debugModeBuf = Buffer.from([debugMode ? 1 : 0]);

        // Mock proof data
        const identityProofBuf = Buffer.alloc(32);
        const proofLenBuf = Buffer.alloc(4);
        proofLenBuf.writeUInt32LE(0, 0);

        const instructionData = Buffer.concat([
            discriminator,
            identityProofBuf,
            proofLenBuf,
            transferAssetsBuf,
            debugModeBuf
        ]);

        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: vaultPubkey, isSigner: false, isWritable: true },
                { pubkey: testatorPubkey, isSigner: false, isWritable: true },
                { pubkey: beneficiaryKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: verifierKeypair.publicKey, isSigner: true, isWritable: false },
            ],

            programId: PROGRAM_ID,
            data: instructionData,
        });

        const { blockhash } = await connection.getLatestBlockhash();
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = feePayerKeypair.publicKey; // Fee payer covers transaction fees
        tx.add(instruction);

        // Sign with fee payer, beneficiary, and verifier
        const signers = [feePayerKeypair, beneficiaryKeypair];
        if (verifierKeypair.publicKey.toBase58() !== beneficiaryKeypair.publicKey.toBase58()) {
            signers.push(verifierKeypair);
        }

        const signature = await connection.sendTransaction(tx, signers, {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        });

        await connection.confirmTransaction(signature, 'confirmed');

        // Parse encrypted password from vault data for response
        // Vault struct layout:
        // discriminator(8) + testator(32) + beneficiary(32) + verifier(32) + 
        // identity_hash(32) + email_hash(32) + doc_id_hash(32) + 
        // cid(32) + cid_validator(32) + 
        // last_ping(8) + created_at(8) + warning_timeout(8) + timeout(8) + 
        // executed(1) + lamports(8) = 305 bytes
        // Then: encrypted_password Vec<u8> (4 bytes len + data)
        let encryptedPassword = '';
        try {
            const passwordLenOffset = 305;
            const passwordLen = vaultData.readUInt32LE(passwordLenOffset);
            console.log(`   Password length at offset ${passwordLenOffset}: ${passwordLen}`);
            if (passwordLen > 0 && passwordLen < 256) {
                const passwordBytes = vaultData.slice(passwordLenOffset + 4, passwordLenOffset + 4 + passwordLen);
                encryptedPassword = passwordBytes.toString('utf8');
                console.log(`   Extracted password: ${encryptedPassword}`);
            }
        } catch (e) {
            console.log('   Could not parse encrypted password:', e.message);
        }


        console.log(`✅ Inheritance executed!`);
        console.log(`   Signature: ${signature}`);

        res.json({
            success: true,
            signature,
            vaultAddress: vaultPubkey.toBase58(),
            beneficiaryAddress: beneficiaryKeypair.publicKey.toBase58(),
            encryptedPassword,
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('❌ Execute inheritance failed:', error);
        res.status(500).json({
            error: error.message || 'Failed to execute inheritance',
            success: false
        });
    }
});

/**
 * GET /api/inheritance/:vaultAddress
 * 
 * Get inheritance/vault details.
 */
router.get('/:vaultAddress', async (req, res) => {
    try {
        const { vaultAddress } = req.params;
        const vaultPubkey = new PublicKey(vaultAddress);

        const connection = new Connection(RPC_URL, 'confirmed');
        const vaultAccount = await connection.getAccountInfo(vaultPubkey);

        if (!vaultAccount) {
            return res.status(404).json({
                error: 'Vault not found',
                success: false
            });
        }

        // Parse vault data
        const data = vaultAccount.data;
        const testator = new PublicKey(data.slice(8, 40));
        const beneficiary = new PublicKey(data.slice(40, 72));
        const verifier = new PublicKey(data.slice(72, 104));

        res.json({
            success: true,
            vault: {
                address: vaultAddress,
                testator: testator.toBase58(),
                beneficiary: beneficiary.toBase58(),
                verifier: verifier.toBase58(),
                owner: vaultAccount.owner.toBase58(),
                lamports: vaultAccount.lamports,
            }
        });

    } catch (error) {
        console.error('Error getting vault:', error);
        res.status(500).json({
            error: error.message,
            success: false
        });
    }
});

/**
 * Derive a Solana keypair from a mnemonic or private key.
 */
function deriveKeypairFromMnemonic(input) {
    try {
        const decoded = bs58.decode(input);
        if (decoded.length === 64) {
            return Keypair.fromSecretKey(decoded);
        }
    } catch (e) {
        // Not a valid base58 key
    }

    const seed = bip39.mnemonicToSeedSync(input.trim());
    const path = "m/44'/501'/0'/0'";
    const derivedSeed = derivePath(path, seed.toString('hex')).key;
    return Keypair.fromSeed(derivedSeed);
}

/**
 * POST /api/inheritance/cancel
 * 
 * Cancels an inheritance/will.
 * Uses fee payer to cover gas fees.
 */
router.post('/cancel', async (req, res) => {
    try {
        const {
            testatorMnemonic,
            beneficiaryAddress,
            vaultAddress
        } = req.body;

        if (!testatorMnemonic) {
            return res.status(400).json({
                error: 'testatorMnemonic is required',
                success: false
            });
        }

        console.log(`\n🗑️ Cancel Inheritance Request`);

        const testatorKeypair = deriveKeypairFromMnemonic(testatorMnemonic);
        console.log(`   Testator: ${testatorKeypair.publicKey.toBase58()}`);

        const connection = new Connection(RPC_URL, 'confirmed');

        // Derive fee payer
        const feePayerKeypair = deriveKeypairFromMnemonic(FEE_PAYER_MNEMONIC);
        console.log(`   Fee Payer: ${feePayerKeypair.publicKey.toBase58()}`);

        // Determine Vault PDA
        let vaultPubkey;
        if (vaultAddress) {
            vaultPubkey = new PublicKey(vaultAddress);
        } else if (beneficiaryAddress) {
            const beneficiaryPubkey = new PublicKey(beneficiaryAddress);
            const [pda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('vault'),
                    testatorKeypair.publicKey.toBuffer(),
                    beneficiaryPubkey.toBuffer()
                ],
                PROGRAM_ID
            );
            vaultPubkey = pda;
        } else {
            return res.status(400).json({
                error: 'Either vaultAddress or beneficiaryAddress is required to identify the vault',
                success: false
            });
        }
        console.log(`   Vault: ${vaultPubkey.toBase58()}`);

        // Build cancel_will instruction
        const discriminator = calculateDiscriminator('cancel_will');

        const instruction = new TransactionInstruction({
            keys: [
                { pubkey: vaultPubkey, isSigner: false, isWritable: true },
                { pubkey: testatorKeypair.publicKey, isSigner: true, isWritable: true },
                // Note: Anchor might require beneficiary account if it's in the struct, but CancelWill struct only lists vault and testator.
                // However, standard Accounts trait usually implies just the accounts in the struct.
            ],
            programId: PROGRAM_ID,
            data: discriminator,
        });

        const { blockhash } = await connection.getLatestBlockhash();
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = feePayerKeypair.publicKey;
        tx.add(instruction);

        // Sign with fee payer and testator
        const signature = await connection.sendTransaction(tx, [feePayerKeypair, testatorKeypair], {
            skipPreflight: false,
            preflightCommitment: 'confirmed',
        });

        await connection.confirmTransaction(signature, 'confirmed');

        console.log(`✅ Inheritance cancelled!`);
        console.log(`   Signature: ${signature}`);

        res.json({
            success: true,
            signature,
            vaultAddress: vaultPubkey.toBase58(),
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('❌ Cancel inheritance failed:', error);
        res.status(500).json({
            error: error.message || 'Failed to cancel inheritance',
            success: false
        });
    }
});

/*
 * Generate Anchor instruction discriminator.
 */
function calculateDiscriminator(instructionName) {
    const hash = crypto.createHash('sha256')
        .update(`global:${instructionName}`)
        .digest();
    return hash.slice(0, 8);
}

export { router as inheritanceRouter };
