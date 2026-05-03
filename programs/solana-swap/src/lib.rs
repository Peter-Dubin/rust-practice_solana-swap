use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("8gU4na42yZ8Po89WkbW6krWww8CDnoJKLHvcuSPimgjW");

const PRICE_DECIMAL_FACTOR: u64 = 1_000_000;

// ─── State ────────────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct MarketAccount {
    pub authority: Pubkey,
    pub token_mint_a: Pubkey,
    pub token_mint_b: Pubkey,
    pub price: u64,
    pub decimals_a: u8,
    pub decimals_b: u8,
    pub bump: u8,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

#[error_code]
pub enum SwapError {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
    #[msg("Exchange rate has not been set.")]
    PriceNotSet,
    #[msg("Amount out is too small.")]
    AmountOutTooSmall,
    #[msg("Invalid price for reverse swap (price is zero).")]
    InvalidPriceForReverseSwap,
    #[msg("The amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Arithmetic overflow during calculation.")]
    CalculationOverflow,
}

// ─── Program ──────────────────────────────────────────────────────────────────

#[program]
pub mod solana_swap {
    use super::*;

    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        price: u64,
        decimals_a: u8,
        decimals_b: u8,
        bump: u8,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.token_mint_a = ctx.accounts.token_mint_a.key();
        market.token_mint_b = ctx.accounts.token_mint_b.key();
        market.price = price;
        market.decimals_a = decimals_a;
        market.decimals_b = decimals_b;
        market.bump = bump;
        Ok(())
    }

    pub fn set_price(ctx: Context<SetPrice>, price: u64) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.market.authority,
            SwapError::Unauthorized
        );
        require!(price > 0, SwapError::PriceNotSet);
        ctx.accounts.market.price = price;
        Ok(())
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_a: u64,
        amount_b: u64,
    ) -> Result<()> {
        if amount_a > 0 {
            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_token_a.to_account_info(),
                    to: ctx.accounts.vault_a.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            );
            token::transfer(cpi_ctx, amount_a)?;
        }

        if amount_b > 0 {
            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority_token_b.to_account_info(),
                    to: ctx.accounts.vault_b.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            );
            token::transfer(cpi_ctx, amount_b)?;
        }

        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, amount: u64, a_to_b: bool) -> Result<()> {
        require!(amount > 0, SwapError::ZeroAmount);
        require!(ctx.accounts.market.price > 0, SwapError::PriceNotSet);

        let market = &ctx.accounts.market;
        let mint_a_key = market.token_mint_a.to_bytes();
        let mint_b_key = market.token_mint_b.to_bytes();
        let bump = market.bump;
        let seeds: &[&[u8]] = &[b"market", &mint_a_key, &mint_b_key, &[bump]];
        let signer_seeds = &[seeds];

        if a_to_b {
            // Transfer Token A: user → vault_a
            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_a.to_account_info(),
                    to: ctx.accounts.vault_a.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            );
            token::transfer(cpi_ctx, amount)?;

            // amount_b = amount * price * 10^decimals_b / PRICE_FACTOR / 10^decimals_b
            let decimals_b = market.decimals_b as u32;
            let numerator = (amount as u128)
                .checked_mul(market.price as u128)
                .ok_or(SwapError::CalculationOverflow)?
                .checked_mul(10u128.pow(decimals_b))
                .ok_or(SwapError::CalculationOverflow)?;
            let amount_b = numerator
                .checked_div(PRICE_DECIMAL_FACTOR as u128)
                .ok_or(SwapError::CalculationOverflow)?
                .checked_div(10u128.pow(decimals_b))
                .ok_or(SwapError::CalculationOverflow)? as u64;

            require!(amount_b > 0, SwapError::AmountOutTooSmall);

            // Transfer Token B: vault_b → user (PDA signs)
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_b.to_account_info(),
                    to: ctx.accounts.user_token_b.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, amount_b)?;
        } else {
            // B → A: Transfer Token B: user → vault_b
            let cpi_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_b.to_account_info(),
                    to: ctx.accounts.vault_b.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            );
            token::transfer(cpi_ctx, amount)?;

            // amount_a = amount_b * PRICE_FACTOR / price
            require!(market.price > 0, SwapError::InvalidPriceForReverseSwap);
            let amount_a = (amount as u128)
                .checked_mul(PRICE_DECIMAL_FACTOR as u128)
                .ok_or(SwapError::CalculationOverflow)?
                .checked_div(market.price as u128)
                .ok_or(SwapError::CalculationOverflow)? as u64;

            require!(amount_a > 0, SwapError::AmountOutTooSmall);

            // Transfer Token A: vault_a → user (PDA signs)
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_a.to_account_info(),
                    to: ctx.accounts.user_token_a.to_account_info(),
                    authority: ctx.accounts.market.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, amount_a)?;
        }

        Ok(())
    }
}

// ─── Account Contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(price: u64, decimals_a: u8, decimals_b: u8, bump: u8)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + MarketAccount::INIT_SPACE,
        seeds = [b"market", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()],
        bump,
    )]
    pub market: Account<'info, MarketAccount>,

    #[account(
        init,
        payer = authority,
        token::mint = token_mint_a,
        token::authority = market,
        seeds = [b"vault_a", market.key().as_ref()],
        bump,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        token::mint = token_mint_b,
        token::authority = market,
        seeds = [b"vault_b", market.key().as_ref()],
        bump,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPrice<'info> {
    #[account(
        mut,
        seeds = [b"market", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketAccount>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
    #[account(
        mut,
        seeds = [b"market", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()],
        bump = market.bump,
        has_one = authority,
    )]
    pub market: Account<'info, MarketAccount>,

    #[account(
        mut,
        seeds = [b"vault_a", market.key().as_ref()],
        bump,
        token::mint = token_mint_a,
        token::authority = market,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_b", market.key().as_ref()],
        bump,
        token::mint = token_mint_b,
        token::authority = market,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(mut, token::mint = token_mint_a)]
    pub authority_token_a: Account<'info, TokenAccount>,

    #[account(mut, token::mint = token_mint_b)]
    pub authority_token_b: Account<'info, TokenAccount>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        mut,
        seeds = [b"market", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()],
        bump = market.bump,
    )]
    pub market: Account<'info, MarketAccount>,

    #[account(
        mut,
        seeds = [b"vault_a", market.key().as_ref()],
        bump,
        token::mint = token_mint_a,
        token::authority = market,
    )]
    pub vault_a: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault_b", market.key().as_ref()],
        bump,
        token::mint = token_mint_b,
        token::authority = market,
    )]
    pub vault_b: Account<'info, TokenAccount>,

    #[account(mut, token::mint = token_mint_a)]
    pub user_token_a: Account<'info, TokenAccount>,

    #[account(mut, token::mint = token_mint_b)]
    pub user_token_b: Account<'info, TokenAccount>,

    pub token_mint_a: Account<'info, Mint>,
    pub token_mint_b: Account<'info, Mint>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}
