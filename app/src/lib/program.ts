import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import idl from "../../../target/idl/solana_swap.json";
import type { SolanaSwap } from "../../../target/types/solana_swap";

export { BN };

export const PROGRAM_ID = new PublicKey("8gU4na42yZ8Po89WkbW6krWww8CDnoJKLHvcuSPimgjW");
export const RPC_ENDPOINT = "http://localhost:8899";
export const DECIMALS = 6;
export const SCALE = 1_000_000;
export const PRICE_DECIMAL_FACTOR = 1_000_000;

export type MarketData = {
  authority: PublicKey;
  tokenMintA: PublicKey;
  tokenMintB: PublicKey;
  price: BN;
  decimalsA: number;
  decimalsB: number;
  bump: number;
};

export function getProgram(keypair: Keypair): Program<SolanaSwap> {
  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const wallet = {
    publicKey: keypair.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
      if (tx instanceof VersionedTransaction) tx.sign([keypair]);
      else tx.partialSign(keypair);
      return tx;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
      return txs.map((tx) => {
        if (tx instanceof VersionedTransaction) tx.sign([keypair]);
        else tx.partialSign(keypair);
        return tx;
      });
    },
  };
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program<SolanaSwap>(idl as unknown as SolanaSwap, provider);
}

export function deriveMarketPda(mintA: PublicKey, mintB: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), mintA.toBuffer(), mintB.toBuffer()],
    PROGRAM_ID
  );
}

export function deriveVaultPda(seed: string, marketPda: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(seed), marketPda.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}
