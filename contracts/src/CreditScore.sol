// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CreditScore — Onchain credit scoring based on repayment behavior
/// @notice Score range: 300 (new) to 850 (excellent).
///         Only the LendingPool can update scores via recordRepayment / recordLiquidation.
///
/// Score formula (simplified for hackathon):
///   baseScore = 300
///   + repaymentPoints  (capped at 250): 25 per qualifying repayment
///   + volumePoints     (capped at 150): 1 per 1000 USDC repaid (normalized to 6 decimals)
///   + streakBonus      (capped at 100): 10 per consecutive on-time repayment
///   + agePoints         (capped at 50):  1 per 100 blocks of protocol membership
///   - liquidationPenalty: 75 per liquidation
///
/// Sybil resistance:
///   - Repayment only counts if loan was open >= MIN_LOAN_BLOCKS (50) blocks
///   - Repayment only counts if borrowed amount >= MIN_LOAN_AMOUNT (100 USDC = 100e6)
///   - Score gain capped at MAX_SCORE_GAIN_PER_WINDOW (50 points per 100 blocks)
///
/// Tiers:
///   Tier 0 (score < 450): 150% collateral, liquidation at 125%, 0% discount, 5000 USDC cap
///   Tier 1 (score 450-649): 120% collateral, liquidation at 105%, 10% discount, 25000 USDC cap
///   Tier 2 (score >= 650): 80% collateral, liquidation at 65%, 25% discount, 100000 USDC cap

