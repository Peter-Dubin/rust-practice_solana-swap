# Plan: Minimal Next.js UI for Solana Swap Demo

## Context
The Solana Swap program is complete and all 4 tests pass. The goal is to add a minimal but modern Next.js frontend inside the existing `app/` directory so the demo can be recorded visually — showing market initialization, liquidity, and swapping — using two hardcoded demo keypairs (Admin + User) with a role-switcher dropdown instead of Phantom wallet.

---

## File Structure

```
app/                          ← already exists (empty, from anchor init)
├── package.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx           ← all state, bootstrap logic, orchestration
    │   └── globals.css
    ├── lib/
    │   └── program.ts         ← Anchor connection helpers, PDA derivation
    └── components/
        ├── RoleBar.tsx        ← role switcher + wallet address + SOL balance
        ├── MarketState.tsx    ← price card + vault A/B balance cards
        ├── AdminPanel.tsx     ← Initialize / Set Price / Add Liquidity forms
        └── SwapPanel.tsx      ← Swap A→B and B→A with amount input + preview
```

**Critical files from the Anchor project used by the UI:**
- `target/idl/solana_swap.json` — imported directly by the app
- `target/types/solana_swap.ts` — provides TypeScript types
- Program ID: `8gU4na42yZ8Po89WkbW6krWww8CDnoJKLHvcuSPimgjW`

---

## Dependencies (`app/package.json`)

```json
{
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18",
    "react-dom": "^18",
    "@coral-xyz/anchor": "^0.31.1",
    "@solana/spl-token": "^0.4.13",
    "@solana/web3.js": "^1.95.5"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "tailwindcss": "^3.4",
    "postcss": "^8",
    "autoprefixer": "^10"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  }
}
```

---

## `lib/program.ts` — Anchor Helpers

Exports:
- `PROGRAM_ID` constant
- `RPC_ENDPOINT = "http://localhost:8899"`
- `DECIMALS = 6`, `SCALE = 1_000_000`, `PRICE_DECIMAL_FACTOR = 1_000_000`
- `getProgram(keypair)` — returns `anchor.Program<SolanaSwap>` with a `NodeWallet` wrapping the given keypair
- `deriveMarketPda(mintA, mintB, programId)` → `[PublicKey, number]`
- `deriveVaultPda(seed, marketPda, programId)` → `PublicKey`

---

## `app/page.tsx` — Main Page (all state lives here)

### State
```typescript
role: 'admin' | 'user'           // active role (switcher)
appState: 'bootstrapping' | 'ready' | 'txPending'
adminKp: Keypair | null
userKp: Keypair | null
mintA: PublicKey | null
mintB: PublicKey | null
marketPda: PublicKey | null
vaultA: PublicKey | null
vaultB: PublicKey | null
marketData: MarketAccount | null  // null = not initialized yet
vaultABal: number                // token units (divided by SCALE)
vaultBBal: number
adminBalA: number
adminBalB: number
userBalA: number
userBalB: number
txLog: { msg: string; sig?: string; ok: boolean }[]
```

### Bootstrap (runs on mount via `useEffect`)

```
1. Load or generate adminKp + userKp (persist to localStorage as base58 secret keys)
2. Create Connection to localhost:8899
3. Airdrop 2 SOL to admin if balance < 0.5 SOL
4. Airdrop 2 SOL to user if balance < 0.5 SOL
5. Load or create mintA (persist mint address to localStorage)
6. Load or create mintB (persist mint address to localStorage)
7. Load or create ATA: admin/mintA, admin/mintB, user/mintA, user/mintB
   (use getOrCreateAssociatedTokenAccount from @solana/spl-token)
8. Mint 1,000,000 of each token to admin and user (if balance < 100,000)
9. Derive marketPda, vaultA, vaultB
10. Try to fetch marketAccount → set marketData (null if not yet initialized)
11. Fetch all balances → set vaultABal, vaultBBal, adminBalA/B, userBalA/B
12. Set appState = 'ready'
```

localStorage keys: `swap_admin_sk`, `swap_user_sk`, `swap_mint_a`, `swap_mint_b`

On each page load: check localStorage. If all 4 keys exist AND mints are still valid on-chain (try `getMint`), reuse them. Otherwise, generate fresh ones and clear localStorage.

### Refresh helper: `refreshState()`
Called after every transaction — refetches market account + all 6 token balances.

---

## `components/RoleBar.tsx`

