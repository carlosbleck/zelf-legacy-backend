use anchor_lang::prelude::*;
use light_sdk::{
    derive_light_cpi_signer,
    CpiSigner,
    LightAccount,
    LightDiscriminator,
    address::v1::derive_address,
    cpi::{v1::{CpiAccounts, LightSystemProgramCpi}, InvokeLightSystemProgram, LightCpiInstruction},
};
use light_sdk::instruction::ValidityProof as LightValidityProof;
use borsh::{BorshSerialize, BorshDeserialize};

declare_id!("PQ6EV39W9BQECUnf4v7MPbPCxJwgmwvUwrLY67u13QE");

/// Light Protocol CPI Signer - derived from program ID
pub const LIGHT_CPI_SIGNER: CpiSigner = 
    derive_light_cpi_signer!("PQ6EV39W9BQECUnf4v7MPbPCxJwgmwvUwrLY67u13QE");

/// Anchor-compatible wrapper for Light Protocol ValidityProof
/// Serialized as raw bytes to avoid Anchor IDL compatibility issues
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidityProofData {
    pub data: Vec<u8>,
}

/// Anchor-compatible wrapper for Light Protocol PackedAddressTreeInfo
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AddressTreeInfoData {
    pub address_merkle_tree_pubkey_index: u8,
    pub address_queue_pubkey_index: u8,
}

/// Compressed Liveness Account - stored in Light Protocol's state tree
/// This is a ZK-compressed account that tracks testator liveness at ~200x lower cost
#[derive(Clone, Debug, Default, LightDiscriminator, BorshSerialize, BorshDeserialize)]
pub struct CompressedLiveness {
    pub testator: Pubkey,
    pub last_ping: i64,
    pub vault_address: Pubkey,
}

/// Event emitted when an inheritance is successfully executed.
/// Contains the encrypted password (the "reward") that the beneficiary can use
/// to decrypt and recover the testator's mnemonic/ZelfProof.
#[event]
pub struct InheritanceExecuted {
    pub vault: Pubkey,
    pub beneficiary: Pubkey,
    pub testator: Pubkey,
    /// The encrypted password - this is the key to unlock the ZelfProof
    pub encrypted_password: Vec<u8>,
    /// The IPFS CID where the encrypted ZelfProof is stored
    pub cid: [u8; 32],
    /// The IPFS CID for validator data
    pub cid_validator: [u8; 32],
    /// The beneficiary's identity hash for verification
    pub beneficiary_identity_hash: [u8; 32],
    /// SHA-256 hash of beneficiary's email for lookup
    pub beneficiary_email_hash: [u8; 32],
    /// SHA-256 hash of beneficiary's document ID for lookup
    pub beneficiary_document_id_hash: [u8; 32],
}

/// Event emitted when a beneficiary successfully verifies their identity.
/// This confirms the user is a valid beneficiary for the given vault.
#[event]
pub struct BeneficiaryVerified {
    pub vault: Pubkey,
    pub beneficiary: Pubkey,
    pub testator: Pubkey,
    /// The IPFS CID where the encrypted ZelfProof is stored
    pub cid: [u8; 32],
    /// The IPFS CID for validator data
    pub cid_validator: [u8; 32],
    /// Whether the vault is currently claimable
    pub is_claimable: bool,
    /// Whether the inheritance has already been executed
    pub executed: bool,
}

