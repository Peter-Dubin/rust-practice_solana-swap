"use client";

import { MarketData, PRICE_DECIMAL_FACTOR } from "@/lib/program";

interface MarketStateProps {
  marketData: MarketData | null;
  vaultABal: number;
  vaultBBal: number;
  walletBalA: number;
  walletBalB: number;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4 flex-1">
      <p className="text-zinc-500 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className="text-emerald-400 text-2xl font-bold">{value}</p>
      {sub && <p className="text-zinc-600 text-xs mt-0.5">{sub}</p>}
    </div>
  );
}

export default function MarketState({ marketData, vaultABal, vaultBBal, walletBalA, walletBalB }: MarketStateProps) {
  const dim = marketData === null;
  const priceRaw = marketData ? marketData.price.toNumber() : 0;
  const priceDisplay = dim ? "—" : `${(priceRaw / PRICE_DECIMAL_FACTOR).toFixed(4)}×`;
  const priceSub = dim ? undefined : `(${priceRaw.toLocaleString()})`;

  return (
    <div className={`space-y-3 ${dim ? "opacity-40" : ""}`}>
      <div className="flex gap-3">
        <StatCard label="Rate" value={priceDisplay} sub={priceSub} />
        <StatCard label="Vault A" value={dim ? "—" : `${vaultABal.toLocaleString()} TKA`} />
        <StatCard label="Vault B" value={dim ? "—" : `${vaultBBal.toLocaleString()} TKB`} />
      </div>
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-3 flex gap-8">
        <div>
          <span className="text-zinc-500 text-xs uppercase tracking-wider">My TKA</span>
          <span className="ml-3 text-emerald-400 font-semibold">{walletBalA.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-zinc-500 text-xs uppercase tracking-wider">My TKB</span>
          <span className="ml-3 text-emerald-400 font-semibold">{walletBalB.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
