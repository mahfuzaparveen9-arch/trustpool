# 🏦 TrustPool — Onchain Credit Lending Protocol

> **"Your wallet is your credit score."**

TrustPool is a fully onchain lending protocol where borrowers build credit scores through responsible repayment behavior. Higher scores unlock lower collateral requirements (150% → 120% → 80%) and better interest rates. Interest accrues every block. Anyone can liquidate unhealthy loans and earn a bounty. No centralized backend required.

**Built for the "Onchain Finance & Trading" hackathon track.**

---

## 🎯 Problem

DeFi lending today requires **150%+ overcollateralization** for everyone, regardless of their history. A first-time borrower and a wallet with years of perfect repayment get the exact same terms. There's no concept of "creditworthiness" — your track record doesn't matter.

## 💡 Solution

TrustPool computes a **credit score entirely onchain** from verifiable repayment behavior:

- **Score range**: 300 (new) → 850 (excellent)
- **Inputs**: repayment count, repaid volume, streak bonus, protocol age, liquidation penalties
- **Sybil-resistant**: loans must be ≥ 50 blocks old and ≥ 100 USDC to count
- **Three tiers** unlock progressively better terms:

| Tier | Score | Collateral | Liquidation | Rate Discount | Max Borrow |
|------|-------|-----------|-------------|---------------|------------|
| 0 — New | 300-449 | 150% | 125% | 0% | $5,000 |
| 1 — Trusted | 450-649 | 120% | 105% | 10% | $25,000 |
| 2 — Prime | 650+ | **80%** | 65% | 25% | $100,000 |

## 🔗 Why Onchain-Native?

| Component | Onchain? | Rationale |
|-----------|----------|-----------|
| Credit Score | ✅ **Onchain** | Fully transparent, verifiable, composable by other protocols |
| Interest Accrual | ✅ **Onchain** | Per-block via `borrowIndex` — trustless, no keeper needed |
| Liquidation | ✅ **Onchain** | Permissionless — anyone can call `liquidate()` and earn a bounty |
| Lending Pool | ✅ **Onchain** | All accounting, positions, shares stored in smart contracts |
| Price Oracle | ✅ **Onchain** (mock) | `IPriceOracle` interface; swap in Chainlink/Pyth adapter |
| Keeper Bot | ❌ Offchain | Watches chain, calls `liquidate()` when needed — **open-source, replaceable** |
| Frontend | ❌ Offchain | Read-only UI via RPC — **no backend server, no database** |

---

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▸│  LendingPool │◂────│    Keeper    │
│  (Next.js)   │     │  (Solidity)  │     │ (TypeScript) │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
      ┌──────────────┐ ┌──────────┐ ┌────────────┐
      │ CreditScore  │ │ Interest │ │ PriceOracle│
      │  (300-850)   │ │  Model   │ │ (mock/real)│
      └──────────────┘ └──────────┘ └────────────┘
              ▼
      ┌──────────────┐
      │  mUSDC/mWETH │
      │  (ERC-20)    │
      └──────────────┘
```

### Transaction Flow

```
1. Deposit → 2. Score Check → 3. Borrow → 4. Per-block Interest
     ↓              ↓              ↓              ↓
5. Repay → 6. Score Improves → 7. Better Terms → (Liquidation if risky)
```

---

## 📐 Core Financial Mechanisms

### Credit Score Formula
```
Score = 300 (base)
  + min(repayments × 25, 250)         // Repayment history
  + min(volume / 1000 USDC, 150)      // Volume loyalty
  + min(streak × 10, 100)             // Consistency bonus
  + min(protocolAge / 100 blocks, 50) // Tenure
  - liquidations × 75                 // Penalty
```

### Sybil Resistance
- Repayment only counts if loan was open **≥ 50 blocks**
- Repayment only counts if borrowed amount **≥ 100 USDC**
- Score gain capped at **+50 per 100-block window**
- Same-block borrow-and-repay earns **nothing**

### Per-Block Interest (borrowIndex)
```
utilization = totalBorrowed / totalDeposited
if utilization ≤ 80%:
  annualRate = 2% + utilization × 4%
else:
  annualRate = 2% + 80% × 4% + (utilization - 80%) × 75%