#[program]
pub mod inheritance_demo {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn init_inheritance(
        ctx: Context<InitInheritance>,
        beneficiary: Pubkey,
        verifier: Pubkey,
        beneficiary_identity_hash: [u8; 32],
        beneficiary_email_hash: [u8; 32],
        beneficiary_document_id_hash: [u8; 32],
        cid: [u8; 32],
        cid_validator: [u8; 32],
        warning_timeout_secs: i64,
        timeout_secs: i64,
        lamports: u64,
        encrypted_password: Vec<u8>,
        unwrapped_key: [u8; 32],
        is_debug: bool,
    ) -> Result<()> {
        // Validate encrypted password
        require!(!encrypted_password.is_empty(), ErrorCode::EmptyEncryptedPassword);
        require!(
            encrypted_password.len() <= Vault::MAX_ENCRYPTED_PASSWORD_SIZE,
            ErrorCode::EncryptedPasswordTooLarge
        );
        require!(warning_timeout_secs < timeout_secs, ErrorCode::InvalidWarningTimeout);

        let vault = &mut ctx.accounts.vault;
        vault.testator = ctx.accounts.testator.key();
        vault.beneficiary = beneficiary;
        vault.verifier = verifier; // Set the trusted identity verifier
        vault.beneficiary_identity_hash = beneficiary_identity_hash;
        vault.beneficiary_email_hash = beneficiary_email_hash;
        vault.beneficiary_document_id_hash = beneficiary_document_id_hash;
        vault.cid = cid;
        vault.cid_validator = cid_validator;
        
        let now = Clock::get()?.unix_timestamp;
        vault.last_ping = now;
        vault.created_at = now;
        vault.warning_timeout_secs = warning_timeout_secs;
        vault.timeout_secs = timeout_secs;
        vault.executed = false;
        vault.lamports = lamports;
        vault.encrypted_password = encrypted_password;
        vault.encrypted_key = None;
        vault.unwrapped_key = Some(unwrapped_key);
        vault.light_root = None;
        vault.is_debug = is_debug;
        vault.has_compressed_liveness = false;
        vault.bump = ctx.bumps.vault;

        // Transfer initial deposit from PAYER (not testator) to vault
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            lamports,
        )?;

