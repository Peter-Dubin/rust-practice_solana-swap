"use client";

interface RoleBarProps {
  role: "admin" | "user";
  setRole: (r: "admin" | "user") => void;
  activeKey: string;
  activeSol: number;
}

export default function RoleBar({ role, setRole, activeKey, activeSol }: RoleBarProps) {
  const truncated = activeKey ? `${activeKey.slice(0, 4)}...${activeKey.slice(-4)}` : "—";

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-3 flex items-center justify-between">
      <div>
        <span className="text-emerald-400 font-semibold text-lg">Solana Swap</span>
        <span className="ml-4 text-zinc-400 text-sm font-mono">{truncated}</span>
        <span className="ml-3 text-zinc-500 text-sm">SOL: {activeSol.toFixed(2)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-zinc-400 text-sm">Active:</span>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "user")}
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
        >
          <option value="admin">Admin</option>
          <option value="user">User</option>
        </select>
      </div>
    </div>
  );
}