perBlockRate = annualRate / 15,768,000 (blocks/year on Base)
borrowIndex += borrowIndex × perBlockRate × blocksElapsed / 1e18
userDebt = borrowAmount × currentIndex / userIndex
```

### Health Factor & Liquidation
```
healthFactor = collateralValueUSD / (debtUSD × liquidationRatio)
if healthFactor < 1:
  ANYONE can call liquidate(borrower, repayAmount)
  Liquidator: repays debt, receives collateral + 5% bounty
  Borrower: loses collateral, score penalty (-75), streak reset
```

---

## 📁 Repo Structure

```
trustpool/
├── contracts/              # Solidity smart contracts (Foundry)
│   ├── src/
│   │   ├── MockERC20.sol          # Mintable test tokens (mUSDC, mWETH)
│   │   ├── IPriceOracle.sol       # Oracle interface (swappable)
│   │   ├── MockPriceOracle.sol    # Demo oracle with owner-controlled price
│   │   ├── CreditScore.sol        # Onchain credit scoring engine
│   │   ├── InterestModel.sol      # Utilization-based rate model
│   │   ├── LendingPool.sol        # Core lending/borrowing pool
│   │   └── DemoSeeder.sol         # ⚠️ Demo-only score seeder
│   ├── test/
│   │   ├── LendingPool.t.sol      # 47 unit/scenario/fuzz tests
│   │   └── Invariant.t.sol        # 4 invariant tests (solvency, bounds)
│   └── script/
│       ├── Deploy.s.sol           # Deploy all contracts
│       └── Seed.s.sol             # Seed demo state
├── keeper/                 # Liquidation bot (TypeScript + viem)
│   └── src/index.ts
├── frontend/               # Next.js UI (wagmi + RainbowKit)
│   └── src/app/page.tsx
├── docs/                   # Architecture documentation
└── README.md
```

---

## 🚀 Setup & Run

### Prerequisites
- [Foundry](https://getfoundry.sh/) (`forge`, `anvil`, `cast`)
- [Node.js](https://nodejs.org/) ≥ 18
- [Git](https://git-scm.com/)

### 1. Clone & Install

```bash
git clone <repo-url>
cd trustpool

# Install contract dependencies
cd contracts && forge install && cd ..

# Install keeper dependencies
cd keeper && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..
```

### 2. Start Local Anvil

```bash
anvil --block-time 2
```

### 3. Deploy Contracts

```bash
cd contracts

# Set up environment
cp .env.example .env
# Edit .env: PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Deploy
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast

# Seed demo state (adds liquidity, seeds trusted wallet)
forge script script/Seed.s.sol --rpc-url http://localhost:8545 --broadcast
```

### 4. Configure Frontend

```bash
cd frontend
cp .env.example .env.local
# Copy addresses from contracts/deployments.json into .env.local
```

### 5. Start Frontend

```bash
cd frontend
npm run dev
# Open http://localhost:3000
```

### 6. Start Keeper (Optional)

```bash
cd keeper
cp .env.example .env
# Edit .env with addresses from deployments.json
npm start
```

### Environment Variables

**contracts/.env.example:**
```
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RPC_URL=http://localhost:8545
```

**frontend/.env.example:**
```
NEXT_PUBLIC_LENDING_POOL_ADDRESS=0x...
NEXT_PUBLIC_MUSDC_ADDRESS=0x...
NEXT_PUBLIC_MWETH_ADDRESS=0x...
NEXT_PUBLIC_ORACLE_ADDRESS=0x...
NEXT_PUBLIC_CREDIT_SCORE_ADDRESS=0x...
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=demo
NEXT_PUBLIC_CHAIN=anvil
```

---

## 🎬 3-Minute Demo Script

### Step 1: New Wallet Gets 150% Terms
1. Connect a fresh wallet in the frontend
2. Use the **Faucet** to get mUSDC and mWETH
3. Deposit 5 WETH as collateral ($10,000)
4. Try to borrow → see **150% collateral ratio**, **$5,000 cap**
5. Borrow 3,000 USDC → health factor shown

### Step 2: Trusted Wallet Gets 80% Terms
1. Switch to the seeded trusted wallet (or use **Compare** tab)
2. Score: ~750+ | Tier: 2 (Prime)
3. Same 5 WETH collateral → can borrow up to **$100,000** at **80%** ratio
4. Rate discount: **25% off**

### Step 3: Repay and Watch Score Rise
1. With the new wallet, repay the loan fully
2. Wait 50+ blocks (the loan qualifies)
3. Watch the credit score increase
4. Repeat 8 times → Tier 1 (120% collateral)

### Step 4: Crash Price and Liquidate
1. Go to **Demo Controls**
2. Click **💥 $500 (Crash)** — ETH drops from $2,000 to $500
3. Go to **Liquidations** tab → see the unhealthy position
4. Click **🔥 Liquidate** → earn the 5% bounty
5. Check the borrower's score penalty

### Step 5: Verify on Explorer
- Every transaction shows a toast with the tx hash
- On Base Sepolia: click the explorer link
- On Anvil: use `cast receipt <tx-hash>`

---

## 🧪 Tests

```bash
cd contracts