        Ok(())
    }

    /// Create a compressed liveness account in Light Protocol's state tree.
    /// This uses ZK Compression to store liveness data at ~200x lower cost.
    /// 
    /// Note: This instruction requires Light Protocol system accounts to be passed
    /// via remaining_accounts. Use the Light SDK client to prepare these accounts.
    pub fn create_compressed_liveness<'info>(
        ctx: Context<'_, '_, '_, 'info, CreateCompressedLiveness<'info>>,
        proof_data: ValidityProofData,
        address_tree_info: AddressTreeInfoData,
        output_tree_index: u8,
    ) -> Result<()> {
        // Deserialize the validity proof from raw bytes
        let proof = LightValidityProof::try_from_slice(&proof_data.data)
            .map_err(|_| ErrorCode::InvalidLightProof)?;
        
        // Create Light CPI accounts from remaining accounts
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.fee_payer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Get the address tree pubkey from remaining accounts
        let address_tree_pubkey = ctx.remaining_accounts
            .get(address_tree_info.address_merkle_tree_pubkey_index as usize)
            .ok_or(ErrorCode::InvalidLightRoot)?
            .key();

        // Derive unique address for this testator's liveness account
        let (address, address_seed) = derive_address(
            &[b"liveness", ctx.accounts.testator.key().as_ref()],
            &address_tree_pubkey,
            &crate::ID,
        );
        
        // Create packed address params manually
        let new_address_params = light_sdk::address::PackedNewAddressParams {
            seed: address_seed.into(),
            address_merkle_tree_account_index: address_tree_info.address_merkle_tree_pubkey_index,
            address_queue_account_index: address_tree_info.address_queue_pubkey_index,
            address_merkle_tree_root_index: 0, // Will be filled by Light Protocol
        };

        // Create the compressed liveness account
        let mut liveness_account = LightAccount::<CompressedLiveness>::new_init(
            &crate::ID,
            Some(address),
            output_tree_index,
        );

        liveness_account.testator = ctx.accounts.testator.key();
        liveness_account.last_ping = Clock::get()?.unix_timestamp;
        liveness_account.vault_address = ctx.accounts.vault.key();

        // CPI to Light System Program to create the compressed account
        LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(liveness_account)
            .map_err(|_| ErrorCode::InvalidLightProof)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)
            .map_err(|_| ErrorCode::InvalidLightProof)?;

        // Mark that the vault now has a compressed liveness account
        let vault = &mut ctx.accounts.vault;
        vault.has_compressed_liveness = true;

        Ok(())
    }

    /// Update liveness using Light Protocol ZK Compression.
    /// This function updates the compressed liveness account in the state tree
    /// and updates the vault's last_ping timestamp.
    pub fn update_liveness<'info>(
        ctx: Context<'_, '_, '_, 'info, UpdateLiveness<'info>>,
        proof_data: ValidityProofData,
        output_tree_index: u8,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let now = Clock::get()?.unix_timestamp;

        // --- Light Protocol CPI Update ---
        if vault.has_compressed_liveness && !vault.is_debug {
            // Deserialize the validity proof from raw bytes
            let proof = LightValidityProof::try_from_slice(&proof_data.data)
                .map_err(|_| ErrorCode::InvalidLightProof)?;
            
            // Create Light CPI accounts from remaining accounts
            let light_cpi_accounts = CpiAccounts::new(
                ctx.accounts.fee_payer.as_ref(),
                ctx.remaining_accounts,
                crate::LIGHT_CPI_SIGNER,
            );

            // Derive the address for this testator's liveness account
            // Must match the address used in create_compressed_liveness
            let address_tree_pubkey = ctx.remaining_accounts
                .get(0)
                .ok_or(ErrorCode::InvalidLightRoot)?
                .key();

            let (address, _) = derive_address(
                &[b"liveness", ctx.accounts.testator.key().as_ref()],
                &address_tree_pubkey,
                &crate::ID,
            );

            // Update the compressed liveness account with new timestamp
            let mut liveness_account = LightAccount::<CompressedLiveness>::new_update(
                &crate::ID,
                Some(address),
                output_tree_index,
            );

            liveness_account.testator = ctx.accounts.testator.key();
            liveness_account.last_ping = now;
            liveness_account.vault_address = vault.key();

            // CPI to Light System Program to update the compressed account
            LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
                .with_light_account(liveness_account)
                .map_err(|_| ErrorCode::InvalidLightProof)?
                .invoke(light_cpi_accounts)
                .map_err(|_| ErrorCode::InvalidLightProof)?;

            msg!("✅ Compressed liveness updated via Light Protocol");
        } else if vault.is_debug {
            msg!("⚠️ Debug mode: Skipping Light Protocol verification");
        } else {
            msg!("ℹ️ No compressed liveness account, using standard update");
        }
        // ---------------------------------

        // First liveness update: wrap the key
        if vault.encrypted_key.is_none() {
            require!(
                vault.unwrapped_key.is_some(),
                ErrorCode::NoUnwrappedKey
            );

            // Derive K_light from a deterministic source
            // In production with real Light Protocol, this would use the actual state root
            let mock_root = demo_hash(&[vault.testator.as_ref(), &now.to_le_bytes()].concat());
            let k_light = derive_key_from_light(
                &mock_root,
                &vault.key(),
                &vault.beneficiary,
            );

            // Encrypt K with K_light (simple XOR for demo)
            let k = vault.unwrapped_key.unwrap();
            let mut encrypted_key = Vec::with_capacity(32);
            for i in 0..32 {
                encrypted_key.push(k[i] ^ k_light[i]);
            }

            vault.encrypted_key = Some(encrypted_key);
            vault.unwrapped_key = None; // Clear plaintext
            vault.light_root = Some(mock_root);
        }

        vault.last_ping = now;

        Ok(())
    }

    /// Execute inheritance - transfers assets and reveals the encrypted password to the beneficiary.
    /// 
    /// # Arguments
    /// * `transfer_funds` - If true, transfer SOL to beneficiary. If false, only mark as executed and emit password.
    pub fn execute_inheritance(ctx: Context<ExecuteInheritance>, transfer_funds: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let state = ctx.accounts.vault.get_state(now);

        // 1. State Machine validation
        require!(state != VaultState::Executed, ErrorCode::AlreadyExecuted);
        require!(state == VaultState::Claimable, ErrorCode::TransitionNotAllowed);

        // 2. Identity Verification (Verifier must sign)
        // This confirms the "Face Scan + ID Match" from your diagram happened off-chain.
        require!(
            ctx.accounts.verifier.key() == ctx.accounts.vault.verifier,
            ErrorCode::InvalidVerifier
        );

        // 3. Light Protocol validation (skip in debug mode)
        // In debug mode, we don't require the Light root to be set.
        if !ctx.accounts.vault.is_debug {
            require!(
                ctx.accounts.vault.light_root.is_some(),
                ErrorCode::InvalidLightRoot
            );
        }

        // 4. Transfer SOL to beneficiary (if enabled)
        if transfer_funds {
            let vault_account_info = ctx.accounts.vault.to_account_info();
            let vault_lamports = ctx.accounts.vault.lamports;

            require!(vault_lamports > 0, ErrorCode::NoAssets);

            let transfer_amount = vault_lamports;
            let rent = Rent::get()?;
            let min_rent = rent.minimum_balance(vault_account_info.data_len());
            let current_balance = vault_account_info.lamports();
            
            require!(
                current_balance - transfer_amount >= min_rent,
                ErrorCode::InsufficientFundsForRent
            );

            ctx.accounts.vault.lamports = 0;

            **vault_account_info.try_borrow_mut_lamports()? -= transfer_amount;
            **ctx.accounts.beneficiary.to_account_info().try_borrow_mut_lamports()? += transfer_amount;
        }

        // 5. Mark as executed and emit the encrypted password as the "reward"
        let vault = &mut ctx.accounts.vault;
        vault.executed = true;

        // Emit an event with the encrypted password so the beneficiary can retrieve it
        emit!(InheritanceExecuted {
            vault: vault.key(),
            beneficiary: vault.beneficiary,
            testator: vault.testator,
            encrypted_password: vault.encrypted_password.clone(),
            cid: vault.cid,
            cid_validator: vault.cid_validator,
            beneficiary_identity_hash: vault.beneficiary_identity_hash,
            beneficiary_email_hash: vault.beneficiary_email_hash,
            beneficiary_document_id_hash: vault.beneficiary_document_id_hash,
        });

        Ok(())
    }

    pub fn init_light_registry(
        ctx: Context<InitLightRegistry>,
        initial_root: [u8; 32],
    ) -> Result<()> {
        let state = &mut ctx.accounts.light_state;
        state.current_root = initial_root;
        Ok(())
    }

    /// Verify if a given identity hash matches a vault's beneficiary_identity_hash.
    /// This allows a user to prove they are the intended beneficiary.
    /// 
    /// Returns an event with vault details if the identity matches.
    /// This is useful for beneficiaries to discover their inheritance claims.
    pub fn verify_beneficiary_identity(
        ctx: Context<VerifyBeneficiaryIdentity>,
        identity_hash: [u8; 32],
    ) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // Check if the provided identity hash matches
        require!(
            vault.beneficiary_identity_hash == identity_hash,
            ErrorCode::IdentityHashMismatch
        );
        
        // Emit an event with vault info for the beneficiary
        emit!(BeneficiaryVerified {
            vault: vault.key(),
            beneficiary: vault.beneficiary,
            testator: vault.testator,
            cid: vault.cid,
            cid_validator: vault.cid_validator,
            is_claimable: vault.get_state(Clock::get()?.unix_timestamp) == VaultState::Claimable,
            executed: vault.executed,
        });
        
        Ok(())
    }

    /// Cancel a will/inheritance - closes the vault account and returns SOL to the testator.
    /// This can only be called by the testator.
    pub fn cancel_will(ctx: Context<CancelWill>) -> Result<()> {
        let vault = &ctx.accounts.vault;
        
        // Safety check: Don't allow cancellation if already executed?
        // Actually, Anchor's 'close' will handle the transfer.
        // We just need to make sure the testator is the one signing (handled by accounts).
        require!(!vault.executed, ErrorCode::AlreadyExecuted);
        
        Ok(())
    }
}

