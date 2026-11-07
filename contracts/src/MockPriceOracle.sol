// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceOracle} from "./IPriceOracle.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockPriceOracle — Owner-controlled price feed for demos
/// @notice For hackathon/testnet use. Owner can setPrice to simulate market moves.
///         In production, replace with a Chainlink/Pyth adapter implementing IPriceOracle.
contract MockPriceOracle is IPriceOracle, Ownable {
    struct PriceData {
        uint256 price;      // USD price in 1e18
        uint256 updatedAt;  // block.timestamp of last update
    }

    /// @notice Maximum age (seconds) before a price is considered stale
    uint256 public maxStaleness;

    /// @notice asset address => PriceData
    mapping(address => PriceData) public prices;

    error PriceNotSet(address asset);
    error PriceStale(address asset, uint256 updatedAt, uint256 maxAge);
    error InvalidPrice();

    event PriceSet(address indexed asset, uint256 price, uint256 timestamp);
    event MaxStalenessSet(uint256 maxStaleness);

    constructor(uint256 _maxStaleness) Ownable(msg.sender) {
        maxStaleness = _maxStaleness;
    }

    /// @notice Set the price of an asset (owner only, for demo)
    /// @param asset Token address
    /// @param price USD price in 1e18 (e.g., 2000e18 = $2,000)
    function setPrice(address asset, uint256 price) external onlyOwner {
        if (price == 0) revert InvalidPrice();
        prices[asset] = PriceData({price: price, updatedAt: block.timestamp});
        emit PriceSet(asset, price, block.timestamp);
    }

    /// @notice Update staleness threshold
    function setMaxStaleness(uint256 _maxStaleness) external onlyOwner {
        maxStaleness = _maxStaleness;
        emit MaxStalenessSet(_maxStaleness);
    }

    /// @inheritdoc IPriceOracle
    function getPrice(address asset) external view override returns (uint256, uint256) {
        PriceData memory data = prices[asset];
        if (data.updatedAt == 0) revert PriceNotSet(asset);
        if (maxStaleness > 0 && block.timestamp - data.updatedAt > maxStaleness) {
            revert PriceStale(asset, data.updatedAt, maxStaleness);
        }
        return (data.price, data.updatedAt);
    }

    /// @inheritdoc IPriceOracle
    function hasFreshPrice(address asset) external view override returns (bool) {
        PriceData memory data = prices[asset];
        if (data.updatedAt == 0) return false;
        if (maxStaleness > 0 && block.timestamp - data.updatedAt > maxStaleness) return false;
        return true;
    }
}
