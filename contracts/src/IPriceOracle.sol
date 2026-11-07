// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPriceOracle — Interface for price feeds
/// @notice Returns USD price with 18 decimals. Drop-in replaceable with Chainlink/Pyth adapters.
interface IPriceOracle {
    /// @notice Get the USD price of an asset
    /// @param asset The token address
    /// @return price USD price with 18 decimals (1e18 = $1.00)
    /// @return updatedAt Timestamp of the last update
    function getPrice(address asset) external view returns (uint256 price, uint256 updatedAt);

    /// @notice Check if a price feed exists and is fresh
    /// @param asset The token address
    /// @return True if the price is available and not stale
    function hasFreshPrice(address asset) external view returns (bool);
}
