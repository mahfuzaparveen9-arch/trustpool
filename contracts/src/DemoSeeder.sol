// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LendingPool} from "./LendingPool.sol";
import {CreditScore} from "./CreditScore.sol";

/// @title DemoSeeder — ⚠️ DEMO ONLY ⚠️
/// @notice Seeds a "trusted" wallet with credit history so judges can instantly
///         compare a new wallet (Tier 0, 150% collateral) with a trusted wallet
///         (Tier 2, 80% collateral). DO NOT deploy in production.
contract DemoSeeder {
    CreditScore public immutable creditScore;
    bool public constant IS_DEMO = true;

    /// @notice ⚠️ DEMO CONTRACT — Not for production use
    constructor(address _creditScore) {
        creditScore = CreditScore(_creditScore);
    }

    /// @notice Seed a wallet to Tier 1 (trusted) status
    /// @dev Sets 8 repayments, 10000 USDC volume, 8 streak
    function seedTier1(address wallet) external {
        creditScore.demoSeedScore(
            wallet,
            8,          // repayments
            10_000e6,   // volume (USDC)
            8           // streak
        );
    }

    /// @notice Seed a wallet to Tier 2 (prime) status
    /// @dev Sets 10 repayments, 200000 USDC volume, 10 streak
    function seedTier2(address wallet) external {
        creditScore.demoSeedScore(
            wallet,
            10,          // repayments
            200_000e6,   // volume (USDC)
            10           // streak
        );
    }
}
