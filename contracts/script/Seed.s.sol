// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockPriceOracle} from "../src/MockPriceOracle.sol";
import {CreditScore} from "../src/CreditScore.sol";
import {LendingPool} from "../src/LendingPool.sol";

/// @title Seed — Sets up demo state: mints tokens, adds liquidity, seeds trusted wallet
contract Seed is Script {
    function run() external {
        // Read deployed addresses
        string memory json = vm.readFile("deployments.json");
        address mUSDC = vm.parseJsonAddress(json, ".mUSDC");
        address mWETH = vm.parseJsonAddress(json, ".mWETH");
        address oracle = vm.parseJsonAddress(json, ".oracle");
        address creditScore = vm.parseJsonAddress(json, ".creditScore");
        address pool = vm.parseJsonAddress(json, ".lendingPool");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Optional: a second "trusted" wallet
        // Use TRUSTED_PRIVATE_KEY if set, otherwise use a derived address
        address trustedWallet;
        try vm.envUint("TRUSTED_PRIVATE_KEY") returns (uint256 trustedKey) {
            trustedWallet = vm.addr(trustedKey);
        } catch {
            trustedWallet = address(0xBEEF);
        }

        vm.startBroadcast(deployerPrivateKey);

        MockERC20 usdc = MockERC20(mUSDC);
        MockERC20 weth = MockERC20(mWETH);

        // 1. Mint tokens for deployer
        usdc.mint(deployer, 1_000_000e6);   // 1M USDC
        weth.mint(deployer, 1000e18);       // 1000 WETH

        // 2. Add liquidity to the pool
        usdc.approve(pool, type(uint256).max);
        LendingPool(pool).depositLiquidity(500_000e6); // 500k USDC liquidity
        console.log("Added 500,000 USDC liquidity");

        // 3. Mint tokens for trusted wallet
        usdc.mint(trustedWallet, 100_000e6);
        weth.mint(trustedWallet, 100e18);

        // 4. Seed the trusted wallet's credit score to Tier 2
        CreditScore(creditScore).demoSeedScore(
            trustedWallet,
            10,          // 10 repayments
            200_000e6,   // 200k USDC volume
            10           // 10 streak
        );
        console.log("Seeded trusted wallet:", trustedWallet);
        console.log("Trusted wallet score:", CreditScore(creditScore).getScore(trustedWallet));
        console.log("Trusted wallet tier:", CreditScore(creditScore).getTier(trustedWallet));

        // 5. Refresh oracle prices (keep them fresh)
        MockPriceOracle(oracle).setPrice(mWETH, 2000e18);
        MockPriceOracle(oracle).setPrice(mUSDC, 1e18);

        vm.stopBroadcast();

        console.log("\n=== Seed Complete ===");
        console.log("Deployer:", deployer);
        console.log("Trusted wallet:", trustedWallet);
        console.log("Pool liquidity: 500,000 USDC");
    }
}
