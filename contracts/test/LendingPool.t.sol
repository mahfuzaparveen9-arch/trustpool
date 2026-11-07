// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockPriceOracle} from "../src/MockPriceOracle.sol";
import {CreditScore} from "../src/CreditScore.sol";
import {InterestModel} from "../src/InterestModel.sol";
import {LendingPool} from "../src/LendingPool.sol";

/// @title LendingPoolTest — Comprehensive unit, scenario, fuzz, and integration tests
contract LendingPoolTest is Test {
    MockERC20 usdc;
    MockERC20 weth;
    MockPriceOracle oracle;
    CreditScore creditScore;
    InterestModel interestModel;
    LendingPool pool;

    address deployer = address(this);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address charlie = address(0xC0C);
    address liquidator = address(0x1111);

    function setUp() public {
        // Deploy tokens
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        weth = new MockERC20("Mock WETH", "mWETH", 18);

        // Deploy oracle with 1 hour staleness
        oracle = new MockPriceOracle(3600);
        oracle.setPrice(address(weth), 2000e18); // ETH = $2000
        oracle.setPrice(address(usdc), 1e18);    // USDC = $1

        // Deploy credit score
        creditScore = new CreditScore();

        // Deploy interest model
        interestModel = new InterestModel();

        // Deploy lending pool
        pool = new LendingPool(
            address(usdc),
            address(weth),
            address(oracle),
            address(creditScore),
            address(interestModel)
        );

        // Wire credit score to pool
        creditScore.setLendingPool(address(pool));

        // Fund accounts
        usdc.mint(deployer, 1_000_000e6);
        usdc.mint(alice, 100_000e6);
        usdc.mint(bob, 100_000e6);
        usdc.mint(liquidator, 100_000e6);
        weth.mint(alice, 100e18);
        weth.mint(bob, 100e18);

        // Deployer adds liquidity
        usdc.approve(address(pool), type(uint256).max);
        pool.depositLiquidity(500_000e6);

        // Approve for alice and bob
        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        weth.approve(address(pool), type(uint256).max);

        vm.prank(bob);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        weth.approve(address(pool), type(uint256).max);

        vm.prank(liquidator);
        usdc.approve(address(pool), type(uint256).max);
    }

    // ============ MockERC20 Tests ============

    function test_MockERC20_Faucet() public {
        uint256 balBefore = usdc.balanceOf(charlie);
        vm.prank(charlie);
        usdc.faucet();
        assertEq(usdc.balanceOf(charlie) - balBefore, 1000e6);
    }

    function test_MockERC20_Decimals() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(weth.decimals(), 18);
    }

    // ============ Oracle Tests ============

    function test_Oracle_GetPrice() public view {
        (uint256 price, ) = oracle.getPrice(address(weth));
        assertEq(price, 2000e18);
    }

    function test_Oracle_Revert_NotSet() public {
        vm.expectRevert(abi.encodeWithSelector(MockPriceOracle.PriceNotSet.selector, address(0xDEAD)));
        oracle.getPrice(address(0xDEAD));
    }

    function test_Oracle_Revert_Stale() public {
        oracle.setPrice(address(weth), 2000e18);
        vm.warp(block.timestamp + 3601); // Exceed staleness
        vm.expectRevert();
        oracle.getPrice(address(weth));
    }

    function test_Oracle_SetPrice_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        oracle.setPrice(address(weth), 1000e18);
    }

    // ============ Credit Score Tests ============

    function test_CreditScore_InitialScore() public view {
        assertEq(creditScore.getScore(alice), 300);
        assertEq(creditScore.getTier(alice), 0);
    }

    function test_CreditScore_Tier0Terms() public view {
        (uint256 col, uint256 liq, uint256 disc, uint256 cap) = creditScore.getTermsForTier(0);
        assertEq(col, 1.5e18);
        assertEq(liq, 1.25e18);
        assertEq(disc, 0);
        assertEq(cap, 5_000e6);
    }

    function test_CreditScore_Tier1Terms() public view {
        (uint256 col, uint256 liq, uint256 disc, uint256 cap) = creditScore.getTermsForTier(1);
        assertEq(col, 1.2e18);
        assertEq(liq, 1.05e18);
        assertEq(disc, 1000);
        assertEq(cap, 25_000e6);
    }

    function test_CreditScore_Tier2Terms() public view {
        (uint256 col, uint256 liq, uint256 disc, uint256 cap) = creditScore.getTermsForTier(2);
        assertEq(col, 0.8e18);
        assertEq(liq, 0.65e18);
        assertEq(disc, 2500);
        assertEq(cap, 100_000e6);
    }

    function test_CreditScore_DemoSeed() public {
        creditScore.demoSeedScore(alice, 10, 200_000e6, 10);
        uint256 score = creditScore.getScore(alice);
        assertTrue(score >= 650, "Should be tier 2");
        assertEq(creditScore.getTier(alice), 2);
    }

    function test_CreditScore_OnlyPool() public {
        vm.prank(alice);
        vm.expectRevert(CreditScore.OnlyLendingPool.selector);
        creditScore.recordRepayment(alice, 1000e6, 100, 1000e6);
    }

    // ============ Interest Model Tests ============

    function test_InterestModel_BaseRate() public view {
        uint256 rate = interestModel.getPerBlockRate(1000e6, 0);
        uint256 annual = rate * interestModel.BLOCKS_PER_YEAR();
        // Should be ~2% with 0 utilization
        assertApproxEqRel(annual, 0.02e18, 0.01e18); // within 1%
    }

    function test_InterestModel_HighUtilization() public view {
        // 90% utilization (above kink)
        uint256 rate = interestModel.getPerBlockRate(1000e6, 900e6);
        uint256 annual = rate * interestModel.BLOCKS_PER_YEAR();
        // Should be much higher than base
        assertTrue(annual > 0.05e18, "Rate should spike above kink");
    }

    function test_InterestModel_Discount() public view {
        uint256 base = interestModel.getPerBlockRate(1000e6, 500e6);
        uint256 discounted = interestModel.getEffectiveRate(1000e6, 500e6, 2500); // 25%
        assertEq(discounted, (base * 7500) / 10000);
    }

    // ============ Liquidity Pool Tests ============

    function test_DepositLiquidity() public {
        uint256 sharesBefore = pool.shares(deployer);
        pool.depositLiquidity(10_000e6);
        assertTrue(pool.shares(deployer) > sharesBefore);
        assertEq(pool.totalDeposited(), 510_000e6);
    }

    function test_WithdrawLiquidity() public {
        uint256 myShares = pool.shares(deployer);
        uint256 halfShares = myShares / 2;
        pool.withdrawLiquidity(halfShares);
        assertEq(pool.shares(deployer), myShares - halfShares);
    }

    function test_Revert_WithdrawTooMany() public {
        uint256 myShares = pool.shares(deployer);
        vm.expectRevert(LendingPool.InsufficientShares.selector);
        pool.withdrawLiquidity(myShares + 1);
    }

    // ============ Borrow/Repay Tests ============

    function test_DepositCollateral() public {
        vm.prank(alice);
        pool.depositCollateral(10e18); // 10 ETH
        (uint256 collateral, , , , , , ) = pool.getPosition(alice);
        assertEq(collateral, 10e18);
    }

    function test_Borrow_Tier0() public {
        // Alice deposits 10 ETH ($20,000) and borrows USDC at Tier 0 (150% collateral)
        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        // Max borrow at 150%: $20,000 / 1.5 = $13,333, but cap is $5,000
        pool.borrow(5_000e6);
        vm.stopPrank();

        (, , uint256 debt, , uint256 tier, , ) = pool.getPosition(alice);
        assertEq(debt, 5_000e6);
        assertEq(tier, 0);
    }

    function test_Revert_BorrowOverCap() public {
        vm.startPrank(alice);
        pool.depositCollateral(50e18); // $100,000 collateral
        vm.expectRevert(LendingPool.ExceedsBorrowCap.selector);
        pool.borrow(5_001e6); // Over tier 0 cap of $5000
        vm.stopPrank();
    }

    function test_Revert_BorrowInsufficientCollateral() public {
        vm.startPrank(alice);
        pool.depositCollateral(1e18); // $2000
        vm.expectRevert(LendingPool.InsufficientCollateral.selector);
        pool.borrow(2_000e6); // Need $3000 collateral at 150%
        vm.stopPrank();
    }

    function test_Repay_Full() public {
        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(1_000e6);

        // Advance blocks for interest and sybil check
        vm.roll(block.number + 100);

        pool.repay(type(uint256).max); // Full repay
        vm.stopPrank();

        (, , uint256 debt, , , , ) = pool.getPosition(alice);
        assertEq(debt, 0);
    }

    function test_Repay_Partial() public {
        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(2_000e6);

        pool.repay(500e6); // Partial
        vm.stopPrank();

        (, , uint256 debt, , , , ) = pool.getPosition(alice);
        assertTrue(debt > 0);
        assertTrue(debt < 2_000e6); // Should be less after partial repay
    }

    function test_WithdrawCollateral_Healthy() public {
        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(1_000e6); // Small borrow

        // Should be able to withdraw some collateral while staying healthy
        pool.withdrawCollateral(5e18);
        vm.stopPrank();

        (uint256 col, , , , , , ) = pool.getPosition(alice);
        assertEq(col, 5e18);
    }

    function test_Revert_WithdrawCollateral_Unhealthy() public {
        vm.startPrank(alice);
        pool.depositCollateral(5e18); // $10,000
        pool.borrow(5_000e6);         // At 150%, need $7,500 collateral

        vm.expectRevert(LendingPool.PositionUnhealthy.selector);
        pool.withdrawCollateral(4e18); // Would leave only $2,000 < $7,500
        vm.stopPrank();
    }

    // ============ Interest Accrual Tests ============

    function test_InterestAccrues() public {
        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(1_000e6);
        vm.stopPrank();

        uint256 debtBefore;
        (, , debtBefore, , , , ) = pool.getPosition(alice);

        // Advance 1000 blocks
        vm.roll(block.number + 1000);

        uint256 debtAfter;
        (, , debtAfter, , , , ) = pool.getPosition(alice);

        assertTrue(debtAfter > debtBefore, "Debt should increase with interest");
    }

    function test_SharesAppreciate() public {
        // Alice borrows, time passes, shares should be worth more
        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(1_000e6);
        vm.stopPrank();

        uint256 balBefore = pool.getLenderBalance(deployer);

        vm.roll(block.number + 10000);
        pool.accrueInterest(); // Force accrual

        uint256 balAfter = pool.getLenderBalance(deployer);
        assertTrue(balAfter > balBefore, "Lender balance should grow from interest");
    }

    // ============ Liquidation Tests ============

    function test_Liquidation() public {
        // Alice borrows at Tier 0 (150% collateral, 125% liquidation)
        vm.startPrank(alice);
        pool.depositCollateral(4e18); // $8,000
        pool.borrow(4_000e6);         // Need $6,000 collateral at 150%. Have $8,000. OK.
        vm.stopPrank();

        // Crash ETH price to $1,200 => collateral = $4,800
        // Debt = $4,000, liquidation ratio = 125% => need $5,000 in collateral
        // $4,800 < $5,000 => health factor < 1
        oracle.setPrice(address(weth), 1200e18);

        // Check health factor
        uint256 hf = pool.getHealthFactor(alice);
        assertTrue(hf < 1e18, "Position should be unhealthy");

        // Liquidator repays part of Alice's debt
        vm.prank(liquidator);
        pool.liquidate(alice, 2_000e6);

        // Alice's debt should be reduced
        (, , uint256 debt, , , , ) = pool.getPosition(alice);
        assertTrue(debt < 4_000e6, "Debt should decrease after liquidation");

        // Alice's score should have a liquidation penalty
        uint256 score = creditScore.getScore(alice);
        // Score was 300, liquidation penalty is 75, but can't go below 300
        assertEq(score, 300);
    }

    function test_Revert_LiquidateHealthy() public {
        vm.startPrank(alice);
        pool.depositCollateral(10e18); // Plenty of collateral
        pool.borrow(1_000e6);
        vm.stopPrank();

        vm.prank(liquidator);
        vm.expectRevert(LendingPool.PositionHealthy.selector);
        pool.liquidate(alice, 500e6);
    }

    // ============ Scenario Tests ============

    /// @notice Scenario: New wallet borrows at 150%, repays several times, moves to Tier 1
    function test_Scenario_TierProgression() public {
        // Alice starts at Tier 0
        assertEq(creditScore.getTier(alice), 0);

        // Do multiple borrow-repay cycles with qualifying loans
        for (uint256 i = 0; i < 8; i++) {
            vm.startPrank(alice);
            pool.depositCollateral(1e18);
            pool.borrow(500e6); // Above MIN_LOAN_AMOUNT (100 USDC)

            vm.roll(block.number + 100); // Above MIN_LOAN_BLOCKS (50)

            pool.repay(type(uint256).max);
            pool.withdrawCollateral(1e18);
            vm.stopPrank();
        }

        // After 8 qualifying repayments, score should be high enough for Tier 1
        uint256 score = creditScore.getScore(alice);
        assertTrue(score >= 450, "Score should qualify for Tier 1");
        assertEq(creditScore.getTier(alice), 1);

        // Now Alice should get 120% collateral ratio
        (uint256 col, , , ) = creditScore.getTerms(alice);
        assertEq(col, 1.2e18);
    }

    /// @notice Scenario: Sybil farming — rapid borrow/repay in same block does NOT raise score
    function test_Scenario_SybilResistance() public {
        uint256 scoreBefore = creditScore.getScore(alice);

        // Rapid borrow-repay in same block (no block advancement)
        for (uint256 i = 0; i < 10; i++) {
            vm.startPrank(alice);
            pool.depositCollateral(1e18);
            pool.borrow(500e6);
            pool.repay(type(uint256).max);
            pool.withdrawCollateral(1e18);
            vm.stopPrank();
        }

        uint256 scoreAfter = creditScore.getScore(alice);
        assertEq(scoreAfter, scoreBefore, "Score should NOT increase from sybil farming");
    }

    /// @notice Scenario: Small loans below MIN_LOAN_AMOUNT don't build score
    function test_Scenario_SmallLoanNoCredit() public {
        uint256 scoreBefore = creditScore.getScore(alice);

        vm.startPrank(alice);
        pool.depositCollateral(1e18);
        pool.borrow(50e6); // Below MIN_LOAN_AMOUNT (100 USDC)
        vm.roll(block.number + 100);
        pool.repay(type(uint256).max);
        vm.stopPrank();

        uint256 scoreAfter = creditScore.getScore(alice);
        // Score should not increase (ignoring age points)
        // Age points might add 1 point for 100 blocks, but repayment shouldn't count
        assertTrue(scoreAfter <= scoreBefore + 1, "Score should barely change for small loans");
    }

    /// @notice Scenario: Price crash triggers liquidation
    function test_Scenario_PriceCrashLiquidation() public {
        vm.startPrank(alice);
        pool.depositCollateral(5e18);  // $10,000 at $2000/ETH
        pool.borrow(5_000e6);          // $5,000 USDC
        vm.stopPrank();

        // Health factor should be healthy
        uint256 hf = pool.getHealthFactor(alice);
        assertTrue(hf >= 1e18);

        // Crash: ETH drops 50% to $1,000
        oracle.setPrice(address(weth), 1000e18);
        // Collateral = $5,000, debt = $5,000, liq ratio 125%
        // Need $6,250 collateral => unhealthy

        hf = pool.getHealthFactor(alice);
        assertTrue(hf < 1e18, "Should be unhealthy after crash");

        // Anyone can liquidate
        vm.prank(liquidator);
        pool.liquidate(alice, 3_000e6);

        // Verify liquidator received collateral with bounty
        assertTrue(weth.balanceOf(liquidator) > 0, "Liquidator should receive collateral");
    }

    // ============ Edge Case Tests ============

    function test_Revert_ZeroDeposit() public {
        vm.expectRevert(LendingPool.ZeroAmount.selector);
        pool.depositLiquidity(0);
    }

    function test_Revert_ZeroCollateral() public {
        vm.prank(alice);
        vm.expectRevert(LendingPool.ZeroAmount.selector);
        pool.depositCollateral(0);
    }

    function test_Revert_BorrowNoCollateral() public {
        vm.prank(alice);
        vm.expectRevert(LendingPool.InsufficientCollateral.selector);
        pool.borrow(100e6);
    }

    function test_Revert_RepayNoDebt() public {
        vm.prank(alice);
        vm.expectRevert(LendingPool.NoDebt.selector);
        pool.repay(100e6);
    }

    function test_Revert_WithdrawInsufficientCollateral() public {
        vm.prank(alice);
        vm.expectRevert(LendingPool.InsufficientCollateral.selector);
        pool.withdrawCollateral(1e18);
    }

    function test_BorrowerTracking() public {
        assertEq(pool.getBorrowerCount(), 0);

        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(1_000e6);
        vm.stopPrank();

        assertEq(pool.getBorrowerCount(), 1);
        assertEq(pool.getBorrower(0), alice);
    }

    function test_AvailableLiquidity() public view {
        assertEq(pool.getAvailableLiquidity(), 500_000e6);
    }

    function test_CurrentRates() public view {
        (uint256 perBlock, uint256 annual, uint256 util) = pool.getCurrentRates();
        assertTrue(perBlock > 0);
        assertTrue(annual > 0);
        assertEq(util, 0); // No borrows yet
    }

    // ============ Fuzz Tests ============

    function testFuzz_DepositWithdrawLiquidity(uint256 amount) public {
        amount = bound(amount, 1, 100_000e6);
        usdc.mint(alice, amount);

        vm.startPrank(alice);
        usdc.approve(address(pool), amount);
        pool.depositLiquidity(amount);

        uint256 aliceShares = pool.shares(alice);
        assertTrue(aliceShares > 0);

        pool.withdrawLiquidity(aliceShares);
        vm.stopPrank();

        // Should get approximately the same amount back (may lose 1 wei to rounding)
        // The pool has other depositors so the share ratio matters
    }

    function testFuzz_BorrowRepay(uint256 borrowAmount) public {
        borrowAmount = bound(borrowAmount, 1e6, 5_000e6); // Within tier 0 cap

        vm.startPrank(alice);
        pool.depositCollateral(10e18); // $20,000 collateral

        pool.borrow(borrowAmount);

        vm.roll(block.number + 10);

        // Get actual debt
        (, , uint256 debt, , , , ) = pool.getPosition(alice);

        // Mint enough to cover debt + interest
        usdc.mint(alice, debt);
        usdc.approve(address(pool), type(uint256).max);

        pool.repay(type(uint256).max);
        vm.stopPrank();

        (, , uint256 remainingDebt, , , , ) = pool.getPosition(alice);
        assertEq(remainingDebt, 0, "Should have no debt after full repay");
    }

    function testFuzz_PriceChanges(uint256 newPrice) public {
        newPrice = bound(newPrice, 100e18, 10_000e18); // $100 - $10,000

        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(1_000e6);
        vm.stopPrank();

        oracle.setPrice(address(weth), newPrice);

        uint256 hf = pool.getHealthFactor(alice);
        // Health factor should scale with price
        // At $125/ETH: 10 ETH = $1250 collateral, $1000 debt * 1.25 liq ratio = $1250 needed
        // So at prices below ~$125, position becomes unhealthy
        if (newPrice <= 120e18) {
            assertTrue(hf < 1e18, "Should be unhealthy at very low price");
        }
    }

    function testFuzz_InterestAccrual(uint256 blocks) public {
        blocks = bound(blocks, 1, 1_000_000);

        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(1_000e6);
        vm.stopPrank();

        uint256 debtBefore;
        (, , debtBefore, , , , ) = pool.getPosition(alice);

        vm.roll(block.number + blocks);

        uint256 debtAfter;
        (, , debtAfter, , , , ) = pool.getPosition(alice);

        assertTrue(debtAfter >= debtBefore, "Debt should never decrease without repayment");
    }

    // ============ Score Bounds Test ============

    function test_ScoreAlwaysInBounds() public {
        // Test that score never goes below 300 even with liquidations
        vm.startPrank(alice);
        pool.depositCollateral(10e18);
        pool.borrow(4_000e6);
        vm.stopPrank();

        // Force multiple liquidations
        for (uint256 i = 0; i < 5; i++) {
            oracle.setPrice(address(weth), 1000e18); // Crash
            vm.prank(liquidator);
            try pool.liquidate(alice, 500e6) {} catch {}
            oracle.setPrice(address(weth), 2000e18); // Restore
        }

        uint256 score = creditScore.getScore(alice);
        assertTrue(score >= 300, "Score should never go below 300");
        assertTrue(score <= 850, "Score should never exceed 850");
    }
}
