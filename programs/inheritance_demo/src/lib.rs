use anchor_lang::prelude::*;

declare_id!("PQ6EV39W9BQECUnf4v7MPbPCxJwgmwvUwrLY67u13QE");

#[program]
pub mod inheritance_demo {
    use super::*;

    pub fn init_inheritance(
        ctx: Context<InitInheritance>,
        beneficiary: Pubkey,
        timeout_secs: i64,
        lamports: u64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.testator = ctx.accounts.testator.key();
        vault.beneficiary = beneficiary;
        vault.last_ping = Clock::get()?.unix_timestamp;
        vault.timeout_secs = timeout_secs;
        vault.executed = false;
        vault.lamports = lamports;
        vault.light_commitment = None;
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

    pub fn update_liveness(
        ctx: Context<UpdateLiveness>,
        _beneficiary: Pubkey,
        light_commitment: Option<[u8; 32]>,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.last_ping = Clock::get()?.unix_timestamp;

        // TODO: Verify Light Protocol commitment proof
        // In a real implementation, this would verify the ZK proof from Light Protocol
        // that attests to the off-chain liveness update being committed on-chain.
        // For now, we just store the commitment hash as a mock.
        if let Some(commitment) = light_commitment {
            vault.light_commitment = Some(commitment);
            // Future: Verify commitment against Light Protocol state tree root
            // Future: Verify ZK proof validity
        }

        Ok(())
    }

    pub fn execute_inheritance(ctx: Context<ExecuteInheritance>) -> Result<()> {
        // Verify testator matches vault's stored testator
        require!(
            ctx.accounts.testator.key() == ctx.accounts.vault.testator,
            ErrorCode::Unauthorized
        );
        // Check if already executed first (before checking timestamp)
        require!(!ctx.accounts.vault.executed, ErrorCode::AlreadyExecuted);
        
        // Get account info first before borrowing vault mutably
        let vault_account_info = ctx.accounts.vault.to_account_info();
        let vault_lamports = ctx.accounts.vault.lamports;
        
        let now = Clock::get()?.unix_timestamp;
        require!(
            now > ctx.accounts.vault.last_ping + ctx.accounts.vault.timeout_secs,
            ErrorCode::StillAlive
        );
        
        // Check for assets BEFORE rent calculation
        require!(vault_lamports > 0, ErrorCode::NoAssets);

        // Transfer SOL from vault PDA to beneficiary
        let transfer_amount = vault_lamports;
        
        // Ensure vault account remains rent-exempt after transfer
        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(vault_account_info.data_len());
        let current_balance = vault_account_info.lamports();
        require!(
            current_balance - transfer_amount >= min_rent,
            ErrorCode::InsufficientFundsForRent
        );

        // Now we can mutate vault
        let vault = &mut ctx.accounts.vault;
        vault.lamports = 0;
        vault.executed = true;

        // Transfer lamports
        **vault_account_info.try_borrow_mut_lamports()? -= transfer_amount;
        **ctx.accounts.beneficiary.to_account_info().try_borrow_mut_lamports()? += transfer_amount;

        Ok(())
    }
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

    /// CHECK: Used only for PDA derivation, verified via has_one on vault
    pub testator: AccountInfo<'info>,

    #[account(mut)]
    pub beneficiary: Signer<'info>,
}

#[account]
pub struct Vault {
    pub testator: Pubkey,
    pub beneficiary: Pubkey,
    pub last_ping: i64,
    pub timeout_secs: i64,
    pub executed: bool,
    pub lamports: u64,
    pub light_commitment: Option<[u8; 32]>,
    pub bump: u8,
}

impl Vault {
    pub const SIZE: usize =
        32 + // testator
        32 + // beneficiary
        8  + // last_ping
        8  + // timeout
        1  + // executed
        8  + // lamports
        1  + // Option discriminator for light_commitment
        32 + // light_commitment (32 bytes)
        1;   // bump
}

#[error_code]
pub enum ErrorCode {
    #[msg("Testator still alive")]
    StillAlive,
    #[msg("Inheritance already executed")]
    AlreadyExecuted,
    #[msg("Unauthorized: caller is not the beneficiary")]
    Unauthorized,
    #[msg("No assets in vault")]
    NoAssets,
    #[msg("Insufficient funds to maintain rent exemption")]
    InsufficientFundsForRent,
}