# Run all tests
forge test -vv

# Run with gas reporting
forge test --gas-report

# Run specific test
forge test --match-test test_Scenario_TierProgression -vvv
```

### Test Coverage
- **47 unit/scenario/fuzz tests** — all passing ✅
- **4 invariant tests** (64 runs × 32 depth = 2048 random calls) — all passing ✅
- Scenarios: tier progression, sybil resistance, liquidation, interest accrual
- Fuzz: random borrow/repay amounts, price changes, interest over many blocks
- Invariants: pool solvency, borrow index monotonicity, score bounds [300, 850]

---

## 🔐 Security Considerations

- **ReentrancyGuard** on all state-changing functions
- **SafeERC20** for all token transfers
- **Checks-effects-interactions** pattern
- **Custom errors** (gas efficient)
- **Oracle staleness check** (configurable `maxStaleness`)
- **Sybil resistance** (MIN_LOAN_BLOCKS, MIN_LOAN_AMOUNT, rate-limited score gains)
- **No hardcoded private keys** — all via .env

---

## ⚠️ Known Limitations

1. **MockPriceOracle**: Owner-controlled — production needs Chainlink/Pyth adapter
2. **Single collateral**: Only WETH → USDC; could support multiple assets
3. **No flash loan protection**: Could add additional checks
4. **Score persistence**: Score resets if contract upgraded (needs proxy pattern)
5. **Gas costs**: On-chain score computation adds gas; could optimize with caching
6. **Keeper centralization**: Currently a single script; could be incentivized with MEV

## 🔮 Future Scope

- **📱 Mobile App**: React Native wallet integration
- **🤖 ML Risk Scoring**: Off-chain ML model feeding on-chain attestations
- **🏢 Enterprise Score API**: Let other protocols query TrustPool scores
- **🌐 Multi-chain**: Deploy on Arbitrum, Optimism, Polygon via cross-chain messaging
- **🔗 Composability**: Allow other DeFi protocols to read and use TrustPool scores
- **📊 Advanced Analytics**: Historical score charts, risk dashboards
- **🏛️ Governance**: DAO for parameter tuning (rates, thresholds, tier boundaries)
- **🔒 ZK Score Proofs**: Prove creditworthiness without revealing full history

---

## 📄 Deployed Addresses

*(Fill after deployment)*

| Contract | Base Sepolia | Anvil (local) |
|----------|-------------|---------------|
| mUSDC | `0x...` | See `deployments.json` |
| mWETH | `0x...` | See `deployments.json` |
| MockPriceOracle | `0x...` | See `deployments.json` |
| CreditScore | `0x...` | See `deployments.json` |
| InterestModel | `0x...` | See `deployments.json` |
| LendingPool | `0x...` | See `deployments.json` |
| DemoSeeder | `0x...` | See `deployments.json` |

---

## 🏆 Built With

- **Solidity ^0.8.24** + Foundry
- **OpenZeppelin** (ERC20, Ownable, ReentrancyGuard, SafeERC20)
- **Next.js 16** (App Router) + TypeScript
- **wagmi + viem** (onchain reads/writes)
- **RainbowKit** (wallet connection)
- **Tailwind CSS** (styling)

---

*TrustPool — where your wallet history earns your trust. 🏦*
