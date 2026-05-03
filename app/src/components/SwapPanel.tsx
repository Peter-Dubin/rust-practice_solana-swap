"use client";

import { useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { BN, getProgram, SCALE, PRICE_DECIMAL_FACTOR, MarketData } from "@/lib/program";

type TxLogEntry = { msg: string; sig?: string; ok: boolean };

interface SwapPanelProps {
  userKp: Keypair;
  mintA: PublicKey;
  mintB: PublicKey;
  marketPda: PublicKey;
  vaultA: PublicKey;
  vaultB: PublicKey;
  marketData: MarketData;
  userAtaA: PublicKey;
  userAtaB: PublicKey;
  setTxPending: (b: boolean) => void;
  addLog: (entry: TxLogEntry) => void;
  refreshState: () => Promise<void>;
}

export default function SwapPanel({
  userKp, mintA, mintB, marketPda, vaultA, vaultB,
  marketData, userAtaA, userAtaB,
  setTxPending, addLog, refreshState,
}: SwapPanelProps) {
  const [aToB, setAToB] = useState(true);
  const [amount, setAmount] = useState("100");
  const [loading, setLoading] = useState(false);

  const price = marketData.price.toNumber();
  const amountNum = parseFloat(amount) || 0;
  const preview = aToB
    ? (amountNum * price) / PRICE_DECIMAL_FACTOR
    : price > 0 ? (amountNum * PRICE_DECIMAL_FACTOR) / price : 0;

  async function handleSwap() {
    setLoading(true);
    setTxPending(true);
    try {
      const program = getProgram(userKp);
      const amountRaw = new BN(Math.round(amountNum * SCALE));
      const sig = await program.methods
        .swap(amountRaw, aToB)
        .accounts({
          userTokenA: userAtaA,
          userTokenB: userAtaB,
          tokenMintA: mintA,
          tokenMintB: mintB,
        })
        .signers([userKp])
        .rpc();
      const inToken = aToB ? "TKA" : "TKB";
      const outToken = aToB ? "TKB" : "TKA";
      addLog({ msg: `Swapped ${amount} ${inToken} → ${preview.toFixed(2)} ${outToken}`, sig, ok: true });
      await refreshState();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog({ msg: `Swap failed: ${msg}`, ok: false });
    } finally {
      setLoading(false);
      setTxPending(false);
    }
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
      <h2 className="text-zinc-300 font-semibold text-sm uppercase tracking-wider">Swap</h2>
      <div className="space-y-3">
        <label className="block">
          <span className="text-zinc-400 text-sm">Direction</span>
          <select
            value={aToB ? "atob" : "btoa"}
            onChange={(e) => setAToB(e.target.value === "atob")}
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="atob">Token A → Token B</option>
            <option value="btoa">Token B → Token A</option>
          </select>
        </label>
        <label className="block">
          <span className="text-zinc-400 text-sm">Amount ({aToB ? "TKA" : "TKB"})</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-500"
          />
        </label>
        <div className="bg-zinc-800 rounded-lg px-3 py-2 text-sm">
          <span className="text-zinc-500">You receive: </span>
          <span className="text-emerald-400 font-semibold">{preview.toFixed(2)} {aToB ? "TKB" : "TKA"}</span>
        </div>
        <button
          onClick={handleSwap}
          disabled={loading || amountNum <= 0}
          className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg py-2 text-sm font-medium transition-colors"
        >
          {loading ? "Swapping..." : "Swap"}
        </button>
      </div>
    </div>
  );
}