fn derive_key_from_light(
    light_root: &[u8; 32],
    vault_pubkey: &Pubkey,
    beneficiary: &Pubkey,
) -> [u8; 32] {
    // Light Protocol v3: Keys are derived from the state tree index or root.
    // We use a deterministic XOR-based derivation for this demo.
    let mut key = [0u8; 32];
    for i in 0..32 {
        key[i] = light_root[i] ^ vault_pubkey.as_ref()[i] ^ beneficiary.as_ref()[i];
    }
    demo_hash(&key)
}

/// A simple XOR + bit-shift hash for demonstration purposes.
/// Replaces Keccak256 to avoid Edition 2024 build conflicts.
fn demo_hash(data: &[u8]) -> [u8; 32] {
    let mut hash = [0u8; 32];
    for (i, &byte) in data.iter().enumerate() {
        hash[i % 32] = hash[i % 32].wrapping_add(byte).rotate_left(3);
        hash[i % 32] ^= 0x55;
    }
    hash
}

#[derive(Accounts)]
#[instruction(beneficiary: Pubkey)]
pub struct InitInheritance<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Vault::SIZE,
        seeds = [b"vault", testator.key().as_ref(), beneficiary.as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// The testator who owns this will (must sign to prove ownership)
    pub testator: Signer<'info>,

    /// The payer who funds the vault creation and initial deposit
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Accounts for creating a compressed liveness account in Light Protocol
#[derive(Accounts)]
pub struct CreateCompressedLiveness<'info> {
    #[account(
        mut,
        seeds = [b"vault", testator.key().as_ref(), vault.beneficiary.as_ref()],
        bump = vault.bump,
        has_one = testator @ ErrorCode::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(mut)]
    pub testator: Signer<'info>,
    
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    
    // Light Protocol system accounts are passed via remaining_accounts
}

