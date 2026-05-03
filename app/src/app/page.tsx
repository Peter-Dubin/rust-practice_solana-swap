"use client";

import { useEffect, useRef, useState } from "react";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getMint,
  mintTo,
} from "@solana/spl-token";
import {
  RPC_ENDPOINT,
  DECIMALS,
  SCALE,
  getProgram,
  deriveMarketPda,
  deriveVaultPda,
  MarketData,
} from "@/lib/program";
import RoleBar from "@/components/RoleBar";
import MarketState from "@/components/MarketState";
import AdminPanel from "@/components/AdminPanel";
import SwapPanel from "@/components/SwapPanel";

type AppState = "bootstrapping" | "ready" | "txPending";
type TxLogEntry = { msg: string; sig?: string; ok: boolean };

export default function Home() {
  const [role, setRole] = useState<"admin" | "user">("admin");
  const [appState, setAppState] = useState<AppState>("bootstrapping");
  const [bootstrapStatus, setBootstrapStatus] = useState("Setting up demo...");
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [vaultABal, setVaultABal] = useState(0);
  const [vaultBBal, setVaultBBal] = useState(0);
  const [adminBalA, setAdminBalA] = useState(0);
  const [adminBalB, setAdminBalB] = useState(0);
  const [userBalA, setUserBalA] = useState(0);
  const [userBalB, setUserBalB] = useState(0);
  const [adminSol, setAdminSol] = useState(0);
  const [userSol, setUserSol] = useState(0);
  const [txLog, setTxLog] = useState<TxLogEntry[]>([]);

  // Stable refs — set once during bootstrap
  const connRef = useRef<Connection | null>(null);
  const adminKpRef = useRef<Keypair | null>(null);
  const userKpRef = useRef<Keypair | null>(null);
  const mintARef = useRef<PublicKey | null>(null);
  const mintBRef = useRef<PublicKey | null>(null);
  const marketPdaRef = useRef<PublicKey | null>(null);
  const vaultARef = useRef<PublicKey | null>(null);
  const vaultBRef = useRef<PublicKey | null>(null);
  const marketBumpRef = useRef<number>(0);
  const adminAtaARef = useRef<PublicKey | null>(null);
  const adminAtaBRef = useRef<PublicKey | null>(null);
  const userAtaARef = useRef<PublicKey | null>(null);
  const userAtaBRef = useRef<PublicKey | null>(null);

  async function refreshState() {
    const conn = connRef.current!;
    const adminKp = adminKpRef.current!;
    const userKp = userKpRef.current!;
    const mintA = mintARef.current!;
    const mintB = mintBRef.current!;
    const marketPda = marketPdaRef.current!;
    const vaultA = vaultARef.current!;
    const vaultB = vaultBRef.current!;
    const adminAtaA = adminAtaARef.current!;
    const adminAtaB = adminAtaBRef.current!;
    const userAtaA = userAtaARef.current!;
    const userAtaB = userAtaBRef.current!;

    void mintA; void mintB; // refs available for future use

    const program = getProgram(adminKp);

    try {
      const md = await program.account.marketAccount.fetch(marketPda);
      setMarketData(md as unknown as MarketData);
    } catch {
      setMarketData(null);
    }

    const fetchTok = async (ata: PublicKey) => {
      try {
        const info = await conn.getTokenAccountBalance(ata);
        return Number(info.value.amount) / SCALE;
      } catch {
        return 0;
      }
    };

    const [vaInfo, vbInfo, aa, ab, ua, ub, aSOL, uSOL] = await Promise.all([
      conn.getTokenAccountBalance(vaultA).catch(() => null),
      conn.getTokenAccountBalance(vaultB).catch(() => null),
      fetchTok(adminAtaA),
      fetchTok(adminAtaB),
      fetchTok(userAtaA),
      fetchTok(userAtaB),
      conn.getBalance(adminKp.publicKey),
      conn.getBalance(userKp.publicKey),
    ]);

    if (vaInfo) setVaultABal(Number(vaInfo.value.amount) / SCALE);
    if (vbInfo) setVaultBBal(Number(vbInfo.value.amount) / SCALE);
    setAdminBalA(aa);
    setAdminBalB(ab);
    setUserBalA(ua);
    setUserBalB(ub);
    setAdminSol(aSOL / LAMPORTS_PER_SOL);
    setUserSol(uSOL / LAMPORTS_PER_SOL);
  }

  function addLog(entry: TxLogEntry) {
    setTxLog((prev) => [entry, ...prev].slice(0, 5));
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        // 1. Load or generate keypairs
        setBootstrapStatus("Loading keypairs...");
        const adminSkStored = localStorage.getItem("swap_admin_sk");
        const userSkStored = localStorage.getItem("swap_user_sk");

        let adminKp: Keypair;
        let userKp: Keypair;

        if (adminSkStored && userSkStored) {
          adminKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(adminSkStored)));
          userKp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(userSkStored)));
        } else {
          adminKp = Keypair.generate();
          userKp = Keypair.generate();
          localStorage.setItem("swap_admin_sk", JSON.stringify(Array.from(adminKp.secretKey)));
          localStorage.setItem("swap_user_sk", JSON.stringify(Array.from(userKp.secretKey)));
        }

        adminKpRef.current = adminKp;
        userKpRef.current = userKp;

        // 2. Connection
        const connection = new Connection(RPC_ENDPOINT, "confirmed");
        connRef.current = connection;

        // 3. Airdrop if needed
        setBootstrapStatus("Funding wallets...");
        const [adminBal, userBal] = await Promise.all([
          connection.getBalance(adminKp.publicKey),
          connection.getBalance(userKp.publicKey),
        ]);

        if (adminBal < 0.5 * LAMPORTS_PER_SOL) {
          const sig = await connection.requestAirdrop(adminKp.publicKey, 2 * LAMPORTS_PER_SOL);
          await connection.confirmTransaction(sig, "confirmed");
        }
        if (userBal < 0.5 * LAMPORTS_PER_SOL) {
          const sig = await connection.requestAirdrop(userKp.publicKey, 2 * LAMPORTS_PER_SOL);
          await connection.confirmTransaction(sig, "confirmed");
        }

        // 4. Load or create mints
        setBootstrapStatus("Setting up token mints...");
        const mintAStored = localStorage.getItem("swap_mint_a");
        const mintBStored = localStorage.getItem("swap_mint_b");
        let mintA!: PublicKey;
        let mintB!: PublicKey;
        let mintsValid = false;

        if (mintAStored && mintBStored) {
          try {
            const mintAPk = new PublicKey(mintAStored);
            const mintBPk = new PublicKey(mintBStored);
            await Promise.all([getMint(connection, mintAPk), getMint(connection, mintBPk)]);
            mintA = mintAPk;
            mintB = mintBPk;
            mintsValid = true;
          } catch {
            localStorage.removeItem("swap_mint_a");
            localStorage.removeItem("swap_mint_b");
          }
        }

        if (!mintsValid) {
          mintA = await createMint(connection, adminKp, adminKp.publicKey, null, DECIMALS);
          mintB = await createMint(connection, adminKp, adminKp.publicKey, null, DECIMALS);
          localStorage.setItem("swap_mint_a", mintA.toBase58());
          localStorage.setItem("swap_mint_b", mintB.toBase58());
        }

        mintARef.current = mintA;
        mintBRef.current = mintB;

        // 5. Create ATAs
        setBootstrapStatus("Creating token accounts...");
        const [adminAtaAInfo, adminAtaBInfo, userAtaAInfo, userAtaBInfo] = await Promise.all([
          getOrCreateAssociatedTokenAccount(connection, adminKp, mintA, adminKp.publicKey),
          getOrCreateAssociatedTokenAccount(connection, adminKp, mintB, adminKp.publicKey),
          getOrCreateAssociatedTokenAccount(connection, adminKp, mintA, userKp.publicKey),
          getOrCreateAssociatedTokenAccount(connection, adminKp, mintB, userKp.publicKey),
        ]);

        adminAtaARef.current = adminAtaAInfo.address;
        adminAtaBRef.current = adminAtaBInfo.address;
        userAtaARef.current = userAtaAInfo.address;
        userAtaBRef.current = userAtaBInfo.address;

        // 6. Mint tokens if balances are low
        setBootstrapStatus("Minting demo tokens...");
        const MINT_THRESHOLD = BigInt(100_000 * SCALE);
        const MINT_AMOUNT = BigInt(1_000_000 * SCALE);

        const mintOps: Promise<string>[] = [];
        if (adminAtaAInfo.amount < MINT_THRESHOLD)
          mintOps.push(mintTo(connection, adminKp, mintA, adminAtaAInfo.address, adminKp, MINT_AMOUNT));
        if (adminAtaBInfo.amount < MINT_THRESHOLD)
          mintOps.push(mintTo(connection, adminKp, mintB, adminAtaBInfo.address, adminKp, MINT_AMOUNT));
        if (userAtaAInfo.amount < MINT_THRESHOLD)
          mintOps.push(mintTo(connection, adminKp, mintA, userAtaAInfo.address, adminKp, MINT_AMOUNT));
        if (userAtaBInfo.amount < MINT_THRESHOLD)
          mintOps.push(mintTo(connection, adminKp, mintB, userAtaBInfo.address, adminKp, MINT_AMOUNT));
        await Promise.all(mintOps);

        // 7. Derive PDAs
        const [marketPda, bump] = deriveMarketPda(mintA, mintB);
        const vaultA = deriveVaultPda("vault_a", marketPda);
        const vaultB = deriveVaultPda("vault_b", marketPda);

        marketPdaRef.current = marketPda;
        vaultARef.current = vaultA;
        vaultBRef.current = vaultB;
        marketBumpRef.current = bump;

        // 8. Fetch on-chain state
        setBootstrapStatus("Fetching on-chain state...");
        await refreshState();

        if (!cancelled) setAppState("ready");
      } catch (err) {
        console.error("Bootstrap failed:", err);
        if (!cancelled) setBootstrapStatus(`Error: ${String(err)}`);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isReady = appState === "ready" || appState === "txPending";
  const activeKey = isReady
    ? (role === "admin" ? adminKpRef.current?.publicKey.toBase58() : userKpRef.current?.publicKey.toBase58()) ?? ""
    : "";
  const activeSol = role === "admin" ? adminSol : userSol;
  const walletBalA = role === "admin" ? adminBalA : userBalA;
  const walletBalB = role === "admin" ? adminBalB : userBalB;

  if (!isReady) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-zinc-400 text-sm">{bootstrapStatus}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <RoleBar
          role={role}
          setRole={setRole}
          activeKey={activeKey}
          activeSol={activeSol}
        />

        <MarketState
          marketData={marketData}
          vaultABal={vaultABal}
          vaultBBal={vaultBBal}
          walletBalA={walletBalA}
          walletBalB={walletBalB}
        />

        {role === "admin" && adminKpRef.current && mintARef.current && mintBRef.current && marketPdaRef.current && vaultARef.current && vaultBRef.current && adminAtaARef.current && adminAtaBRef.current && (
          <AdminPanel
            adminKp={adminKpRef.current}
            mintA={mintARef.current}
            mintB={mintBRef.current}
            marketPda={marketPdaRef.current}
            vaultA={vaultARef.current}
            vaultB={vaultBRef.current}
            marketBump={marketBumpRef.current}
            marketData={marketData}
            adminAtaA={adminAtaARef.current}
            adminAtaB={adminAtaBRef.current}
            setTxPending={(b) => setAppState(b ? "txPending" : "ready")}
            addLog={addLog}
            refreshState={refreshState}
          />
        )}

        {role === "user" && marketData && userKpRef.current && mintARef.current && mintBRef.current && marketPdaRef.current && vaultARef.current && vaultBRef.current && userAtaARef.current && userAtaBRef.current && (
          <SwapPanel
            userKp={userKpRef.current}
            mintA={mintARef.current}
            mintB={mintBRef.current}
            marketPda={marketPdaRef.current}
            vaultA={vaultARef.current}
            vaultB={vaultBRef.current}
            marketData={marketData}
            userAtaA={userAtaARef.current}
            userAtaB={userAtaBRef.current}
            setTxPending={(b) => setAppState(b ? "txPending" : "ready")}
            addLog={addLog}
            refreshState={refreshState}
          />
        )}

        {role === "user" && !marketData && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-zinc-500 text-sm text-center">
            Market not initialized yet. Switch to Admin to initialize it.
          </div>
        )}

        {/* Transaction Log */}
        {txLog.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-1.5">
            <p className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Transaction Log</p>
            {txLog.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={entry.ok ? "text-emerald-400" : "text-red-400"}>
                  {entry.ok ? "✓" : "✗"}
                </span>
                <span className="text-zinc-300">{entry.msg}</span>
                {entry.sig && (
                  <span className="text-zinc-600 font-mono text-xs ml-auto shrink-0">
                    [{entry.sig.slice(0, 6)}...{entry.sig.slice(-4)}]
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
