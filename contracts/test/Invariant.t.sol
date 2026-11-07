// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {MockPriceOracle} from "../src/MockPriceOracle.sol";
import {CreditScore} from "../src/CreditScore.sol";
import {InterestModel} from "../src/InterestModel.sol";
import {LendingPool} from "../src/LendingPool.sol";

/// @title InvariantHandler — Actor that interacts with the pool for invariant testing
contract InvariantHandler is Test {
    LendingPool public pool;
    MockERC20 public usdc;
    MockERC20 public weth;
    MockPriceOracle public oracle;

    address[] public actors;
    uint256 public ghost_totalDeposited;
    uint256 public ghost_totalBorrowed;

    constructor(
        LendingPool _pool,
        MockERC20 _usdc,
        MockERC20 _weth,
        MockPriceOracle _oracle
    ) {
        pool = _pool;
        usdc = _usdc;
        weth = _weth;
        oracle = _oracle;

        // Create actors
        for (uint256 i = 1; i <= 5; i++) {
            address actor = address(uint160(i * 1000));
            actors.push(actor);
            usdc.mint(actor, 1_000_000e6);
            weth.mint(actor, 1000e18);

            vm.startPrank(actor);
            usdc.approve(address(pool), type(uint256).max);
            weth.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function depositLiquidity(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1e6, 100_000e6);

        vm.prank(actor);
        pool.depositLiquidity(amount);
        ghost_totalDeposited += amount;
    }

    function depositCollateralAndBorrow(uint256 actorSeed, uint256 colAmount, uint256 borrowAmount) external {
        address actor = actors[actorSeed % actors.length];
        colAmount = bound(colAmount, 1e18, 50e18);
        borrowAmount = bound(borrowAmount, 100e6, 5_000e6);

        // Check if there's enough liquidity
        uint256 available = pool.getAvailableLiquidity();
        if (available < borrowAmount) return;

        vm.startPrank(actor);
        pool.depositCollateral(colAmount);
        try pool.borrow(borrowAmount) {
            ghost_totalBorrowed += borrowAmount;
        } catch {}
        vm.stopPrank();
    }

    function repay(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 1e6, 10_000e6);

        vm.roll(block.number + 10);

        vm.prank(actor);
        try pool.repay(amount) {} catch {}
    }

    function advanceBlocks(uint256 blocks) external {
        blocks = bound(blocks, 1, 1000);
        vm.roll(block.number + blocks);
        pool.accrueInterest();
    }
}

/// @title InvariantTest — Tests that pool invariants hold under random operations
contract InvariantTest is Test {
    MockERC20 usdc;
    MockERC20 weth;
    MockPriceOracle oracle;
    CreditScore creditScore;
    InterestModel interestModel;
    LendingPool pool;
    InvariantHandler handler;

    function setUp() public {
        usdc = new MockERC20("Mock USDC", "mUSDC", 6);
        weth = new MockERC20("Mock WETH", "mWETH", 18);
        oracle = new MockPriceOracle(0); // No staleness for invariant testing
        oracle.setPrice(address(weth), 2000e18);
        oracle.setPrice(address(usdc), 1e18);
        creditScore = new CreditScore();
        interestModel = new InterestModel();
        pool = new LendingPool(
            address(usdc), address(weth), address(oracle),
            address(creditScore), address(interestModel)
        );
        creditScore.setLendingPool(address(pool));

        // Seed initial liquidity
        usdc.mint(address(this), 10_000_000e6);
        usdc.approve(address(pool), type(uint256).max);
        pool.depositLiquidity(5_000_000e6);

        handler = new InvariantHandler(pool, usdc, weth, oracle);

        targetContract(address(handler));
    }

    /// @notice Total deposited should always be >= total borrowed
    function invariant_SolvencyCheck() public view {
        assertTrue(
            pool.totalDeposited() >= pool.totalBorrowed(),
            "Pool must remain solvent: deposited >= borrowed"
        );
    }

    /// @notice Borrow index should only increase
    function invariant_BorrowIndexNonDecreasing() public view {
        assertTrue(
            pool.borrowIndex() >= 1e18,
            "Borrow index must never go below initial value"
        );
    }

    /// @notice Credit scores must always be within 300-850
    function invariant_ScoreBounds() public view {
        address[] memory actors = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            actors[i] = address(uint160((i + 1) * 1000));
            uint256 score = creditScore.getScore(actors[i]);
            assertTrue(score >= 300 && score <= 850, "Score must be in [300, 850]");
        }
    }

    /// @notice Pool USDC balance should account for all deposits, borrows, and reserves
    function invariant_PoolBalanceConsistency() public view {
        uint256 poolBalance = usdc.balanceOf(address(pool));
        uint256 expectedMinimum = pool.totalDeposited() - pool.totalBorrowed();
        // Pool balance should be at least the available liquidity
        // (could be more due to rounding or reserves)
        assertTrue(
            poolBalance >= expectedMinimum - 1, // allow 1 wei rounding
            "Pool balance must be >= available liquidity"
        );
    }
}