/// Accounts for updating liveness via Light Protocol
#[derive(Accounts)]
pub struct UpdateLiveness<'info> {
    #[account(
        mut,
        seeds = [b"vault", testator.key().as_ref(), vault.beneficiary.as_ref()],
        bump = vault.bump,
        has_one = testator @ ErrorCode::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
    
    #[account(mut)]
    pub testator: Signer<'info>,
    
    #[account(mut)]
    pub fee_payer: Signer<'info>,
    
    // Light Protocol system accounts are passed via remaining_accounts:
    // - Address Merkle Tree
    // - State Tree
    // - Light System Program
    // These are dynamically provided by the Light SDK client
}

// Removed InitLightRegistry - in production, Light Protocol manages its own state trees
// For testing, we use a mock LightProtocolState account

#[account]
pub struct LightProtocolState {
    pub current_root: [u8; 32],
}

#[derive(Accounts)]
pub struct InitLightRegistry<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32
    )]
    pub light_state: Account<'info, LightProtocolState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteInheritance<'info> {
    #[account(
        mut,
        seeds = [b"vault", testator.key().as_ref(), beneficiary.key().as_ref()],
        bump = vault.bump,
        has_one = beneficiary @ ErrorCode::Unauthorized
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: Validated via seeds on vault
    pub testator: AccountInfo<'info>,

    #[account(mut)]
    pub beneficiary: Signer<'info>,

    /// The Oracle/Verifier that confirms the biometric face match
    pub verifier: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(identity_hash: [u8; 32])]
pub struct VerifyBeneficiaryIdentity<'info> {
    #[account(
        seeds = [b"vault", vault.testator.as_ref(), vault.beneficiary.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
}

#[derive(Accounts)]
pub struct CancelWill<'info> {
    #[account(
        mut,
        seeds = [b"vault", testator.key().as_ref(), vault.beneficiary.as_ref()],
        bump = vault.bump,
        has_one = testator @ ErrorCode::Unauthorized,
        close = testator
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub testator: Signer<'info>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum VaultState {
    Active,
    Warning,
    Claimable,
    Executed,
}