contract CreditScore is Ownable {
    // ============ Constants ============

    uint256 public constant MIN_SCORE = 300;
    uint256 public constant MAX_SCORE = 850;

    // Sybil resistance
    uint256 public constant MIN_LOAN_BLOCKS = 50;
    uint256 public constant MIN_LOAN_AMOUNT = 100e6; // 100 USDC (6 decimals)
    uint256 public constant MAX_SCORE_GAIN_PER_WINDOW = 50;
    uint256 public constant SCORE_WINDOW_BLOCKS = 100;

    // Point values
    uint256 public constant POINTS_PER_REPAYMENT = 25;
    uint256 public constant MAX_REPAYMENT_POINTS = 250;
    uint256 public constant VOLUME_DIVISOR = 1000e6; // 1 point per 1000 USDC
    uint256 public constant MAX_VOLUME_POINTS = 150;
    uint256 public constant STREAK_BONUS_PER = 10;
    uint256 public constant MAX_STREAK_BONUS = 100;
    uint256 public constant AGE_DIVISOR = 100; // 1 point per 100 blocks
    uint256 public constant MAX_AGE_POINTS = 50;
    uint256 public constant LIQUIDATION_PENALTY = 75;

    // Tier thresholds
    uint256 public constant TIER_1_THRESHOLD = 450;
    uint256 public constant TIER_2_THRESHOLD = 650;

    // Tier terms (in basis points where applicable)
    // Collateral ratios in 1e18 (1.5e18 = 150%)
    uint256 public constant TIER_0_COLLATERAL_RATIO = 1.5e18;   // 150%
    uint256 public constant TIER_1_COLLATERAL_RATIO = 1.2e18;   // 120%
    uint256 public constant TIER_2_COLLATERAL_RATIO = 0.8e18;   //  80%

    uint256 public constant TIER_0_LIQUIDATION_RATIO = 1.25e18;  // 125%
    uint256 public constant TIER_1_LIQUIDATION_RATIO = 1.05e18;  // 105%
    uint256 public constant TIER_2_LIQUIDATION_RATIO = 0.65e18;  //  65%

    uint256 public constant TIER_0_RATE_DISCOUNT = 0;            //   0%
    uint256 public constant TIER_1_RATE_DISCOUNT = 1000;         //  10% (in bps)
    uint256 public constant TIER_2_RATE_DISCOUNT = 2500;         //  25% (in bps)

    // Max borrow caps in USDC (6 decimals)
    uint256 public constant TIER_0_MAX_BORROW = 5_000e6;
    uint256 public constant TIER_1_MAX_BORROW = 25_000e6;
    uint256 public constant TIER_2_MAX_BORROW = 100_000e6;

    // ============ State ============

    /// @notice The LendingPool address — only this address can update scores
    address public lendingPool;

    struct UserData {
        uint256 firstInteractionBlock; // Protocol membership start
        uint256 repaymentCount;        // Number of qualifying repayments
        uint256 cumulativeRepaidVolume; // In USDC (6 decimals)
        uint256 liquidationCount;      // Number of times liquidated
        uint256 currentStreak;         // Consecutive on-time repayments
        uint256 lastScoreUpdateBlock;  // For rate-limiting score gains
        uint256 scoreGainInWindow;     // Score gained in current window
        uint256 cachedScore;           // Last computed score
    }

    mapping(address => UserData) public userData;

    // ============ Errors ============

    error OnlyLendingPool();
    error LendingPoolAlreadySet();

    // ============ Events ============

    event ScoreUpdated(address indexed user, uint256 oldScore, uint256 newScore, string reason);
    event LendingPoolSet(address indexed pool);

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Admin ============

    /// @notice Set the LendingPool address (one-time setup after deployment)
    function setLendingPool(address _pool) external onlyOwner {
        if (lendingPool != address(0)) revert LendingPoolAlreadySet();
        lendingPool = _pool;
        emit LendingPoolSet(_pool);
    }

    // ============ Score Updates (only LendingPool) ============

    modifier onlyPool() {
        if (msg.sender != lendingPool) revert OnlyLendingPool();
        _;
    }

    /// @notice Initialize a user's first interaction block if not set
    function initUser(address user) external onlyPool {
        if (userData[user].firstInteractionBlock == 0) {
            userData[user].firstInteractionBlock = block.number;
        }
    }

    /// @notice Record a qualifying full repayment
    /// @param user The borrower
    /// @param repaidAmount Amount repaid in USDC (6 decimals)
    /// @param loanOpenBlocks How many blocks the loan was open
    /// @param borrowedAmount Original borrowed amount in USDC (6 decimals)
    function recordRepayment(
        address user,
        uint256 repaidAmount,
        uint256 loanOpenBlocks,
        uint256 borrowedAmount
    ) external onlyPool {
        UserData storage data = userData[user];

        // Sybil check: loan must have been open long enough and large enough
        if (loanOpenBlocks < MIN_LOAN_BLOCKS || borrowedAmount < MIN_LOAN_AMOUNT) {
            return; // Silently reject — no score change
        }

        uint256 oldScore = _computeScore(data);

        data.repaymentCount++;
        data.cumulativeRepaidVolume += repaidAmount;
        data.currentStreak++;

        uint256 newScore = _computeScore(data);

        // Rate-limit score gains
        if (_isNewWindow(data)) {
            data.scoreGainInWindow = 0;
            data.lastScoreUpdateBlock = block.number;
        }

        uint256 gain = newScore > oldScore ? newScore - oldScore : 0;
        if (data.scoreGainInWindow + gain > MAX_SCORE_GAIN_PER_WINDOW) {
            // Cap the gain
            gain = MAX_SCORE_GAIN_PER_WINDOW > data.scoreGainInWindow
                ? MAX_SCORE_GAIN_PER_WINDOW - data.scoreGainInWindow
                : 0;
        }
        data.scoreGainInWindow += gain;
        data.cachedScore = oldScore + gain;

        emit ScoreUpdated(user, oldScore, data.cachedScore, "repayment");
    }

    /// @notice Record a liquidation event (penalty)
    function recordLiquidation(address user) external onlyPool {
        UserData storage data = userData[user];
        uint256 oldScore = getScore(user);

        data.liquidationCount++;
        data.currentStreak = 0; // Reset streak on liquidation

        uint256 newScore = _computeScore(data);
        data.cachedScore = newScore;

        emit ScoreUpdated(user, oldScore, newScore, "liquidation");
    }

    /// @notice ⚠️ DEMO ONLY — Seed a score for demo/testing purposes
    /// @dev This allows judges to instantly see the difference between tiers
    function demoSeedScore(
        address user,
        uint256 repayments,
        uint256 volume,
        uint256 streak
    ) external onlyOwner {
        UserData storage data = userData[user];
        if (data.firstInteractionBlock == 0) {
            data.firstInteractionBlock = block.number > 1000 ? block.number - 1000 : 1;
        }
        data.repaymentCount = repayments;
        data.cumulativeRepaidVolume = volume;
        data.currentStreak = streak;
        data.liquidationCount = 0;

        uint256 newScore = _computeScore(data);
        data.cachedScore = newScore;

        emit ScoreUpdated(user, MIN_SCORE, newScore, "demo_seed");
    }

    // ============ View Functions ============

    /// @notice Get the computed credit score for a user
    function getScore(address user) public view returns (uint256) {
        UserData memory data = userData[user];
        if (data.firstInteractionBlock == 0) return MIN_SCORE;

        // Use cached score if available and account for rate limiting
        if (data.cachedScore > 0) {
            // Recalculate to include age growth
            uint256 computed = _computeScore(data);
            // If rate-limited, use cached (which includes the cap)
            if (data.scoreGainInWindow >= MAX_SCORE_GAIN_PER_WINDOW && !_isNewWindow(data)) {
                return data.cachedScore;
            }
            return computed;
        }

        return _computeScore(data);
    }

    /// @notice Get the tier (0, 1, or 2) for a user
    function getTier(address user) public view returns (uint256) {
        uint256 score = getScore(user);
        if (score >= TIER_2_THRESHOLD) return 2;
        if (score >= TIER_1_THRESHOLD) return 1;
        return 0;
    }

    /// @notice Get lending terms for a user based on their tier
    /// @return collateralRatio Minimum collateral ratio (1e18 scale)
    /// @return liquidationRatio Liquidation threshold (1e18 scale)
    /// @return rateDiscount Interest rate discount (bps, 10000 = 100%)
    /// @return maxBorrow Maximum borrow amount in USDC (6 decimals)
    function getTerms(address user)
        external
        view
        returns (
            uint256 collateralRatio,
            uint256 liquidationRatio,
            uint256 rateDiscount,
            uint256 maxBorrow
        )
    {
        uint256 tier = getTier(user);
        return getTermsForTier(tier);
    }

    /// @notice Get terms for a specific tier
    function getTermsForTier(uint256 tier)
        public
        pure
        returns (
            uint256 collateralRatio,
            uint256 liquidationRatio,
            uint256 rateDiscount,
            uint256 maxBorrow
        )
    {
        if (tier == 2) {
            return (TIER_2_COLLATERAL_RATIO, TIER_2_LIQUIDATION_RATIO, TIER_2_RATE_DISCOUNT, TIER_2_MAX_BORROW);
        } else if (tier == 1) {
            return (TIER_1_COLLATERAL_RATIO, TIER_1_LIQUIDATION_RATIO, TIER_1_RATE_DISCOUNT, TIER_1_MAX_BORROW);
        } else {
            return (TIER_0_COLLATERAL_RATIO, TIER_0_LIQUIDATION_RATIO, TIER_0_RATE_DISCOUNT, TIER_0_MAX_BORROW);
        }
    }

    /// @notice Get full user data for frontend display
    function getUserData(address user) external view returns (UserData memory) {
        return userData[user];
    }

    // ============ Internal ============

    function _computeScore(UserData memory data) internal view returns (uint256) {
        uint256 score = MIN_SCORE;

        // Repayment points: 25 per repayment, capped at 250
        uint256 repayPts = data.repaymentCount * POINTS_PER_REPAYMENT;
        if (repayPts > MAX_REPAYMENT_POINTS) repayPts = MAX_REPAYMENT_POINTS;
        score += repayPts;

        // Volume points: 1 per 1000 USDC, capped at 150
        uint256 volPts = data.cumulativeRepaidVolume / VOLUME_DIVISOR;
        if (volPts > MAX_VOLUME_POINTS) volPts = MAX_VOLUME_POINTS;
        score += volPts;

        // Streak bonus: 10 per consecutive repayment, capped at 100
        uint256 streakPts = data.currentStreak * STREAK_BONUS_PER;
        if (streakPts > MAX_STREAK_BONUS) streakPts = MAX_STREAK_BONUS;
        score += streakPts;

        // Age points: 1 per 100 blocks, capped at 50
        if (data.firstInteractionBlock > 0 && block.number > data.firstInteractionBlock) {
            uint256 agePts = (block.number - data.firstInteractionBlock) / AGE_DIVISOR;
            if (agePts > MAX_AGE_POINTS) agePts = MAX_AGE_POINTS;
            score += agePts;
        }

        // Liquidation penalty: -75 per liquidation
        uint256 penalty = data.liquidationCount * LIQUIDATION_PENALTY;
        if (penalty >= score - MIN_SCORE) {
            score = MIN_SCORE;
        } else {
            score -= penalty;
        }

        // Clamp to range
        if (score > MAX_SCORE) score = MAX_SCORE;
        if (score < MIN_SCORE) score = MIN_SCORE;

        return score;
    }

    function _isNewWindow(UserData memory data) internal view returns (bool) {
        return block.number >= data.lastScoreUpdateBlock + SCORE_WINDOW_BLOCKS;
    }
}
