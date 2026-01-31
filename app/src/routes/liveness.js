import { Router } from 'express';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { createLightRpc, updateCompressedLiveness } from '../services/lightProtocol.js';

const router = Router();

/**
 * POST /api/liveness/update
 * 
 * Updates the testator's liveness timestamp using Light Protocol ZK compression.
 * This endpoint is called by the Android app when the testator verifies they are alive.
 * 
 * Request body:
 * - testatorMnemonic: string (BIP39 mnemonic or base58 private key)
 * - beneficiaryAddress: string (Solana public key)
 * 
 * Response:
 * - success: boolean
 * - signature: string (transaction signature)
 * - lightRoot: string (hex encoded Light Protocol root)
 * - usesLightProtocol: boolean (true if real Light Protocol was used)
 */
router.post('/update', async (req, res) => {
    try {
        const { testatorMnemonic, beneficiaryAddress, vaultAddress } = req.body;

        // Validate inputs
        if (!testatorMnemonic) {
            return res.status(400).json({
                error: 'testatorMnemonic is required',
                success: false
            });
        }
        if (!beneficiaryAddress) {
            return res.status(400).json({
                error: 'beneficiaryAddress is required',
                success: false
            });
        }

        console.log(`\n🔐 Liveness Update Request`);
        console.log(`   Beneficiary: ${beneficiaryAddress}`);
        if (vaultAddress) console.log(`   Vault Address (Explicit): ${vaultAddress}`);

        // Derive keypair from mnemonic
        const testatorKeypair = deriveKeypairFromMnemonic(testatorMnemonic);
        const beneficiaryPubkey = new PublicKey(beneficiaryAddress);

        console.log(`   Testator: ${testatorKeypair.publicKey.toBase58()}`);

        const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'PQ6EV39W9BQECUnf4v7MPbPCxJwgmwvUwrLY67u13QE');
        const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

        // Get vault PDA (Use explicit if provided, fallback to calculation)
        let vaultPda;
        if (vaultAddress) {
            vaultPda = new PublicKey(vaultAddress);
        } else {
            const [calculatedPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from('vault'),
                    testatorKeypair.publicKey.toBuffer(),
                    beneficiaryPubkey.toBuffer()
                ],
                PROGRAM_ID
            );
            vaultPda = calculatedPda;
        }

        console.log(`   Final Vault PDA: ${vaultPda.toBase58()}`);

        // Connect to Solana
        const connection = new Connection(RPC_URL, 'confirmed');

        // Check if vault exists
        console.log(`   Checking if vault exists at ${RPC_URL}...`);
        const vaultAccount = await connection.getAccountInfo(vaultPda);
        console.log(`   Vault account result:`, vaultAccount ? 'FOUND' : 'NULL');

        if (!vaultAccount) {
            console.error(`   ❌ Vault not found on chain!`);
            return res.status(404).json({
                error: 'Vault not found. Create an inheritance first.',
                success: false,
                debug: {
                    vaultAddress: vaultPda.toBase58(),
                    rpcUrl: RPC_URL,
                    testator: testatorKeypair.publicKey.toBase58(),
                    beneficiary: beneficiaryAddress
                }
            });
        }

        console.log(`   ✅ Vault found! Owner: ${vaultAccount.owner.toBase58()}, Data length: ${vaultAccount.data.length}`);

        // Ensure founder (payer) has funds
        const founderKeypair = getFounderKeypair();
        await ensureFunded(connection, founderKeypair.publicKey);
        console.log(`   Founder/Payer: ${founderKeypair.publicKey.toBase58()}`);

        // Try to use Light Protocol for the update
        let result;
        try {
            // Create Light Protocol RPC connection
            const lightConnection = createLightRpc();

            // Use Light Protocol SDK for the liveness update
            result = await updateCompressedLiveness(
                lightConnection,
                testatorKeypair,
                beneficiaryPubkey,
                vaultPda,
                PROGRAM_ID,
                founderKeypair // Pass payer
            );
        } catch (lightError) {
            console.log(`   ⚠️ Light Protocol failed, falling back to standard: ${lightError.message}`);

            // Fallback to standard transaction
            result = await buildAndSendLivenessUpdate(
                connection,
                testatorKeypair,
                beneficiaryPubkey,
                vaultPda,
                PROGRAM_ID,
                founderKeypair // Pass payer
            );
        }

        console.log(`✅ Liveness update successful!`);
        console.log(`   Signature: ${result.signature}`);
        console.log(`   Uses Light Protocol: ${result.usesLightProtocol}`);

        res.json({
            success: true,
            signature: result.signature,
            lightRoot: result.lightRoot ? Buffer.from(result.lightRoot).toString('hex') : null,
            usesLightProtocol: result.usesLightProtocol,
            testatorAddress: testatorKeypair.publicKey.toBase58(),
            vaultAddress: vaultPda.toBase58(),
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('❌ Liveness update failed:', error);
        res.status(500).json({
            error: error.message || 'Failed to update liveness',
            success: false
        });
    }
});