#[account]
pub struct Vault {
    pub testator: Pubkey,
    pub beneficiary: Pubkey,
    pub verifier: Pubkey,                // Authorized Verifier (Oracle)
    pub beneficiary_identity_hash: [u8; 32], // ZelfProof Identity Anchor
    pub beneficiary_email_hash: [u8; 32],    // SHA-256 hash of beneficiary email
    pub beneficiary_document_id_hash: [u8; 32], // SHA-256 hash of document ID
    pub cid: [u8; 32],                    // IPFS Content ID for artifact
    pub cid_validator: [u8; 32],          // IPFS Content ID for validator data
    pub last_ping: i64,
    pub created_at: i64,
    pub warning_timeout_secs: i64,
    pub timeout_secs: i64,
    pub executed: bool,
    pub lamports: u64,

    pub encrypted_password: Vec<u8>,
    pub encrypted_key: Option<Vec<u8>>,
    pub unwrapped_key: Option<[u8; 32]>,
    pub light_root: Option<[u8; 32]>,
    pub is_debug: bool,
    pub has_compressed_liveness: bool,    // NEW: Whether a compressed liveness account exists
    pub bump: u8,
}

impl Vault {
    pub const MAX_ENCRYPTED_PASSWORD_SIZE: usize = 64;
    pub const MAX_ENCRYPTED_KEY_SIZE: usize = 64;

    pub fn get_state(&self, now: i64) -> VaultState {
        if self.executed {
            return VaultState::Executed;
        }
        let time_since_ping = now.saturating_sub(self.last_ping);
        if time_since_ping > self.timeout_secs {
            VaultState::Claimable
        } else if time_since_ping > self.warning_timeout_secs {
            VaultState::Warning
        } else {
            VaultState::Active
        }
    }

    pub const SIZE: usize =
        32 +  // testator
        32 +  // beneficiary
        32 +  // verifier
        32 +  // beneficiary_identity_hash
        32 +  // beneficiary_email_hash
        32 +  // beneficiary_document_id_hash
        32 +  // cid
        32 +  // cid_validator
        8  +  // last_ping
        8  +  // created_at
        8  +  // warning_timeout_secs
        8  +  // timeout_secs
        1  +  // executed
        8  +  // lamports
        4  + Self::MAX_ENCRYPTED_PASSWORD_SIZE +  // Vec<u8> encrypted_password
        1  + 4 + Self::MAX_ENCRYPTED_KEY_SIZE +   // Option<Vec<u8>> encrypted_key
        1  + 32 +                                  // Option<[u8; 32]> unwrapped_key
        1  + 32 +                                  // Option<[u8; 32]> light_root
        1  +                                       // is_debug
        1  +                                       // has_compressed_liveness
        1;    // bump
}

#[error_code]
pub enum ErrorCode {
    #[msg("Testator still alive")]
    StillAlive,
    #[msg("Inheritance already executed")]
    AlreadyExecuted,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("No assets in vault")]
    NoAssets,
    #[msg("Insufficient funds to maintain rent exemption")]
    InsufficientFundsForRent,
    #[msg("Encrypted password cannot be empty")]
    EmptyEncryptedPassword,
    #[msg("Encrypted password exceeds maximum size")]
    EncryptedPasswordTooLarge,
    #[msg("No unwrapped key available for wrapping")]
    NoUnwrappedKey,
    #[msg("Invalid Light Protocol root (not found in registry)")]
    InvalidLightRoot,
    #[msg("Invalid Light Protocol proof")]
    InvalidLightProof,
    #[msg("Invalid warning timeout (must be less than total timeout)")]
    InvalidWarningTimeout,
    #[msg("Transition not allowed: vault not in claimable state")]
    TransitionNotAllowed,
    #[msg("Invalid verifier: Face match proof must be signed by the registered verifier")]
    InvalidVerifier,
    #[msg("Identity hash mismatch: The provided identity does not match the beneficiary.")]
    IdentityHashMismatch,
}

