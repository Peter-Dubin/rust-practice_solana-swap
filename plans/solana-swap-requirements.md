# Solana Swap — Project Requirements

A fixed-price token swap program on Solana, built with Rust and Anchor. This document is the seed spec for implementing your own version from scratch.

---

## 1. Goal

Build an on-chain program that allows:
- An **authority** to create a market for two SPL tokens (Token A and Token B), set an exchange rate, and deposit liquidity into the market's vaults.
- Any **user** to swap Token A for Token B at the fixed exchange rate.

There is no AMM bonding curve. The price is set manually by the authority and applies to all swaps.

---

## 2. Technology Stack

| Layer | Choice |
|---|---|
| Smart contract language | Rust |
| Framework | Anchor 0.31.1 |
| SPL token integration | anchor-spl 0.31.1 |
| Local blockchain | Solana localnet (via Anchor) |
| Tests | TypeScript, Mocha 9, Chai 4, @coral-xyz/anchor ^0.31.1 |
| Package manager | yarn |

### Cargo dependencies (program)
```toml
[dependencies]
anchor-lang = { version = "0.31.1", features = ["init-space"] }
anchor-spl = "0.31.1"
```

### NPM dependencies (tests)
```json
"@coral-xyz/anchor": "^0.31.1",
"@solana/spl-token": "^0.4.13"
```

---

## 3. Program State

### 3.1 `MarketAccount`

The single on-chain state account for a trading pair.

```rust
#[account]
#[derive(InitSpace)]
pub struct MarketAccount {
    pub authority: Pubkey,    // admin who can set price and add liquidity
    pub token_mint_a: Pubkey, // SPL mint for token A
    pub token_mint_b: Pubkey, // SPL mint for token B
    pub price: u64,           // exchange rate, scaled by 10^6 (e.g. 2.5 → 2_500_000)
    pub decimals_a: u8,       // decimal precision of token A
    pub decimals_b: u8,       // decimal precision of token B
    pub bump: u8,             // PDA bump seed
}
```

**PDA derivation:**
```
seeds = [b"market", token_mint_a.key(), token_mint_b.key()]
```

### 3.2 Token Vaults

Two SPL token accounts, both owned (authority) by the `MarketAccount` PDA. They hold the liquidity users swap against.

| Account | Seeds | Authority |
|---|---|---|
| `vault_a` | `[b"vault_a", market.key()]` | market PDA |
| `vault_b` | `[b"vault_b", market.key()]` | market PDA |

Because the market PDA is the authority for both vaults, the program can sign outbound transfers from the vaults using PDA signer seeds — no private key needed.

---

## 4. Instructions

### 4.1 `initialize_market`

**Purpose:** Creates the market account and both token vaults in a single transaction.

**Parameters:**
```rust
pub fn initialize_market(
    ctx: Context<InitializeMarket>,
    price: u64,
    decimals_a: u8,
    decimals_b: u8,
    bump: u8,
) -> Result<()>
```

**Account constraints:**
- `market`: `init`, PDA with seeds `[b"market", mint_a, mint_b]`, payer = authority
- `vault_a`: `init`, token account with mint = `token_mint_a`, authority = `market`
- `vault_b`: `init`, token account with mint = `token_mint_b`, authority = `market`
- `token_mint_a`, `token_mint_b`: read-only token mints
- `authority`: signer, mutable (pays rent)
- `token_program`, `system_program`: standard programs

**Logic:**
1. Set `market.authority`, `market.token_mint_a`, `market.token_mint_b`
2. Set `market.price`, `market.decimals_a`, `market.decimals_b`, `market.bump`

---

### 4.2 `set_price`

**Purpose:** Updates the exchange rate. Only the authority may call this.

**Parameters:**
```rust
pub fn set_price(ctx: Context<SetPrice>, price: u64) -> Result<()>
```

**Account constraints:**
- `market`: mutable, PDA with seeds `[b"market", mint_a, mint_b]`
- `token_mint_a`, `token_mint_b`: read-only
- `authority`: signer

**Logic:**
1. Set `market.price = price`

> **Enhancement opportunity:** Add validation that `price > 0`, and verify `ctx.accounts.authority.key() == market.authority`.

---

### 4.3 `add_liquidity`

**Purpose:** Authority deposits tokens into the vaults to fund future swaps.

**Parameters:**
```rust
pub fn add_liquidity(ctx: Context<AddLiquidity>, amount_a: u64, amount_b: u64) -> Result<()>
```

**Account constraints:**
- `market`: mutable
- `vault_a`, `vault_b`: mutable token accounts (receive tokens)
- `authority_token_a`, `authority_token_b`: mutable token accounts (send tokens)
- `authority`: signer
- `token_program`: SPL token program

