"use client";

import { useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN, getProgram, SCALE, PRICE_DECIMAL_FACTOR, MarketData } from "@/lib/program";

type TxLogEntry = { msg: string; sig?: string; ok: boolean };

interface AdminPanelProps {
  adminKp: Keypair;
  mintA: PublicKey;
  mintB: PublicKey;
  marketPda: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  marketBump: number;
  marketData: MarketData | null;
  adminAtaA: PublicKey;
  adminAtaB: PublicKey;
  setTxPending: (b: boolean) => void;
  addLog: (entry: TxLogEntry) => void;
  refreshState: () => Promise<void>;
}

type Tab = "init" | "price" | "liquidity";

export default function AdminPanel({
  adminKp, mintA, mintB, marketPda, vaultA, vaultB, marketBump,
  marketData, adminAtaA, adminAtaB,
  setTxPending, addLog, refreshState,
}: AdminPanelProps) {
  const [tab, setTab] = useState<Tab>("init");
  const [initPrice, setInitPrice] = useState("2.5");
  const [newPrice, setNewPrice] = useState("3.0");
  const [liqA, setLiqA] = useState("1000");
  const [liqB, setLiqB] = useState("1000");
  const [loading, setLoading] = useState(false);

  async function run(fn: () => Promise<void>) {
    setLoading(true);
    setTxPending(true);
    try {
      await fn();
    } finally {
      setLoading(false);
      setTxPending(false);
    }
  }

  async function handleInit() {
    await run(async () => {
      const program = getProgram(adminKp);
      const price = new BN(Math.round(parseFloat(initPrice) * PRICE_DECIMAL_FACTOR));
      const sig = await program.methods
        .initializeMarket(price, 6, 6, marketBump)
        .accounts({
          tokenMintA: mintA,
          tokenMintB: mintB,
          authority: adminKp.publicKey,
        })
        .signers([adminKp])
        .rpc();
      addLog({ msg: `Market initialized at ${initPrice}×`, sig, ok: true });
      await refreshState();
    }).catch((err) => addLog({ msg: `Init failed: ${err.message}`, ok: false }));
  }

  async function handleSetPrice() {
    await run(async () => {
      const program = getProgram(adminKp);
      const price = new BN(Math.round(parseFloat(newPrice) * PRICE_DECIMAL_FACTOR));
      const sig = await program.methods
        .setPrice(price)
        .accounts({
          tokenMintA: mintA,
          tokenMintB: mintB,
          authority: adminKp.publicKey,
        })
        .signers([adminKp])
        .rpc();
      addLog({ msg: `Price set to ${newPrice}×`, sig, ok: true });
      await refreshState();
    }).catch((err) => addLog({ msg: `Set price failed: ${err.message}`, ok: false }));
  }

  async function handleAddLiquidity() {
    await run(async () => {
      const program = getProgram(adminKp);
      const amountA = new BN(Math.round(parseFloat(liqA) * SCALE));
      const amountB = new BN(Math.round(parseFloat(liqB) * SCALE));
      const sig = await program.methods
        .addLiquidity(amountA, amountB)
        .accounts({
          authorityTokenA: adminAtaA,
          authorityTokenB: adminAtaB,
          tokenMintA: mintA,
          tokenMintB: mintB,
        })
        .signers([adminKp])
        .rpc();
      addLog({ msg: `Added ${liqA} TKA + ${liqB} TKB liquidity`, sig, ok: true });
      await refreshState();
    }).catch((err) => addLog({ msg: `Add liquidity failed: ${err.message}`, ok: false }));
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "init", label: "Initialize" },
    { id: "price", label: "Set Price" },
    { id: "liquidity", label: "Add Liquidity" },
  ];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <h2 className="text-zinc-300 font-semibold text-sm uppercase tracking-wider">Admin Panel</h2>
      <div className="flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              tab === t.id
                ? "bg-emerald-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "init" && (
        <div className="space-y-3">
          <label className="block">
            <span className="text-zinc-400 text-sm">Initial Price</span>
            <input
              type="number"
              step="0.1"
              value={initPrice}
              onChange={(e) => setInitPrice(e.target.value)}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
          <button
            onClick={handleInit}
            disabled={loading || marketData !== null}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {marketData !== null ? "Already Initialized" : loading ? "Initializing..." : "Initialize Market"}
          </button>
        </div>
      )}

      {tab === "price" && (
        <div className="space-y-3">
          <label className="block">
            <span className="text-zinc-400 text-sm">New Price</span>
            <input
              type="number"
              step="0.1"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
          <button
            onClick={handleSetPrice}
            disabled={loading || marketData === null}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {loading ? "Setting..." : "Set Price"}
          </button>
        </div>
      )}

      {tab === "liquidity" && (
        <div className="space-y-3">
          <label className="block">
            <span className="text-zinc-400 text-sm">Amount TKA</span>
            <input
              type="number"
              value={liqA}
              onChange={(e) => setLiqA(e.target.value)}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-zinc-400 text-sm">Amount TKB</span>
            <input
              type="number"
              value={liqB}
              onChange={(e) => setLiqB(e.target.value)}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
          <button
            onClick={handleAddLiquidity}
            disabled={loading || marketData === null}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {loading ? "Adding..." : "Add Liquidity"}
          </button>
        </div>
      )}
    </div>
  );
}
