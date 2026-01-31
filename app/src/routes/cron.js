import { Router } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { sendInheritanceNotification } from '../services/email.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// Path to store notification tracking
const NOTIFICATIONS_FILE = path.join(__dirname, '../../data/notifications.json');

/**
 * GET /api/cron/check-expired-vaults
 * 
 * Checks all vaults in the system for expired ones and sends email notifications
 * to beneficiaries who haven't been notified yet.
 * 
 * This endpoint should be called by a cron job (e.g., every 6-24 hours).
 */
router.get('/check-expired-vaults', async (req, res) => {
    try {
        console.log('\n🔍 Cron Job: Checking for expired vaults...');

        const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'PQ6EV39W9BQECUnf4v7MPbPCxJwgmwvUwrLY67u13QE');
        const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
        const connection = new Connection(RPC_URL, 'confirmed');

        // Get all vault accounts for this program
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
            encoding: 'base64',
            filters: [
                {
                    dataSize: 511 // Vault account size
                }
            ]
        });

        console.log(`   Found ${accounts.length} vault(s)`);

        // Load notification tracking
        const notifiedVaults = await loadNotifiedVaults();
        const now = Math.floor(Date.now() / 1000);

        let expiredCount = 0;
        let notifiedCount = 0;
        const newlyExpired = [];

        for (const account of accounts) {
            try {
                const vaultAddress = account.pubkey.toBase58();
                const data = account.account.data;

                // Parse vault data
                const buffer = Buffer.from(data, 'base64');

                // Skip discriminator (8 bytes)
                const testator = new PublicKey(buffer.slice(8, 40));
                const beneficiary = new PublicKey(buffer.slice(40, 72));
                const lastPing = Number(buffer.readBigInt64LE(168));
                const timeoutSecs = Number(buffer.readBigInt64LE(192));
                const executed = buffer[200] === 1;

                // Extract beneficiary email (stored at offset 232, 100 bytes max)
                const emailBytes = buffer.slice(232, 332);
                const emailEndIndex = emailBytes.indexOf(0);
                const beneficiaryEmail = emailEndIndex > 0
                    ? emailBytes.slice(0, emailEndIndex).toString('utf8').trim()
                    : '';

                // Extract CID validator for tagName (stored at offset 104, 32 bytes)
                const cidValidator = buffer.slice(104, 136);
                const cidValidatorHex = Buffer.from(cidValidator).toString('hex');

                const timeSincePing = now - lastPing;
                const isExpired = timeSincePing > timeoutSecs && !executed;

                if (isExpired) {
                    expiredCount++;
                    console.log(`   ⏰ Expired vault found: ${vaultAddress}`);
                    console.log(`      Beneficiary: ${beneficiary.toBase58()}`);
                    console.log(`      Email: ${beneficiaryEmail || 'N/A'}`);
                    console.log(`      Time since last ping: ${Math.floor(timeSincePing / 86400)} days`);

                    // Validate email format
                    const isValidEmail = beneficiaryEmail && beneficiaryEmail.includes('@') && beneficiaryEmail.includes('.');

                    // Check if we've already notified this vault
                    if (!notifiedVaults[vaultAddress] && isValidEmail) {
                        try {
                            // Send email notification
                            await sendInheritanceNotification(
                                beneficiaryEmail,
                                cidValidatorHex,
                                'Your loved one',
                                true // isExpired = true
                            );

                            // Mark as notified
                            notifiedVaults[vaultAddress] = {
                                notifiedAt: new Date().toISOString(),
                                beneficiaryEmail,
                                vaultAddress
                            };

                            newlyExpired.push({
                                vaultAddress,
                                beneficiaryEmail,
                                testator: testator.toBase58(),
                                beneficiary: beneficiary.toBase58()
                            });

                            notifiedCount++;
                            console.log(`      ✅ Email sent to ${beneficiaryEmail}`);
                        } catch (emailError) {
                            console.error(`      ❌ Failed to send email: ${emailError.message}`);
                        }
                    } else if (notifiedVaults[vaultAddress]) {
                        console.log(`      ℹ️ Already notified on ${notifiedVaults[vaultAddress].notifiedAt}`);
                    } else if (!isValidEmail) {
                        console.log(`      ⚠️ Invalid email format: ${beneficiaryEmail || 'N/A'}`);
                    } else {
                        console.log(`      ⚠️ No beneficiary email on record`);
                    }
                }
            } catch (parseError) {
                console.error(`   ❌ Error parsing vault: ${parseError.message}`);
            }
        }

        // Save updated notification tracking
        await saveNotifiedVaults(notifiedVaults);

        console.log(`\n✅ Cron job completed:`);
        console.log(`   Total vaults: ${accounts.length}`);
        console.log(`   Expired vaults: ${expiredCount}`);
        console.log(`   Newly notified: ${notifiedCount}`);

        res.json({
            success: true,
            summary: {
                totalVaults: accounts.length,
                expiredVaults: expiredCount,
                newlyNotified: notifiedCount,
                newlyExpiredVaults: newlyExpired
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Cron job failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/cron/notification-status
 * 
 * Get the current notification tracking status.
 */
router.get('/notification-status', async (req, res) => {
    try {
        const notifiedVaults = await loadNotifiedVaults();

        res.json({
            success: true,
            notifiedVaults: Object.keys(notifiedVaults).length,
            vaults: notifiedVaults
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Load the notification tracking file.
 */
async function loadNotifiedVaults() {
    try {
        // Ensure data directory exists
        const dataDir = path.dirname(NOTIFICATIONS_FILE);
        await fs.mkdir(dataDir, { recursive: true });

        const data = await fs.readFile(NOTIFICATIONS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist yet, return empty object
            return {};
        }
        throw error;
    }
}

/**
 * Save the notification tracking file.
 */
async function saveNotifiedVaults(notifiedVaults) {
    const dataDir = path.dirname(NOTIFICATIONS_FILE);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(NOTIFICATIONS_FILE, JSON.stringify(notifiedVaults, null, 2), 'utf8');
}

export { router as cronRouter };
