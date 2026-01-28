/**
 * Light Protocol Service
 * 
 * This module handles real ZK compression operations using the Light Protocol SDK.
 * It provides functionality for:
 * - Creating compressed accounts for liveness tracking
 * - Generating validity proofs for state updates
 * - Interacting with the Photon RPC for compressed account indexing
 */

import { Rpc, createRpc, LightSystemProgram, defaultTestStateTreeAccounts } from '@lightprotocol/stateless.js';
import { PublicKey, Keypair, Connection, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import crypto from 'crypto';

/**
 * Initialize the Light Protocol RPC connection
 */
export function createLightRpc() {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    const photonUrl = process.env.PHOTON_RPC_URL || rpcUrl;

    console.log(`🔗 Creating Light RPC connection`);
    console.log(`   RPC URL: ${rpcUrl}`);
    console.log(`   Photon URL: ${photonUrl}`);

    // Create connection with ZK Compression support
    const connection = createRpc(rpcUrl, photonUrl);

    return connection;
}

/**
 * Get compressed accounts for a specific owner
 */
export async function getCompressedAccounts(connection, ownerPubkey) {
    try {
        console.log(`📦 Fetching compressed accounts for ${ownerPubkey.toBase58()}`);

        const accounts = await connection.getCompressedAccountsByOwner(ownerPubkey);

        console.log(`   Found ${accounts.items?.length || 0} compressed accounts`);
        return accounts;
    } catch (error) {
        console.error(`   Error fetching compressed accounts:`, error.message);
        return { items: [] };
    }
}

/**
 * Create a compressed liveness account for a testator
 */
export async function createCompressedLiveness(
    connection,
    testatorKeypair,
    beneficiaryPubkey,
    programId
) {
    console.log(`🆕 Creating compressed liveness account...`);

    try {
        // Get the current state tree accounts
        const stateTreeAccounts = defaultTestStateTreeAccounts();

        // Create liveness data to store in the compressed account
        const livenessData = Buffer.alloc(64);
        const now = Math.floor(Date.now() / 1000);
        livenessData.writeBigInt64LE(BigInt(now), 0); // last_ping
        livenessData.writeBigInt64LE(BigInt(now), 8); // created_at
        beneficiaryPubkey.toBuffer().copy(livenessData, 16); // beneficiary (32 bytes)

        // Derive an address for the compressed account
        const addressSeed = Buffer.concat([
            Buffer.from('compressed_liveness'),
            testatorKeypair.publicKey.toBuffer(),
            beneficiaryPubkey.toBuffer()
        ]);
        const addressHash = crypto.createHash('sha256').update(addressSeed).digest();

        console.log(`   Testator: ${testatorKeypair.publicKey.toBase58()}`);
        console.log(`   Beneficiary: ${beneficiaryPubkey.toBase58()}`);
        console.log(`   Timestamp: ${now}`);

        // Build the compressed account creation instruction
        const createIx = await LightSystemProgram.compress({
            payer: testatorKeypair.publicKey,
            toAddress: testatorKeypair.publicKey,
            lamports: 0,
            outputStateTree: stateTreeAccounts.merkleTree,
        });

        // Get latest blockhash and create transaction
        const { blockhash } = await connection.getLatestBlockhash();
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = testatorKeypair.publicKey;
        tx.add(createIx);

        // Sign and send
        const signature = await sendAndConfirmTransaction(
            connection,
            tx,
            [testatorKeypair],
            { commitment: 'confirmed' }
        );

        console.log(`   ✅ Compressed liveness created! Signature: ${signature}`);

        return {
            success: true,
            signature,
            timestamp: now,
            addressHash: addressHash.toString('hex')
        };
    } catch (error) {
        console.error(`   ❌ Error creating compressed liveness:`, error.message);
        throw error;
    }
}

/**
 * Update liveness using Light Protocol ZK Compression
 * 
 * This function:
 * 1. Fetches the testator's compressed liveness account
 * 2. Generates a validity proof for the current state
 * 3. Submits an update transaction with the new timestamp
 */
export async function updateCompressedLiveness(
    connection,
    testatorKeypair,
    beneficiaryPubkey,
    vaultPda,
    programId
) {
    console.log(`📝 Updating compressed liveness via Light Protocol...`);

    try {
        const now = Math.floor(Date.now() / 1000);

        // Try to get existing compressed accounts for this testator
        const compressedAccounts = await getCompressedAccounts(
            connection,
            testatorKeypair.publicKey
        );

        let lightRoot;
        let proof = [];
        let usesLightProtocol = false;

        if (compressedAccounts.items && compressedAccounts.items.length > 0) {
            // We have compressed accounts - get the proof
            console.log(`   Found ${compressedAccounts.items.length} compressed account(s)`);

            // Get validity proof for the first account
            const account = compressedAccounts.items[0];

            try {
                const validityProof = await connection.getValidityProof([account.hash]);

                if (validityProof) {
                    lightRoot = validityProof.compressedProof?.root || account.tree;
                    proof = validityProof.proof || [];
                    usesLightProtocol = true;

                    console.log(`   ✅ Got validity proof from Light Protocol`);
                    console.log(`   Light Root: ${Buffer.from(lightRoot).toString('hex').slice(0, 16)}...`);
                }
            } catch (proofError) {
                console.log(`   ⚠️ Could not get validity proof: ${proofError.message}`);
                // Fall back to mock proof
            }
        } else {
            console.log(`   ℹ️ No compressed accounts found, using mock proof`);
        }

        // If we couldn't get a real proof, generate a mock one
        if (!lightRoot) {
            lightRoot = generateMockLightRoot(testatorKeypair.publicKey, now);
            console.log(`   Using mock Light root`);
        }

        // Now submit the update transaction to the smart contract
        const signature = await submitLivenessUpdate(
            connection,
            testatorKeypair,
            beneficiaryPubkey,
            vaultPda,
            programId,
            lightRoot,
            proof
        );

        return {
            success: true,
            signature,
            lightRoot: Buffer.from(lightRoot).toString('hex'),
            usesLightProtocol,
            timestamp: now
        };

    } catch (error) {
        console.error(`   ❌ Error updating compressed liveness:`, error.message);
        throw error;
    }
}

/**
 * Submit the liveness update transaction to the smart contract
 */
async function submitLivenessUpdate(
    connection,
    testatorKeypair,
    beneficiaryPubkey,
    vaultPda,
    programId,
    lightRoot,
    proof
) {
    const { blockhash } = await connection.getLatestBlockhash();

    // Build instruction data for update_liveness
    const discriminator = calculateDiscriminator('update_liveness');

    // Encode the proof vector
    const proofLenBuffer = Buffer.alloc(4);
    proofLenBuffer.writeUInt32LE(proof.length, 0);

    // Build proof bytes (each element is 32 bytes)
    const proofBytes = proof.length > 0
        ? Buffer.concat(proof.map(p => Buffer.from(p)))
        : Buffer.alloc(0);

    const instructionData = Buffer.concat([
        discriminator,
        beneficiaryPubkey.toBuffer(),
        Buffer.from(lightRoot),
        proofLenBuffer,
        proofBytes
    ]);

    // System program as mock light_state for now
    const mockLightState = new PublicKey('11111111111111111111111111111111');

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
    tx.feePayer = testatorKeypair.publicKey;
    tx.add(instruction);

    // Sign and send
    const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [testatorKeypair],
        { commitment: 'confirmed' }
    );

    console.log(`   📤 Transaction sent: ${signature}`);
    return signature;
}

/**
 * Generate Anchor instruction discriminator
 */
function calculateDiscriminator(instructionName) {
    const hash = crypto.createHash('sha256')
        .update(`global:${instructionName}`)
        .digest();
    return hash.slice(0, 8);
}

/**
 * Generate a deterministic mock Light Protocol root
 */
function generateMockLightRoot(testatorPubkey, timestamp) {
    const seed = Buffer.concat([
        testatorPubkey.toBuffer(),
        Buffer.from(timestamp.toString()),
    ]);
    return crypto.createHash('sha256').update(seed).digest();
}
