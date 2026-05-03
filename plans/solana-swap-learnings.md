# Solana Swap — Learning Guide

> A lesson to help you truly understand what this program does, why it works the way it does, and how to explain it confidently on camera.

---

## 1. The Big Picture — What Problem Are We Solving?

Imagine you want to trade euros for dollars, but you don't want to go to a bank. You want the exchange to happen automatically, transparently, and without trusting any single person. That's the core promise of on-chain token swaps.

In the real world, protocols like Uniswap or Jupiter do this with sophisticated math (AMMs — Automated Market Makers). But before we get to that complexity, this project teaches you the fundamental building blocks: **a market with two token vaults, a price set by an admin, and a swap instruction that moves tokens between users and vaults.**

This is a "fixed-price swap market." Think of it as a currency exchange booth at the airport: you walk up, hand over your tokens, and get the advertised rate — no negotiation, no slippage. Simple, explicit, and perfect for learning.

**Why on Solana?**
- Solana transactions are fast (~400ms) and cheap (fractions of a cent)
- SPL tokens are Solana's token standard — every token in the ecosystem follows it
- Anchor makes writing safe Solana programs dramatically easier with declarative account validation

---

## 2. PDAs — The Key Primitive You Must Understand

PDA stands for **Program Derived Address**. This is the most important concept in the entire project. Once you get this, everything else clicks.

### The Problem PDAs Solve

In Solana, to sign a transaction you normally need a private key. But programs (smart contracts) don't have private keys. So how can a program ever send tokens out of an account it "owns"?

**PDAs are addresses that no private key can control — only the program itself can authorize them.**

They are derived deterministically from:
- The program's ID
- A set of "seeds" (arbitrary bytes)
- A "bump" (a small integer that ensures the address falls off the ed25519 curve, making it a non-keypair address)

### How It Works in This Project

```
market_pda = findProgramAddress(["market", mint_a, mint_b], program_id)
vault_a_pda = findProgramAddress(["vault_a", market_pda], program_id)
vault_b_pda = findProgramAddress(["vault_b", market_pda], program_id)
```

The `MarketAccount` is stored at `market_pda`. The two token vaults live at `vault_a_pda` and `vault_b_pda`, and their SPL token authority is `market_pda`.

This means:
- Only the program can sign transfers out of the vaults
- The addresses are deterministic — anyone can recalculate them given the same seeds
- There is no admin key that could be stolen to drain the vaults

**Analogy:** Think of `vault_a` as a bank safe deposit box. The box has a lock (the `market_pda` authority). Only the bank manager (the program) has the master key — but the master key is derived from the box number itself. You can't steal it; it's mathematical.

### Signing as a PDA in Code

When the program needs to sign a transfer out of a vault (during a swap), it passes the seeds back to the runtime:

```rust
let seeds = &[b"market", mint_a.as_ref(), mint_b.as_ref(), &[market.bump]];
let signer_seeds = &[&seeds[..]];
// Now CPI calls can be signed by the market PDA
```

This is called "signing with PDA seeds." The runtime re-derives the address from the seeds and verifies it matches. No private key involved.

---

## 3. The Vault Pattern — Holding Tokens On-Chain

Solana programs can't hold tokens directly in their accounts (unlike EVM). Instead, they use **SPL token accounts** — specialized accounts that store a balance of a specific token mint, plus an "authority" that controls them.

In this project:
- `vault_a` is an SPL token account for Token A, with authority = `market_pda`
- `vault_b` is an SPL token account for Token B, with authority = `market_pda`

The market authority (the admin) funds these vaults with `add_liquidity`. When a user swaps, they send tokens into a vault and receive tokens from the other vault.

```
add_liquidity:
  authority_wallet → [vault_a] (Token A)
  authority_wallet → [vault_b] (Token B)

swap (A → B):
  user_wallet → [vault_a] (sends Token A)
  [vault_b] → user_wallet (receives Token B)
```

The vaults are the program's "inventory." Without liquidity in the vaults, swaps fail — the program tries to transfer from an empty vault and the SPL token program rejects it.

---

