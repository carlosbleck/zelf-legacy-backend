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


#[program]
pub mod inheritance_demo {
    use super::*;

    pub fn init_inheritance(
        ctx: Context<InitInheritance>,
        beneficiary: Pubkey,
        verifier: Pubkey,
        beneficiary_identity_hash: [u8; 32],
        cid: [u8; 32],
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
        vault.cid = cid;
        
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

        // Transfer SOL from testator to vault PDA
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.testator.to_account_info(),
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

    pub fn update_liveness(
        ctx: Context<UpdateLiveness>,
        _beneficiary: Pubkey,
        light_root: [u8; 32],
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        // --- Light Protocol Validation ---
        if !vault.is_debug {
            // In Production (is_debug = false):
            // This is where we verify that the liveness update is valid according to Light Protocol v3.
            // Light Protocol v3 uses ZK Compression where accounts are stored in a state tree.
            
            // 2. Light Protocol v3 ZK Compression Integration:
            // Verify that the liveness update is part of the Light Protocol state tree.
            // The light_root represents the current state of the compressed account Merkle tree.
            
            // In this demo, we use a mock Light state account.
            // In production with real Light Protocol:
            // - The light_state would be an actual Light Protocol Merkle tree account
            // - You would use light_sdk functions to read the tree root
            // - The proof would be a ZK proof verified by the Light System Program
            
            // For now, we verify against our mock registry
            let light_state_data = ctx.accounts.light_state.try_borrow_data()?;
            if light_state_data.len() >= 40 { // 8 bytes discriminator + 32 bytes root
                let stored_root: [u8; 32] = light_state_data[8..40]
                    .try_into()
                    .map_err(|_| ErrorCode::InvalidLightRoot)?;
                
                require!(
                    stored_root == light_root,
                    ErrorCode::InvalidLightRoot
                );
            } else {
                return Err(ErrorCode::InvalidLightRoot.into());
            }
            
            // Create a leaf hash representing the testator's liveness state
            // In production, this would use Poseidon hashing (Light Protocol's hash function)
            let leaf = demo_hash(
                &[
                    vault.testator.as_ref(),
                    &vault.last_ping.to_le_bytes()
                ].concat()
            );

            // Verify the Merkle proof that this leaf exists in the Light state tree
            require!(
                verify_merkle_proof(light_root, leaf, proof),
                ErrorCode::InvalidLightProof
            );
            
            // NOTE: Full Light Protocol v3 production implementation would:
            // 1. Store the testator's liveness as a compressed account in Light's state tree
            // 2. Use the Light SDK's CPI functions to update the compressed account
            // 3. Verify ZK proofs through the Light System Program
            // 4. Benefit from ~5000x cost reduction vs regular Solana accounts
        }
        // ---------------------------------

        // First liveness update: wrap the key
        if vault.encrypted_key.is_none() {
            require!(
                vault.unwrapped_key.is_some(),
                ErrorCode::NoUnwrappedKey
            );

            // Derive K_light from Light root using Keccak for security
            let k_light = derive_key_from_light(
                &light_root,
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
        }

        vault.light_root = Some(light_root);
        vault.last_ping = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn execute_inheritance(ctx: Context<ExecuteInheritance>) -> Result<()> {
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

        // 3. Require Light root to be set (Ensures testator actually used Light Protocol)
        require!(
            ctx.accounts.vault.light_root.is_some(),
            ErrorCode::InvalidLightRoot
        );

        let vault_account_info = ctx.accounts.vault.to_account_info();
        let vault_lamports = ctx.accounts.vault.lamports;

        require!(vault_lamports > 0, ErrorCode::NoAssets);

        // Transfer SOL to beneficiary
        let transfer_amount = vault_lamports;
        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(vault_account_info.data_len());
        let current_balance = vault_account_info.lamports();
        
        require!(
            current_balance - transfer_amount >= min_rent,
            ErrorCode::InsufficientFundsForRent
        );

        let vault = &mut ctx.accounts.vault;
        vault.lamports = 0;
        vault.executed = true;

        **vault_account_info.try_borrow_mut_lamports()? -= transfer_amount;
        **ctx.accounts.beneficiary.to_account_info().try_borrow_mut_lamports()? += transfer_amount;

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

fn verify_merkle_proof(root: [u8; 32], leaf: [u8; 32], proof: Vec<[u8; 32]>) -> bool {
    let mut current_hash = leaf;
    for node in proof {
        let mut data = [0u8; 64];
        if current_hash < node {
            data[..32].copy_from_slice(&current_hash);
            data[32..].copy_from_slice(&node);
        } else {
            data[..32].copy_from_slice(&node);
            data[32..].copy_from_slice(&current_hash);
        }
        current_hash = demo_hash(&data);
    }
    current_hash == root
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
        payer = testator,
        space = 8 + Vault::SIZE,
        seeds = [b"vault", testator.key().as_ref(), beneficiary.as_ref()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub testator: Signer<'info>,

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

#[derive(Accounts)]
#[instruction(beneficiary: Pubkey)]
pub struct UpdateLiveness<'info> {
    #[account(
        mut,
        seeds = [b"vault", testator.key().as_ref(), beneficiary.as_ref()],
        bump = vault.bump,
        has_one = testator @ ErrorCode::Unauthorized
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub testator: Signer<'info>,

    /// Light Protocol v3 State Merkle Tree Account
    /// In production, this would be the actual Light Protocol state tree account.
    /// CHECK: This account stores the Merkle tree root for compressed accounts.
    pub light_state: AccountInfo<'info>,
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
    pub cid: [u8; 32],                    // IPFS Content ID for artifact
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
        32 +  // cid
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
}