```
┌──────────────────────────────────────────────────────────┐
│  🔄 Solana Swap                      Active: [Admin ▼]   │
│  8xHk...3mPq  •  SOL: 198.4                              │
└──────────────────────────────────────────────────────────┘
```

- Dropdown: `Admin` / `User` — calls `setRole` in parent
- Shows truncated public key of active wallet
- Shows SOL balance of active wallet

---

## `components/MarketState.tsx`

Three stat cards, always visible:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Rate        │  │  Vault A     │  │  Vault B     │
│  2.5×        │  │  1,000 TKA   │  │  1,000 TKB   │
│  (2,500,000) │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

Below that, a "My Wallet" row showing the active wallet's Token A and Token B balances.

- Gray/dimmed if `marketData === null` (not yet initialized)
- All values auto-update after each transaction via `refreshState()`

---

## `components/AdminPanel.tsx`

Only shown when `role === 'admin'`. Three collapsible/tab sections:

### 1. Initialize Market
- Input: Initial Price (default: `2.5`, UI converts to `price * 1_000_000`)
- Button: "Initialize Market" (disabled if `marketData !== null`)
- Calls `program.methods.initializeMarket(price, 6, 6, bump).accounts({...}).signers([adminKp]).rpc()`

### 2. Set Price
- Input: New price (decimal, e.g. `3.0`)
- Button: "Set Price"
- Calls `program.methods.setPrice(new BN(price * 1_000_000)).accounts({...}).signers([adminKp]).rpc()`

### 3. Add Liquidity
- Input A amount + Input B amount
- Button: "Add Liquidity"
- Calls `program.methods.addLiquidity(amountA_raw, amountB_raw).accounts({...}).signers([adminKp]).rpc()`

---

## `components/SwapPanel.tsx`

Only shown when `role === 'user'`. Simple swap form:

```
┌────────────────────────────────────────┐
│  Direction: [A → B ▼]                  │
│  Amount:    [_______] TKA              │
│  You receive: ~250.00 TKB   (preview)  │
│  [     Swap     ]                      │
└────────────────────────────────────────┘
```

- Direction dropdown: `Token A → Token B` / `Token B → Token A`
- Amount input: numeric
- Preview line: calculated client-side using the same formula as the program
  - A→B: `amount * price / 1_000_000`
  - B→A: `amount * 1_000_000 / price`
- Button calls `program.methods.swap(amount_raw, aToB).accounts({...}).signers([userKp]).rpc()`

---

## Transaction Log

A small scrollable log at the bottom of the page showing recent transactions:
```
✓ Market initialized  [abc...123]
✓ Added 1000 TKA + 1000 TKB liquidity  [def...456]
✓ Swapped 100 TKA → 250 TKB  [ghi...789]
```
Green checkmark for success, red X for errors. Shows last 5 entries.

---

## `next.config.mjs` — Required for Anchor/Solana compatibility

```js
const nextConfig = {
  webpack: (config) => {
    config.resolve.fallback = {
      fs: false, path: false, crypto: false,
      stream: false, os: false,
    };
    return config;
  },
};
export default nextConfig;
```

This is required because `@coral-xyz/anchor` and `@solana/web3.js` import Node.js builtins that don't exist in the browser.

---

## Visual Design

- **Background**: `bg-zinc-950`
- **Cards**: `bg-zinc-900 border border-zinc-800 rounded-xl`
- **Accent**: `text-emerald-400` for values, `bg-emerald-500` for primary buttons
- **Error**: `text-red-400`
- **Font**: System sans-serif via Tailwind defaults
- **Layout**: Max-width centered, single column on narrow, two-column on wide

---

## How to Run for the Demo

```bash
# Terminal 1 — start localnet with program deployed (keeps running)
anchor localnet

# Terminal 2 — start the UI
cd app && npm run dev
# → open http://localhost:3000
```

On first load: bootstrap runs automatically (~3s), then the UI is ready.
Demo flow: Initialize Market → Add Liquidity → Switch to User → Swap A→B → Swap B→A → Switch to Admin → Set Price.

---

## Verification

1. `anchor localnet` starts without errors
2. `cd app && npm run dev` starts without errors
3. Page loads and shows "Setting up demo..." then transitions to ready state
4. Admin panel: Initialize Market → market state cards populate
5. Admin panel: Add Liquidity → vault balances increase
6. Switch to User → Swap A→B → user loses TKA, gains TKB at correct 2.5× ratio
7. Swap B→A → reverse direction works
8. Switch to Admin → Set Price → rate card updates
9. Transaction log shows all 5+ entries correctly
10. All balances refresh automatically after each transaction