/**
 * GET /api/liveness/status/:vaultAddress
 * 
 * Get the current liveness status of a vault.
 */
router.get('/status/:vaultAddress', async (req, res) => {
    try {
        const { vaultAddress } = req.params;
        const vaultPubkey = new PublicKey(vaultAddress);

        const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'PQ6EV39W9BQECUnf4v7MPbPCxJwgmwvUwrLY67u13QE');
        const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

        const connection = new Connection(RPC_URL, 'confirmed');
        const vaultAccount = await connection.getAccountInfo(vaultPubkey);

        if (!vaultAccount) {
            return res.status(404).json({
                error: 'Vault not found',
                success: false
            });
        }

        // Parse vault data (skip 8-byte discriminator)
        const data = vaultAccount.data;
        const testator = new PublicKey(data.slice(8, 40));
        const beneficiary = new PublicKey(data.slice(40, 72));
        const lastPing = Number(data.readBigInt64LE(168)); // Offset for last_ping
        const createdAt = Number(data.readBigInt64LE(176)); // Offset for created_at
        const warningTimeoutSecs = Number(data.readBigInt64LE(184));
        const timeoutSecs = Number(data.readBigInt64LE(192));
        const executed = data[200] === 1;

        const now = Math.floor(Date.now() / 1000);
        const timeSincePing = now - lastPing;

        let state = 'Active';
        if (executed) {
            state = 'Executed';
        } else if (timeSincePing > timeoutSecs) {
            state = 'Claimable';
        } else if (timeSincePing > warningTimeoutSecs) {
            state = 'Warning';
        }

        res.json({
            success: true,
            vault: {
                address: vaultAddress,
                testator: testator.toBase58(),
                beneficiary: beneficiary.toBase58(),
                lastPing: new Date(lastPing * 1000).toISOString(),
                createdAt: new Date(createdAt * 1000).toISOString(),
                warningTimeoutSecs,
                timeoutSecs,
                executed,
                state,
                timeSincePingSeconds: timeSincePing,
            }
        });

    } catch (error) {
        console.error('Error getting vault status:', error);
        res.status(500).json({
            error: error.message,
            success: false
        });
    }
});

/**
 * Derive a Solana keypair from a mnemonic or private key.
 * Matches Android BIP44 path: m/44'/501'/0'/0'
 */
function deriveKeypairFromMnemonic(input) {
    // 1. Check if input is a base58 private key
    try {
        const decoded = bs58.decode(input);
        if (decoded.length === 64) {
            return Keypair.fromSecretKey(decoded);
        }
    } catch (e) {
        // Not a valid base58 key
    }

    // 2. Treat as mnemonic with BIP44 Solana path
    const seed = bip39.mnemonicToSeedSync(input.trim());
    const path = "m/44'/501'/0'/0'";
    const derivedSeed = derivePath(path, seed.toString('hex')).key;
    return Keypair.fromSeed(derivedSeed);
}

/**
 * Build and send the update_liveness transaction.
 * Uses mock Light Protocol data for debug mode.
 */
