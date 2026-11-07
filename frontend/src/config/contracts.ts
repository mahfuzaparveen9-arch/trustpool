import { parseAbi } from "viem";
import { type Address } from "viem";

// ============ Contract Addresses ============
// These are loaded from environment variables set after deployment
// Run the deploy script and copy addresses to .env.local

export const ADDRESSES = {
  lendingPool: (process.env.NEXT_PUBLIC_LENDING_POOL_ADDRESS || "0x") as Address,
  mUSDC: (process.env.NEXT_PUBLIC_MUSDC_ADDRESS || "0x") as Address,
  mWETH: (process.env.NEXT_PUBLIC_MWETH_ADDRESS || "0x") as Address,
  oracle: (process.env.NEXT_PUBLIC_ORACLE_ADDRESS || "0x") as Address,
  creditScore: (process.env.NEXT_PUBLIC_CREDIT_SCORE_ADDRESS || "0x") as Address,
  interestModel: (process.env.NEXT_PUBLIC_INTEREST_MODEL_ADDRESS || "0x") as Address,
  demoSeeder: (process.env.NEXT_PUBLIC_DEMO_SEEDER_ADDRESS || "0x") as Address,
};

// ============ ABIs ============

export const LENDING_POOL_ABI = parseAbi([
  // Lender functions
  "function depositLiquidity(uint256 amount) external",
  "function withdrawLiquidity(uint256 shareAmount) external",
  "function getLenderBalance(address lender) view returns (uint256)",
  "function shares(address) view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function totalDeposited() view returns (uint256)",
  "function totalBorrowed() view returns (uint256)",

  // Borrower functions
  "function depositCollateral(uint256 amount) external",
  "function withdrawCollateral(uint256 amount) external",
  "function borrow(uint256 amount) external",
  "function repay(uint256 amount) external",

  // Liquidation
  "function liquidate(address borrower, uint256 repayAmount) external",

  // View functions
  "function getPosition(address user) view returns (uint256 collateralAmount, uint256 collateralValueUSD, uint256 debtAmount, uint256 healthFactor, uint256 tier, uint256 ratePerBlock, uint256 annualRate)",
  "function getHealthFactor(address user) view returns (uint256)",
  "function getAvailableLiquidity() view returns (uint256)",
  "function getCurrentRates() view returns (uint256 perBlock, uint256 annualized, uint256 utilization)",
  "function getBorrowerCount() view returns (uint256)",
  "function getBorrower(uint256 index) view returns (address)",
  "function borrowIndex() view returns (uint256)",
  "function totalReserves() view returns (uint256)",

  // Interest
  "function accrueInterest() external",

  // Events
  "event LiquidityDeposited(address indexed lender, uint256 amount, uint256 sharesMinted)",
  "event LiquidityWithdrawn(address indexed lender, uint256 amount, uint256 sharesBurned)",
  "event CollateralDeposited(address indexed borrower, uint256 amount)",
  "event CollateralWithdrawn(address indexed borrower, uint256 amount)",
  "event Borrowed(address indexed borrower, uint256 amount, uint256 tier, uint256 collateralRatio)",
  "event Repaid(address indexed borrower, uint256 amount, bool fullRepayment)",
  "event Liquidated(address indexed borrower, address indexed liquidator, uint256 debtRepaid, uint256 collateralSeized, uint256 bounty)",
  "event InterestAccrued(uint256 blockNumber, uint256 newBorrowIndex, uint256 interestAmount, uint256 reserveAmount)",
]);

export const CREDIT_SCORE_ABI = parseAbi([
  "function getScore(address user) view returns (uint256)",
  "function getTier(address user) view returns (uint256)",
  "function getTerms(address user) view returns (uint256 collateralRatio, uint256 liquidationRatio, uint256 rateDiscount, uint256 maxBorrow)",
  "function getTermsForTier(uint256 tier) view returns (uint256 collateralRatio, uint256 liquidationRatio, uint256 rateDiscount, uint256 maxBorrow)",
  "function getUserData(address user) view returns ((uint256 firstInteractionBlock, uint256 repaymentCount, uint256 cumulativeRepaidVolume, uint256 liquidationCount, uint256 currentStreak, uint256 lastScoreUpdateBlock, uint256 scoreGainInWindow, uint256 cachedScore))",
  "function demoSeedScore(address user, uint256 repayments, uint256 volume, uint256 streak) external",

  "event ScoreUpdated(address indexed user, uint256 oldScore, uint256 newScore, string reason)",
]);

export const MOCK_ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function faucet() external",
  "function faucetAmount(uint256 amount) external",
  "function mint(address to, uint256 amount) external",

  "event Fauceted(address indexed to, uint256 amount)",
]);

export const ORACLE_ABI = parseAbi([
  "function getPrice(address asset) view returns (uint256 price, uint256 updatedAt)",
  "function setPrice(address asset, uint256 price) external",
  "function maxStaleness() view returns (uint256)",
]);

export const INTEREST_MODEL_ABI = parseAbi([
  "function getPerBlockRate(uint256 totalSupply, uint256 totalBorrows) view returns (uint256)",
  "function getEffectiveRate(uint256 totalSupply, uint256 totalBorrows, uint256 rateDiscount) view returns (uint256)",
  "function getRates(uint256 totalSupply, uint256 totalBorrows) view returns (uint256 perBlock, uint256 annualized)",
  "function getUtilization(uint256 totalSupply, uint256 totalBorrows) view returns (uint256)",
  "function BLOCKS_PER_YEAR() view returns (uint256)",
]);