## 4. Fixed-Price vs AMM — Know What This Is (and Isn't)

This project uses a **fixed-price model**. The exchange rate is a number stored in `market.price`, set by the authority, and applied uniformly to every swap. No bonding curve, no slippage.

**Real-world counterpart:** A company that sets USDC→SOL at exactly $150 per SOL, takes orders all day at that price, and adjusts manually when needed.

**What an AMM does differently:**
- Price is derived from the ratio of tokens in two pools: `price = reserve_b / reserve_a`
- Every swap shifts the ratio, so the price changes after each trade
- No admin needed to set price — the market self-prices

The fixed-price model is simpler and perfect for learning because:
- You understand the exchange rate formula without calculus
- You see clearly how CPI transfers work in both directions
- You can extend it toward an AMM in your own version

---

## 5. The Exchange Rate Formula — Step by Step

Prices on Solana programs are always integers (no floats). We represent fractional rates by scaling by `10^6`.

**Rule:** `price = human_rate × 1_000_000`

| Rate | Stored as |
|---|---|
| 1× (1:1) | 1_000_000 |
| 2.5× | 2_500_000 |
| 0.4× | 400_000 |

**Now let's trace through a real swap:**

> User swaps **100 Token A**, rate is **2.5** (stored as 2_500_000), both tokens have **6 decimal places**.

```
Step 1: numerator = 100 × 2_500_000 = 250_000_000
Step 2: numerator × 10^decimals_b = 250_000_000 × 10^6 = 250_000_000_000_000
Step 3: ÷ PRICE_FACTOR (10^6) = 250_000_000
Step 4: ÷ 10^decimals_b (10^6) = 250

Result: user receives 250 Token B ✓
```

Wait — why multiply by `10^decimals_b` and then divide by it? At first glance it cancels out. But the reason this structure exists is to correctly handle tokens with **different decimal places**. If Token A has 6 decimals and Token B has 9, the formula naturally scales the output to the right units. In this reference project, both tokens have 6 decimals so they cancel, but the formula is correct in the general case.

**The key insight:** All token amounts on-chain are stored as raw integers. 100 Token A with 6 decimals is stored as `100_000_000` (1 followed by six zeros) internally. When you call the swap with `amount = 100`, you're passing `100` raw units which equals `0.0001` tokens — make sure in your tests you multiply by `10^decimals`.

---

## 6. The Authority Pattern — Admin Control and Security

The `MarketAccount` stores an `authority: Pubkey` field. This is the address of the wallet that:
- Can call `set_price` to update the exchange rate
- Can call `add_liquidity` to deposit tokens into the vaults

This is a common Solana pattern called the "authority pattern." It's essentially role-based access control baked into on-chain state.

```rust
// Typical authority check (the reference left this out of set_price — fix it in your version!)
if ctx.accounts.authority.key() != ctx.accounts.market.authority {
    return Err(SwapError::Unauthorized.into());
}
```

The `add_liquidity` instruction correctly requires the signer to be the authority. The `set_price` instruction in the reference relies on Anchor's account matching rather than an explicit check — in your version, make it explicit.

**Why does this matter?** If `set_price` has no authority check, *anyone* could change the exchange rate to something absurd and drain the vaults via a manipulated swap. Security-critical functions should always explicitly verify `signer == stored_authority`.

---

## 7. CPI — How Anchor Talks to the SPL Token Program

CPI stands for **Cross-Program Invocation**. It's how your program calls other programs — specifically the SPL Token program for transfers.

In Anchor, a token transfer CPI looks like this:

```rust
// User sending Token A to vault (user signs)
let cpi_accounts = Transfer {
    from: ctx.accounts.user_token_a.to_account_info(),
    to: ctx.accounts.vault_a.to_account_info(),
    authority: ctx.accounts.user.to_account_info(),
};
let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
token::transfer(cpi_ctx, amount)?;

// Market PDA sending Token B to user (PDA signs)
let seeds = &[b"market", mint_a.as_ref(), mint_b.as_ref(), &[market.bump]];
let signer_seeds = &[&seeds[..]];
let cpi_ctx_signed = CpiContext::new_with_signer(
    ctx.accounts.token_program.to_account_info(),
    cpi_accounts_b,
    signer_seeds,
);
token::transfer(cpi_ctx_signed, amount_b)?;
```