**Logic:**
1. If `amount_a > 0`: CPI transfer `amount_a` from `authority_token_a` → `vault_a`
2. If `amount_b > 0`: CPI transfer `amount_b` from `authority_token_b` → `vault_b`

> **Enhancement opportunity:** Add minimum amounts check; emit an event.

---

### 4.4 `swap`

**Purpose:** User swaps Token A for Token B at the market's fixed price.

**Parameters:**
```rust
pub fn swap(ctx: Context<Swap>, amount: u64, a_to_b: bool) -> Result<()>
```

**Account constraints:**
- `market`: mutable
- `vault_a`, `vault_b`: mutable
- `user_token_a`, `user_token_b`: mutable (user's token accounts)
- `user`: signer
- `token_program`: SPL token program

**Logic for `a_to_b = true` (A → B):**

```
const PRICE_DECIMAL_FACTOR: u64 = 1_000_000; // 10^6

// 1. Transfer `amount` of token A from user to vault_a (user signs)
// 2. Calculate output:
let numerator = amount
    .checked_mul(market.price)?
    .checked_mul(10u64.pow(market.decimals_b as u32))?;
let amount_b = numerator
    .checked_div(PRICE_DECIMAL_FACTOR)?
    .checked_div(10u64.pow(market.decimals_b as u32))?;
// 3. Transfer amount_b from vault_b to user (market PDA signs)
```

The market PDA signs the outbound transfer using:
```rust
let seeds = &[b"market", mint_a.as_ref(), mint_b.as_ref(), &[market.bump]];
let signer_seeds = &[&seeds[..]];
```

> **Enhancement opportunity:** Implement the `a_to_b = false` (B → A) direction. Formula: `amount_a = amount_b * PRICE_DECIMAL_FACTOR / price`.

---

## 5. Error Codes

Define the following custom errors:

```rust
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
```

In the reference implementation only `CalculationOverflow` is wired up. Your version should use them all appropriately.

---

## 6. Exchange Rate Formula

Price is stored as a `u64` scaled by `10^6` to represent fractional rates without floating point.

| Human rate | Stored value |
|---|---|
| 1.0× | 1_000_000 |
| 2.5× | 2_500_000 |
| 0.5× | 500_000 |

**Example:** Swap 100 Token A at price 2.5 (stored as 2_500_000), both tokens 6 decimals:

```
numerator = 100 * 2_500_000 * 10^6 = 250_000_000_000_000
÷ 10^6 (PRICE_FACTOR)  → 250_000_000
÷ 10^6 (decimals_b)    → 250
result = 250 Token B
```

---

## 7. Test Scenarios (Must Pass)

| # | Description |
|---|---|
| 1 | Authority initializes market → account created with correct price, decimals, bump, mints |
| 2 | Authority calls `set_price(2_500_000)` → `market.price` updated |
| 3 | Authority adds 1000 of each token → vault balances increase by 1000, authority balances decrease by 1000 |
| 4 | User swaps 100 Token A → user loses 100 A, gains 250 B (at 2.5× rate) |

**Test setup:**
- Two users: `initializer` (authority) and `user`
- Airdrop 200 SOL to each
- Create two mints with 6 decimals
- Create associated token accounts for each user/mint
- Mint 1,000,000 tokens of each type to each account
- Derive market PDA and vault PDAs off-chain before calling instructions

---

## 8. Optional Enhancements for Your Own Version

These are improvements over the reference you can implement to show off and discuss in your demo:

| Enhancement | Description |
|---|---|
| B → A swap | Implement the reverse swap direction |
| Authority check in `set_price` | Explicitly verify `signer == market.authority` |
| Price validation | Reject `set_price(0)` |
| Liquidity withdrawal | Let authority withdraw tokens from vaults |
| Minimum output check | User specifies `min_amount_out` to prevent bad rates |
| Fee mechanism | Take a % of input and keep in protocol vault |
| Emit events | Log swap amounts with `emit!()` |
| Close market | Drain and close accounts when market is shut down |

---

## 9. Suggested Folder Structure

```
my-solana-swap/
├── Anchor.toml
├── Cargo.toml
├── package.json
├── tsconfig.json
├── programs/
│   └── my-swap/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs
├── tests/
│   └── my-swap.ts
└── app/              ← optional Next.js frontend
    └── ...
```

---

## 10. Frontend Integration Notes (Next.js)

If you add a UI, the typical flow from the client side:

1. Connect wallet (e.g. Phantom) via `@solana/wallet-adapter-react`
2. Load `@coral-xyz/anchor` with the IDL generated by `anchor build`
3. Derive PDAs client-side using `PublicKey.findProgramAddressSync`
4. Call `program.methods.initializeMarket(...)` / `swap(...)` etc.
5. Display vault balances and market price by fetching `program.account.marketAccount.fetch(marketPda)`

Key packages: `@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `@solana/wallet-adapter-react`, `@solana/wallet-adapter-wallets`
