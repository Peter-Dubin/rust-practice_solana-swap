import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SolanaSwap } from "../target/types/solana_swap";
import {
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("solana-swap", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SolanaSwap as Program<SolanaSwap>;

  const initializer = anchor.web3.Keypair.generate();
  const user = anchor.web3.Keypair.generate();

  let mintA: anchor.web3.PublicKey;
  let mintB: anchor.web3.PublicKey;

  let initializerTokenA: anchor.web3.PublicKey;
  let initializerTokenB: anchor.web3.PublicKey;
  let userTokenA: anchor.web3.PublicKey;
  let userTokenB: anchor.web3.PublicKey;

  let marketPda: anchor.web3.PublicKey;
  let marketBump: number;
  let vaultA: anchor.web3.PublicKey;
  let vaultB: anchor.web3.PublicKey;

  const DECIMALS = 6;
  const SCALE = 10 ** DECIMALS;
  const INITIAL_SUPPLY = 1_000_000 * SCALE;
  const PRICE = 2_500_000; // 2.5x

  before(async () => {
    // Airdrop to both wallets
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        initializer.publicKey,
        200 * anchor.web3.LAMPORTS_PER_SOL
      )
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(
        user.publicKey,
        200 * anchor.web3.LAMPORTS_PER_SOL
      )
    );

    // Create two mints
    mintA = await createMint(
      provider.connection,
      initializer,
      initializer.publicKey,
      null,
      DECIMALS
    );
    mintB = await createMint(
      provider.connection,
      initializer,
      initializer.publicKey,
      null,
      DECIMALS
    );

    // Create ATAs for initializer and user
    initializerTokenA = await createAssociatedTokenAccount(
      provider.connection,
      initializer,
      mintA,
      initializer.publicKey
    );
    initializerTokenB = await createAssociatedTokenAccount(
      provider.connection,
      initializer,
      mintB,
      initializer.publicKey
    );
    userTokenA = await createAssociatedTokenAccount(
      provider.connection,
      user,
      mintA,
      user.publicKey
    );
    userTokenB = await createAssociatedTokenAccount(
      provider.connection,
      user,
      mintB,
      user.publicKey
    );

    // Mint 1,000,000 of each token to each account
    await mintTo(
      provider.connection,
      initializer,
      mintA,
      initializerTokenA,
      initializer,
      INITIAL_SUPPLY
    );
    await mintTo(
      provider.connection,
      initializer,
      mintB,
      initializerTokenB,
      initializer,
      INITIAL_SUPPLY
    );
    await mintTo(
      provider.connection,
      initializer,
      mintA,
      userTokenA,
      initializer,
      INITIAL_SUPPLY
    );
    await mintTo(
      provider.connection,
      initializer,
      mintB,
      userTokenB,
      initializer,
      INITIAL_SUPPLY
    );

    // Derive PDAs
    [marketPda, marketBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("market"), mintA.toBuffer(), mintB.toBuffer()],
      program.programId
    );
    [vaultA] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_a"), marketPda.toBuffer()],
      program.programId
    );
    [vaultB] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_b"), marketPda.toBuffer()],
      program.programId
    );
  });

  it("1. Authority initializes market with correct state", async () => {
    await program.methods
      .initializeMarket(new BN(PRICE), DECIMALS, DECIMALS, marketBump)
      .accounts({
        market: marketPda,
        vaultA,
        vaultB,
        tokenMintA: mintA,
        tokenMintB: mintB,
        authority: initializer.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initializer])
      .rpc();

    const market = await program.account.marketAccount.fetch(marketPda);
    assert.equal(market.authority.toBase58(), initializer.publicKey.toBase58());
    assert.equal(market.tokenMintA.toBase58(), mintA.toBase58());
    assert.equal(market.tokenMintB.toBase58(), mintB.toBase58());
    assert.equal(market.price.toNumber(), PRICE);
    assert.equal(market.decimalsA, DECIMALS);
    assert.equal(market.decimalsB, DECIMALS);
    assert.equal(market.bump, marketBump);
  });

  it("2. Authority updates price with set_price", async () => {
    const newPrice = 2_500_000;
    await program.methods
      .setPrice(new BN(newPrice))
      .accounts({
        market: marketPda,
        tokenMintA: mintA,
        tokenMintB: mintB,
        authority: initializer.publicKey,
      })
      .signers([initializer])
      .rpc();

    const market = await program.account.marketAccount.fetch(marketPda);
    assert.equal(market.price.toNumber(), newPrice);
  });

  it("3. Authority adds 1000 of each token to vaults", async () => {
    const addAmount = 1000 * SCALE;

    const vaultABefore = await getAccount(provider.connection, vaultA);
    const vaultBBefore = await getAccount(provider.connection, vaultB);
    const authABefore = await getAccount(provider.connection, initializerTokenA);
    const authBBefore = await getAccount(provider.connection, initializerTokenB);

    await program.methods
      .addLiquidity(new BN(addAmount), new BN(addAmount))
      .accounts({
        market: marketPda,
        vaultA,
        vaultB,
        authorityTokenA: initializerTokenA,
        authorityTokenB: initializerTokenB,
        tokenMintA: mintA,
        tokenMintB: mintB,
        authority: initializer.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    const vaultAAfter = await getAccount(provider.connection, vaultA);
    const vaultBAfter = await getAccount(provider.connection, vaultB);
    const authAAfter = await getAccount(provider.connection, initializerTokenA);
    const authBAfter = await getAccount(provider.connection, initializerTokenB);

    assert.equal(
      Number(vaultAAfter.amount) - Number(vaultABefore.amount),
      addAmount
    );
    assert.equal(
      Number(vaultBAfter.amount) - Number(vaultBBefore.amount),
      addAmount
    );
    assert.equal(
      Number(authABefore.amount) - Number(authAAfter.amount),
      addAmount
    );
    assert.equal(
      Number(authBBefore.amount) - Number(authBAfter.amount),
      addAmount
    );
  });

  it("4. User swaps 100 Token A and receives 250 Token B (at 2.5x rate)", async () => {
    const swapAmount = 100 * SCALE;
    const expectedOut = 250 * SCALE;

    const userABefore = await getAccount(provider.connection, userTokenA);
    const userBBefore = await getAccount(provider.connection, userTokenB);

    await program.methods
      .swap(new BN(swapAmount), true)
      .accounts({
        market: marketPda,
        vaultA,
        vaultB,
        userTokenA,
        userTokenB,
        tokenMintA: mintA,
        tokenMintB: mintB,
        user: user.publicKey,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    const userAAfter = await getAccount(provider.connection, userTokenA);
    const userBAfter = await getAccount(provider.connection, userTokenB);

    assert.equal(
      Number(userABefore.amount) - Number(userAAfter.amount),
      swapAmount,
      "user should lose 100 Token A"
    );
    assert.equal(
      Number(userBAfter.amount) - Number(userBBefore.amount),
      expectedOut,
      "user should gain 250 Token B"
    );
  });
});
