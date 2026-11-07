/**
 * TrustPool Liquidation Keeper
 * ============================
 * A permissionless keeper bot that monitors the LendingPool for unhealthy
 * positions and liquidates them to earn a 5% bounty on seized collateral.
 *
 * ANYONE can run this script — it's a public good for protocol health.
 * The keeper earns a bounty for every successful liquidation.
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in values
 *   2. npm install
 *   3. npm start
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
  type PublicClient,
  type WalletClient,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil, baseSepolia } from "viem/chains";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ============ Configuration ============

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL_MS || "2000");
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "31337");

// ============ Contract ABIs (minimal) ============

const LENDING_POOL_ABI = parseAbi([
  "function getBorrowerCount() view returns (uint256)",
  "function getBorrower(uint256 index) view returns (address)",
  "function getHealthFactor(address user) view returns (uint256)",
  "function getPosition(address user) view returns (uint256 collateralAmount, uint256 collateralValueUSD, uint256 debtAmount, uint256 healthFactor, uint256 tier, uint256 ratePerBlock, uint256 annualRate)",
  "function liquidate(address borrower, uint256 repayAmount)",
  "function accrueInterest()",
  "event Borrowed(address indexed borrower, uint256 amount, uint256 tier, uint256 collateralRatio)",
  "event Repaid(address indexed borrower, uint256 amount, bool fullRepayment)",
  "event Liquidated(address indexed borrower, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized, uint256 bounty)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// ============ Load Deployment Addresses ============

function loadAddresses(): {
  lendingPool: Address;
  mUSDC: Address;
  mWETH: Address;
} {
  // Try loading from env first
  if (
    process.env.LENDING_POOL_ADDRESS &&
    process.env.MUSDC_ADDRESS &&
    process.env.MWETH_ADDRESS
  ) {
    return {
      lendingPool: process.env.LENDING_POOL_ADDRESS as Address,
      mUSDC: process.env.MUSDC_ADDRESS as Address,
      mWETH: process.env.MWETH_ADDRESS as Address,
    };
  }

  // Try loading from deployments.json
  const deploymentsPath = resolve(
    process.cwd(),
    "../contracts/deployments.json"
  );
  if (existsSync(deploymentsPath)) {
    const deployments = JSON.parse(readFileSync(deploymentsPath, "utf-8"));
    return {
      lendingPool: deployments.lendingPool as Address,
      mUSDC: deployments.mUSDC as Address,
      mWETH: deployments.mWETH as Address,
    };
  }

  throw new Error(
    "No contract addresses found. Set them in .env or run the deploy script first."
  );
}

// ============ Main Keeper Logic ============

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║         🏦 TrustPool Liquidation Keeper 🏦          ║
║                                                      ║
║  Anyone can run this script and earn bounties for    ║
║  liquidating unhealthy positions.                    ║
║                                                      ║
║  Bounty: 5% of repaid debt in collateral tokens     ║
╚══════════════════════════════════════════════════════╝
  `);

  if (!PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const addresses = loadAddresses();
  const account = privateKeyToAccount(PRIVATE_KEY);
  const chain: Chain = CHAIN_ID === 84532 ? baseSepolia : anvil;

  console.log(`⚙️  Config:`);
  console.log(`   Chain: ${chain.name} (${CHAIN_ID})`);
  console.log(`   RPC: ${RPC_URL}`);
  console.log(`   Keeper wallet: ${account.address}`);
  console.log(`   LendingPool: ${addresses.lendingPool}`);
  console.log(`   Check interval: ${CHECK_INTERVAL}ms`);
  console.log();

  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });

  // Ensure USDC approval for liquidation
  const currentAllowance = await publicClient.readContract({
    address: addresses.mUSDC,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, addresses.lendingPool],
  });

  if (currentAllowance < BigInt(1e18)) {
    console.log("📝 Approving USDC for liquidation...");
    const hash = await walletClient.writeContract({
      address: addresses.mUSDC,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [
        addresses.lendingPool,
        BigInt(
          "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
        ),
      ],
    });
    console.log(`   ✅ Approval tx: ${hash}`);
  }

  // Track known borrowers from events
  const borrowers = new Set<Address>();

  console.log("👀 Starting health check loop...\n");

  // Main loop
  let lastBlock = 0n;

  async function checkAndLiquidate() {
    try {
      const blockNumber = await publicClient.getBlockNumber();

      if (blockNumber <= lastBlock) return;
      lastBlock = blockNumber;

      // Get borrower count
      const count = await publicClient.readContract({
        address: addresses.lendingPool,
        abi: LENDING_POOL_ABI,
        functionName: "getBorrowerCount",
      });

      if (count === 0n) {
        process.stdout.write(
          `\r⏳ Block ${blockNumber} | No active borrowers`
        );
        return;
      }

      // Check each borrower
      let unhealthyCount = 0;

      for (let i = 0n; i < count; i++) {
        const borrower = await publicClient.readContract({
          address: addresses.lendingPool,
          abi: LENDING_POOL_ABI,
          functionName: "getBorrower",
          args: [i],
        });

        try {
          const position = await publicClient.readContract({
            address: addresses.lendingPool,
            abi: LENDING_POOL_ABI,
            functionName: "getPosition",
            args: [borrower],
          });

          const [, , debtAmount, healthFactor] = position;

          if (debtAmount === 0n) continue;

          const hfFormatted = formatUnits(healthFactor, 18);

          if (healthFactor < BigInt(1e18)) {
            unhealthyCount++;
            console.log(
              `\n🚨 UNHEALTHY POSITION FOUND!`
            );
            console.log(`   Borrower: ${borrower}`);
            console.log(
              `   Debt: ${formatUnits(debtAmount, 6)} USDC`
            );
            console.log(`   Health Factor: ${hfFormatted}`);

            // Check our USDC balance
            const ourBalance = await publicClient.readContract({
              address: addresses.mUSDC,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [account.address],
            });

            const repayAmount =
              debtAmount < ourBalance ? debtAmount : ourBalance;

            if (repayAmount === 0n) {
              console.log(
                "   ⚠️  No USDC balance for liquidation. Get some from the faucet!"
              );
              continue;
            }

            console.log(
              `   💰 Attempting to liquidate with ${formatUnits(repayAmount, 6)} USDC...`
            );

            try {
              const hash = await walletClient.writeContract({
                address: addresses.lendingPool,
                abi: LENDING_POOL_ABI,
                functionName: "liquidate",
                args: [borrower as Address, repayAmount],
              });

              console.log(`   ✅ LIQUIDATION SUCCESS!`);
              console.log(`   📜 TX Hash: ${hash}`);

              if (CHAIN_ID === 84532) {
                console.log(
                  `   🔗 Explorer: https://sepolia.basescan.org/tx/${hash}`
                );
              }

              // Check our new WETH balance (bounty)
              const wethBalance = await publicClient.readContract({
                address: addresses.mWETH,
                abi: ERC20_ABI,
                functionName: "balanceOf",
                args: [account.address],
              });
              console.log(
                `   🎁 WETH balance (bounty): ${formatUnits(wethBalance, 18)} WETH\n`
              );
            } catch (err: any) {
              console.log(
                `   ❌ Liquidation failed: ${err.shortMessage || err.message}`
              );
            }
          }
        } catch {
          // Position might have been cleared
        }
      }

      if (unhealthyCount === 0) {
        process.stdout.write(
          `\r⏳ Block ${blockNumber} | ${count} borrowers | All healthy ✅`
        );
      }
    } catch (err: any) {
      console.error(`\n❌ Error: ${err.shortMessage || err.message}`);
    }
  }

  // Run immediately and then on interval
  await checkAndLiquidate();
  setInterval(checkAndLiquidate, CHECK_INTERVAL);
}

main().catch(console.error);