async function buildAndSendLivenessUpdate(connection, testatorKeypair, beneficiaryPubkey, vaultPda, programId, payerKeypair) {
    const { blockhash } = await connection.getLatestBlockhash();

    // Generate mock Light Protocol root (for is_debug=true mode)
    const mockLightRoot = generateMockLightRoot(testatorKeypair.publicKey);

    // Empty proof for debug mode
    const mockProof = [];

    // Create a mock light_state account (needed for the instruction)
    // In production, this would be the real Light Protocol state tree
    // For now, we pass the system program as a placeholder
    const mockLightState = SystemProgram.programId;

    // Build instruction data
    // Discriminator (8 bytes) + beneficiary (32 bytes) + light_root (32 bytes) + proof (vec)
    const discriminator = calculateDiscriminator('update_liveness');

    // Encode the proof vector (empty for debug mode)
    const proofLenBuffer = Buffer.alloc(4);
    proofLenBuffer.writeUInt32LE(mockProof.length, 0);

    const instructionData = Buffer.concat([
        discriminator,
        beneficiaryPubkey.toBuffer(),
        Buffer.from(mockLightRoot),
        proofLenBuffer,
        // No proof elements since length is 0
    ]);

    const instruction = {
        keys: [
            { pubkey: vaultPda, isSigner: false, isWritable: true },
            { pubkey: testatorKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: mockLightState, isSigner: false, isWritable: false },
        ],
        programId: programId,
        data: instructionData,
    };

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payerKeypair.publicKey;
    tx.add(instruction);

    // Sign and send
    const signature = await connection.sendTransaction(tx, [payerKeypair, testatorKeypair], {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
    });

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    return {
        signature,
        lightRoot: mockLightRoot,
        usesLightProtocol: false, // Using debug mode for now
    };
}

/**
 * Generate Anchor instruction discriminator.
 */
function calculateDiscriminator(instructionName) {
    const hash = crypto.createHash('sha256')
        .update(`global:${instructionName}`)
        .digest();
    return hash.slice(0, 8);
}

/**
 * Generate a mock Light Protocol root for testing.
 */
function generateMockLightRoot(testatorPubkey) {
    const seed = Buffer.concat([
        testatorPubkey.toBuffer(),
        Buffer.from(Date.now().toString()),
    ]);

    const hash = crypto.createHash('sha256').update(seed).digest();
    return new Uint8Array(hash);
}

/**
 * Ensure the account has enough SOL for fees.
 */
async function ensureFunded(connection, publicKey) {
    try {
        const balance = await connection.getBalance(publicKey);
        if (balance < 0.005 * LAMPORTS_PER_SOL) {
            console.log(`   💸 Funding founder/payer ${publicKey.toBase58()}...`);
            const signature = await connection.requestAirdrop(publicKey, 1 * LAMPORTS_PER_SOL);
            await connection.confirmTransaction(signature, 'confirmed');
            console.log(`   ✅ Funded: ${signature}`);
        }
    } catch (error) {
        console.error(`   ⚠️ Failed to fund account: ${error.message}`);
    }
}

/**
 * Get the founder/payer keypair.
 * Takes from PAYER_SECRET_KEY env var if available, otherwise generates a temp one (for dev/demo).
 */
function getFounderKeypair() {
    if (process.env.PAYER_SECRET_KEY) {
        try {
            // Try decoding as base58
            return Keypair.fromSecretKey(bs58.decode(process.env.PAYER_SECRET_KEY));
        } catch (e) {
            try {
                // Try parsing as JSON array
                const secret = Uint8Array.from(JSON.parse(process.env.PAYER_SECRET_KEY));
                return Keypair.fromSecretKey(secret);
            } catch (jsonErr) {
                console.error("Invalid PAYER_SECRET_KEY format");
            }
        }
    }

    // For demo purposes, if no env var, we can use a hardcoded devnet key
    // or just generate one. Since we have ensureFunded, generating one works fine for devnet.
    // In production, this MUST be configured.
    console.log("   ⚠️ No PAYER_SECRET_KEY found, generating temporary founder keypair...");
    return Keypair.generate();
}

export { router as livenessRouter };