Notice the difference:
- `CpiContext::new(...)` — the signer is a wallet (user), signing was done in the outer transaction
- `CpiContext::new_with_signer(...)` — the signer is a PDA, the program provides the seeds to prove ownership

This two-sided transfer in a single instruction is the heart of a swap. Atomicity is guaranteed: if either transfer fails, the whole transaction reverts.

---

## 8. What the Reference Left Incomplete

The reference implementation is intentionally incomplete — it's a teaching scaffold. Here's what's missing and what you can add in your version:

### B → A Swap (TODO in the code)
The `swap` instruction accepts `a_to_b: bool` but only handles `true`. The reverse direction would:
1. Take Token B from user → vault_b
2. Calculate: `amount_a = amount_b × PRICE_FACTOR / price`
3. Send Token A from vault_a → user

### Explicit Authority Checks
`set_price` doesn't verify the signer is the market authority. Add: `require!(ctx.accounts.authority.key() == market.authority, SwapError::Unauthorized)`.

### Price Validation
`set_price` accepts `0` without error. Add: `require!(price > 0, SwapError::PriceNotSet)`.

### Liquidity Withdrawal
There's no way to get tokens out of the vaults. An admin `withdraw_liquidity` instruction would be useful.

### Zero Amount Protection
Swapping `0` tokens wastes gas. Add: `require!(amount > 0, SwapError::ZeroAmount)`.

### No Fee Mechanism
Every swap is 100% efficient for the user. Real markets take a fee (e.g. 0.3%). You could add a basis-point fee that stays in the vault.

---

## 9. Your Own Version Checklist

Use this when you're building your version in the new folder:

**Must Have (matches reference):**
- [ ] `MarketAccount` PDA with authority, mints, price, decimals, bump
- [ ] `vault_a` and `vault_b` as PDA-owned SPL token accounts
- [ ] `initialize_market` — creates market + vaults in one tx
- [ ] `set_price` — authority updates rate
- [ ] `add_liquidity` — authority funds vaults via CPI
- [ ] `swap(amount, a_to_b=true)` — user swaps A → B using fixed price
- [ ] TypeScript tests covering all 4 happy paths

**Should Have (improvements over reference):**
- [ ] Explicit authority check in `set_price`
- [ ] `require!(price > 0)` in `set_price`
- [ ] `require!(amount > 0)` in `swap`
- [ ] Implement B → A swap direction
- [ ] Use all defined error codes

**Nice to Have (stand out in the demo):**
- [ ] `withdraw_liquidity` instruction
- [ ] Minimum output amount parameter in `swap`
- [ ] `emit!()` events on swap
- [ ] Next.js frontend with wallet connect

---

## 10. What to Say in Your Demo Video

Here's a mental script for key moments:

**On the architecture:**
> "The core design is a market account as a PDA that acts as the authority for two token vaults. This means the program itself controls the vaults — no private key can drain them, which is what makes it trustless."

**On the swap:**
> "When a user swaps, two CPI calls happen atomically in one transaction. The user signs the inbound transfer, and the program signs the outbound transfer using its PDA seeds. If anything fails, the whole thing reverts — you can't lose tokens to a partial swap."

**On the price formula:**
> "We store prices as integers scaled by 10^6 to avoid floating point. So a rate of 2.5 is stored as 2,500,000. This is a standard pattern on Solana because the runtime only works with integers."

**On what you improved:**
> "The reference had a few gaps — the B-to-A direction wasn't implemented, and set_price had no authority validation. I fixed both. I also added a minimum output parameter to protect users from bad rates."

**On the frontend:**
> "The UI connects to a local validator, derives the same PDAs client-side using findProgramAddressSync, and calls the program methods through Anchor's TypeScript SDK. It reads vault balances in real time so you can see the liquidity move as you swap."

---

You're ready. Go build it.
