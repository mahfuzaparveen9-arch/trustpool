// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title InterestModel — Utilization-based borrow rate with per-block accrual
/// @notice Rate = base + utilization * slope. Expressed per-block.
///         A kink model: below optimal utilization, rate rises slowly;
///         above it, rate rises steeply to incentivize repayment.
///
/// Rate math:
///   utilization = totalBorrows / totalSupply (in 1e18)
///   if utilization <= OPTIMAL_UTILIZATION:
///     rate = BASE_RATE + utilization * SLOPE_1 / 1e18
///   else:
///     rate = BASE_RATE + OPTIMAL_UTILIZATION * SLOPE_1 / 1e18
///           + (utilization - OPTIMAL_UTILIZATION) * SLOPE_2 / 1e18
///
///   Per-block rate = annualRate / BLOCKS_PER_YEAR
///   Effective rate for a borrower = perBlockRate * (10000 - tierDiscount) / 10000
///
/// Constants assume ~2s block time on Base (15_768_000 blocks/year)

contract InterestModel {
    // ============ Constants ============

    uint256 public constant BLOCKS_PER_YEAR = 15_768_000; // ~2s blocks on Base

    // Rates in 1e18 per year (then divided by BLOCKS_PER_YEAR for per-block)
    uint256 public constant BASE_RATE = 0.02e18;            // 2% base annual
    uint256 public constant SLOPE_1 = 0.04e18;              // 4% slope below kink
    uint256 public constant SLOPE_2 = 0.75e18;              // 75% slope above kink
    uint256 public constant OPTIMAL_UTILIZATION = 0.8e18;   // 80% kink

    uint256 public constant BPS_BASE = 10_000;

    // ============ View Functions ============

    /// @notice Calculate the per-block borrow rate (no discount applied)
    /// @param totalSupply Total liquidity supplied
    /// @param totalBorrows Total amount borrowed
    /// @return ratePerBlock The borrow rate per block in 1e18
    function getPerBlockRate(uint256 totalSupply, uint256 totalBorrows)
        public
        pure
        returns (uint256 ratePerBlock)
    {
        if (totalSupply == 0) return BASE_RATE / BLOCKS_PER_YEAR;

        uint256 utilization = (totalBorrows * 1e18) / totalSupply;
        uint256 annualRate;

        if (utilization <= OPTIMAL_UTILIZATION) {
            annualRate = BASE_RATE + (utilization * SLOPE_1) / 1e18;
        } else {
            uint256 normalRate = BASE_RATE + (OPTIMAL_UTILIZATION * SLOPE_1) / 1e18;
            uint256 excessUtil = utilization - OPTIMAL_UTILIZATION;
            annualRate = normalRate + (excessUtil * SLOPE_2) / 1e18;
        }

        ratePerBlock = annualRate / BLOCKS_PER_YEAR;
    }

    /// @notice Calculate the effective per-block rate for a borrower with a tier discount
    /// @param totalSupply Total liquidity supplied
    /// @param totalBorrows Total amount borrowed
    /// @param rateDiscount Discount in basis points (e.g., 2500 = 25%)
    /// @return effectiveRate The discounted per-block rate in 1e18
    function getEffectiveRate(uint256 totalSupply, uint256 totalBorrows, uint256 rateDiscount)
        external
        pure
        returns (uint256 effectiveRate)
    {
        uint256 baseRate = getPerBlockRate(totalSupply, totalBorrows);
        effectiveRate = (baseRate * (BPS_BASE - rateDiscount)) / BPS_BASE;
    }

    /// @notice Get both per-block and annualized rate for display
    /// @return perBlock Rate per block in 1e18
    /// @return annualized Approximate annual rate in 1e18
    function getRates(uint256 totalSupply, uint256 totalBorrows)
        external
        pure
        returns (uint256 perBlock, uint256 annualized)
    {
        perBlock = getPerBlockRate(totalSupply, totalBorrows);
        annualized = perBlock * BLOCKS_PER_YEAR;
    }

    /// @notice Get the current utilization rate
    /// @return utilization In 1e18 (1e18 = 100%)
    function getUtilization(uint256 totalSupply, uint256 totalBorrows)
        external
        pure
        returns (uint256)
    {
        if (totalSupply == 0) return 0;
        return (totalBorrows * 1e18) / totalSupply;
    }
}
