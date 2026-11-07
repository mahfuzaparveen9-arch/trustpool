# TrustPool Architecture

## System Overview

TrustPool is a fully onchain credit lending protocol where users build credit scores through responsible borrowing behavior. The credit score unlocks better lending terms — lower collateral requirements and interest rate discounts.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                       │
│  Dashboard │ Liquidations │ Compare │ Demo Controls │ How It Works │
└──────┬──────────────┬──────────────┬───────────────────────────┘
       │              │              │
       │         wagmi/viem          │
       │         (direct RPC)        │
       ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     BASE SEPOLIA / ANVIL                         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  MockERC20   │  │  MockERC20   │  │  MockPriceOracle     │   │
│  │  (mUSDC, 6d) │  │  (mWETH,18d) │  │  (IPriceOracle)      │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         ▼                 ▼                      ▼               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     LendingPool                          │   │
│  │                                                          │   │
│  │  depositLiquidity()  │  depositCollateral()  │  borrow() │   │
│  │  withdrawLiquidity() │  withdrawCollateral() │  repay()  │   │
│  │                      │                       │           │   │
│  │  liquidate() ← callable by ANYONE                       │   │
│  │  accrueInterest() ← per-block via borrowIndex           │   │
│  └──────┬───────────────────────────┬───────────────────────┘   │
│         │                           │                           │
│         ▼                           ▼                           │
│  ┌──────────────┐           ┌──────────────┐                    │
│  │ CreditScore  │           │InterestModel │                    │
│  │              │           │              │                    │
│  │ Score: 300-  │           │ Utilization  │                    │
│  │   850        │           │ based rate   │                    │
│  │ Tiers: 0/1/2 │           │ with kink    │                    │
│  └──────────────┘           └──────────────┘                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
       ▲
       │ watches events + calls liquidate()
       │
┌──────┴───────┐
│    Keeper    │ ← Anyone can run this
│ (TypeScript) │
│ viem + dotenv│
└──────────────┘
```

## Transaction Flow

```
1. DEPOSIT COLLATERAL
   User → depositCollateral(amount) → Pool stores WETH
   ↓ CreditScore.initUser() called

2. SCORE CHECK
   Pool → CreditScore.getTerms(user) → returns (collateralRatio, liquidationRatio, discount, maxBorrow)
   Based on user's tier (0/1/2) from accumulated repayment history

3. BORROW
   User → borrow(amount) → checks collateral ratio, borrow cap, liquidity
   Pool transfers USDC to user, records debt in borrowIndex units

4. INTEREST ACCRUAL (every block)
   Anyone → accrueInterest() (or automatically on any state-changing call)
   borrowIndex += borrowIndex * ratePerBlock * blocksElapsed / 1e18
   User's debt = borrowAmount * currentIndex / userIndex

5. REPAY
   User → repay(amount) → transfers USDC back, reduces debt
   If full repayment: CreditScore.recordRepayment() → score may increase

6. SCORE IMPROVEMENT
   Only if loan was open ≥ 50 blocks AND borrowed ≥ 100 USDC
   Increases: repaymentCount, volume, streak → score rises → tier may upgrade

7. LIQUIDATION
   If healthFactor < 1e18:
   Anyone → liquidate(borrower, repayAmount) → repays debt, receives collateral + 5% bounty
   CreditScore.recordLiquidation() → streak reset, -75 score penalty
```

## What Is Onchain vs Offchain

| Component | Location | Why |
|-----------|----------|-----|
| Credit Score | **Onchain** | Core logic; fully transparent, verifiable, composable |
| Interest Accrual | **Onchain** | Per-block, trustless via borrowIndex |
| Liquidation | **Onchain** | Permissionless; anyone can call |
| Lending Pool | **Onchain** | All accounting, positions, shares |
| Price Oracle | **Onchain** (mock) | Interface allows swapping to Chainlink/Pyth |
| Keeper Bot | **Offchain** | Watches and calls liquidate(); open, replaceable |
| Frontend | **Offchain** | Read-only UI; no backend server needed |
