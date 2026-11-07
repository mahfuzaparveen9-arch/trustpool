// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockPriceOracle} from "../src/MockPriceOracle.sol";
import {CreditScore} from "../src/CreditScore.sol";
import {InterestModel} from "../src/InterestModel.sol";
import {LendingPool} from "../src/LendingPool.sol";
import {DemoSeeder} from "../src/DemoSeeder.sol";

/// @title Deploy — Deploys all TrustPool contracts
/// @notice Writes deployed addresses to deployments.json for frontend/keeper consumption
contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy tokens
        MockERC20 mUSDC = new MockERC20("Mock USDC", "mUSDC", 6);
        MockERC20 mWETH = new MockERC20("Mock WETH", "mWETH", 18);
        console.log("mUSDC deployed at:", address(mUSDC));
        console.log("mWETH deployed at:", address(mWETH));

        // 2. Deploy oracle (1 hour staleness for demos)
        MockPriceOracle oracle = new MockPriceOracle(3600);
        console.log("MockPriceOracle deployed at:", address(oracle));

        // Set initial prices: ETH = $2000, USDC = $1
        oracle.setPrice(address(mWETH), 2000e18);
        oracle.setPrice(address(mUSDC), 1e18);

        // 3. Deploy credit score
        CreditScore creditScore = new CreditScore();
        console.log("CreditScore deployed at:", address(creditScore));

        // 4. Deploy interest model
        InterestModel interestModel = new InterestModel();
        console.log("InterestModel deployed at:", address(interestModel));

        // 5. Deploy lending pool
        LendingPool pool = new LendingPool(
            address(mUSDC),
            address(mWETH),
            address(oracle),
            address(creditScore),
            address(interestModel)
        );
        console.log("LendingPool deployed at:", address(pool));

        // 6. Connect credit score to lending pool
        creditScore.setLendingPool(address(pool));

        // 7. Deploy demo seeder
        DemoSeeder seeder = new DemoSeeder(address(creditScore));
        console.log("DemoSeeder deployed at:", address(seeder));

        vm.stopBroadcast();

        // Write deployment addresses to JSON
        string memory json = string.concat(
            '{\n',
            '  "mUSDC": "', vm.toString(address(mUSDC)), '",\n',
            '  "mWETH": "', vm.toString(address(mWETH)), '",\n',
            '  "oracle": "', vm.toString(address(oracle)), '",\n',
            '  "creditScore": "', vm.toString(address(creditScore)), '",\n',
            '  "interestModel": "', vm.toString(address(interestModel)), '",\n',
            '  "lendingPool": "', vm.toString(address(pool)), '",\n',
            '  "demoSeeder": "', vm.toString(address(seeder)), '"\n',
            '}'
        );
        vm.writeFile("deployments.json", json);
        console.log("\nDeployment addresses written to deployments.json");
    }
}
