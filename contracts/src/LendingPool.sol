// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceOracle} from "./IPriceOracle.sol";
import {CreditScore} from "./CreditScore.sol";
import {InterestModel} from "./InterestModel.sol";

/// @title LendingPool — Core lending/borrowing pool with onchain credit scoring
/// @notice Lenders supply USDC liquidity (share-based). Borrowers deposit WETH collateral
///         and borrow USDC. Interest accrues per-block via a borrowIndex.
///         Credit score determines collateral requirements and rate discounts.
///         Anyone can liquidate unhealthy positions for a bounty.
///
/// Key mechanics:
///   - Share-based liquidity: 1 share represents a growing amount of USDC as interest accrues
///   - borrowIndex: grows every block. User debt = borrowAmount * currentIndex / userIndex
///   - Health factor = collateralValue / (debt * liquidationRatio). < 1e18 means liquidatable
///   - Reserve factor: 10% of interest goes to treasury
///   - Liquidation bounty: 5% of repaid amount in collateral

contract LendingPool is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Immutables ============

    IERC20 public immutable usdc;          // Borrow/lend token (6 decimals)
    IERC20 public immutable weth;          // Collateral token (18 decimals)
    IPriceOracle public immutable oracle;
    CreditScore public immutable creditScore;
    InterestModel public immutable interestModel;

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_BASE = 10_000;
    uint256 public constant RESERVE_FACTOR = 1_000;     // 10% of interest to treasury
    uint256 public constant LIQUIDATION_BOUNTY = 500;    // 5% bonus collateral
    uint256 public constant INITIAL_BORROW_INDEX = 1e18;
    uint256 public constant USDC_DECIMALS = 6;
    uint256 public constant WETH_DECIMALS = 18;

    // ============ State: Liquidity Pool ============

    uint256 public totalShares;            // Total LP shares
    uint256 public totalDeposited;         // Total USDC deposited (available + borrowed)
    uint256 public totalBorrowed;          // Total USDC currently borrowed

    mapping(address => uint256) public shares; // LP shares per lender

    // ============ State: Borrow Accounting ============

    uint256 public borrowIndex;            // Global borrow index (1e18 scale)
    uint256 public lastAccrualBlock;       // Last block interest was accrued

    uint256 public totalReserves;          // Protocol reserves from interest

    struct Position {
        uint256 collateralAmount;   // WETH deposited (18 decimals)
        uint256 borrowAmount;       // USDC debt at time of borrow (6 decimals, in index-adjusted terms)
        uint256 borrowIndex;        // Index at time of borrow (for debt calculation)
        uint256 borrowBlock;        // Block when loan was opened
        uint256 originalBorrowAmount; // For credit score tracking
    }

    mapping(address => Position) public positions;

    // Track all borrowers for keeper/liquidation enumeration
    address[] public borrowerList;
    mapping(address => bool) public isBorrower;

    // ============ Events ============

    event LiquidityDeposited(address indexed lender, uint256 amount, uint256 sharesMinted);
    event LiquidityWithdrawn(address indexed lender, uint256 amount, uint256 sharesBurned);
    event CollateralDeposited(address indexed borrower, uint256 amount);
    event CollateralWithdrawn(address indexed borrower, uint256 amount);
    event Borrowed(address indexed borrower, uint256 amount, uint256 tier, uint256 collateralRatio);
    event Repaid(address indexed borrower, uint256 amount, bool fullRepayment);
    event Liquidated(
        address indexed borrower,
        address indexed liquidator,
        uint256 debtRepaid,
        uint256 collateralSeized,
        uint256 bounty
    );
    event InterestAccrued(uint256 blockNumber, uint256 newBorrowIndex, uint256 interestAmount, uint256 reserveAmount);
    event ReservesWithdrawn(address indexed to, uint256 amount);

    // ============ Errors ============

    error ZeroAmount();
    error InsufficientLiquidity();
    error InsufficientShares();
    error InsufficientCollateral();
    error ExceedsBorrowCap();
    error PositionUnhealthy();
    error PositionHealthy();
    error NoDebt();
    error NoBorrow();
    error RepayExceedsDebt();
    error OracleStale();

    // ============ Constructor ============

    constructor(
        address _usdc,
        address _weth,
        address _oracle,
        address _creditScore,
        address _interestModel
    ) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        weth = IERC20(_weth);
        oracle = IPriceOracle(_oracle);
        creditScore = CreditScore(_creditScore);
        interestModel = InterestModel(_interestModel);
        borrowIndex = INITIAL_BORROW_INDEX;
        lastAccrualBlock = block.number;
    }

    // ============ Interest Accrual ============

    /// @notice Accrue interest up to the current block. Called before any state-changing operation.
    function accrueInterest() public {
        if (block.number <= lastAccrualBlock) return;
        if (totalBorrowed == 0) {
            lastAccrualBlock = block.number;
            return;
        }

        uint256 blocksElapsed = block.number - lastAccrualBlock;
        uint256 ratePerBlock = interestModel.getPerBlockRate(
            totalDeposited,  // total supply = available + borrowed
            totalBorrowed
        );

        // interest = totalBorrowed * ratePerBlock * blocksElapsed / 1e18
        uint256 interest = (totalBorrowed * ratePerBlock * blocksElapsed) / PRECISION;

        // Update borrow index: newIndex = oldIndex * (1 + ratePerBlock * blocks)
        borrowIndex = borrowIndex + (borrowIndex * ratePerBlock * blocksElapsed) / PRECISION;

        // Reserve portion
        uint256 reserveAmount = (interest * RESERVE_FACTOR) / BPS_BASE;

        totalBorrowed += interest;
        totalDeposited += interest; // Interest goes to lenders (via share appreciation)
        totalReserves += reserveAmount;

        lastAccrualBlock = block.number;

        emit InterestAccrued(block.number, borrowIndex, interest, reserveAmount);
    }

    // ============ Lender Functions ============

    /// @notice Deposit USDC as liquidity. Receive shares proportional to pool.
    /// @param amount Amount of USDC to deposit (6 decimals)
    function depositLiquidity(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        accrueInterest();

        uint256 sharesToMint;
        if (totalShares == 0 || totalDeposited == 0) {
            sharesToMint = amount; // 1:1 on first deposit
        } else {
            // shares = amount * totalShares / totalDeposited
            sharesToMint = (amount * totalShares) / totalDeposited;
        }

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        totalShares += sharesToMint;
        totalDeposited += amount;
        shares[msg.sender] += sharesToMint;

        emit LiquidityDeposited(msg.sender, amount, sharesToMint);
    }

    /// @notice Withdraw USDC by burning shares
    /// @param shareAmount Number of shares to burn
    function withdrawLiquidity(uint256 shareAmount) external nonReentrant {
        if (shareAmount == 0) revert ZeroAmount();
        if (shares[msg.sender] < shareAmount) revert InsufficientShares();
        accrueInterest();

        // amount = shareAmount * totalDeposited / totalShares
        uint256 amount = (shareAmount * totalDeposited) / totalShares;

        uint256 available = totalDeposited - totalBorrowed;
        if (amount > available) revert InsufficientLiquidity();

        shares[msg.sender] -= shareAmount;
        totalShares -= shareAmount;
        totalDeposited -= amount;

        usdc.safeTransfer(msg.sender, amount);

        emit LiquidityWithdrawn(msg.sender, amount, shareAmount);
    }

    /// @notice Get the USDC value of a lender's shares
    function getLenderBalance(address lender) external view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares[lender] * totalDeposited) / totalShares;
    }

    // ============ Borrower Functions ============

    /// @notice Deposit WETH as collateral
    /// @param amount Amount of WETH (18 decimals)
    function depositCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        accrueInterest();

        // Initialize user in credit score system
        creditScore.initUser(msg.sender);

        weth.safeTransferFrom(msg.sender, address(this), amount);
        positions[msg.sender].collateralAmount += amount;

        emit CollateralDeposited(msg.sender, amount);
    }

    /// @notice Withdraw collateral (only if position stays healthy)
    /// @param amount Amount of WETH to withdraw
    function withdrawCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        accrueInterest();

        Position storage pos = positions[msg.sender];
        if (pos.collateralAmount < amount) revert InsufficientCollateral();

        // Temporarily reduce collateral and check health
        pos.collateralAmount -= amount;

        // If user has debt, ensure position remains healthy
        if (pos.borrowAmount > 0) {
            uint256 hf = _healthFactor(msg.sender);
            if (hf < PRECISION) {
                pos.collateralAmount += amount; // Revert the change
                revert PositionUnhealthy();
            }
        }

        weth.safeTransfer(msg.sender, amount);

        emit CollateralWithdrawn(msg.sender, amount);
    }

    /// @notice Borrow USDC against deposited collateral
    /// @param amount Amount of USDC to borrow (6 decimals)
    function borrow(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        accrueInterest();

        // Get user's credit terms
        (uint256 collateralRatio, , , uint256 maxBorrow) = creditScore.getTerms(msg.sender);
        uint256 tier = creditScore.getTier(msg.sender);

        Position storage pos = positions[msg.sender];

        // Calculate current debt
        uint256 currentDebt = _getUserDebt(msg.sender);
        uint256 newTotalDebt = currentDebt + amount;

        // Check borrow cap
        if (newTotalDebt > maxBorrow) revert ExceedsBorrowCap();

        // Check collateral sufficiency
        uint256 collateralValue = _getCollateralValueUSD(pos.collateralAmount);
        // debtValue in USD: amount has 6 decimals, convert to 18
        uint256 debtValueUSD = newTotalDebt * 1e12; // 6 -> 18 decimals
        uint256 requiredCollateral = (debtValueUSD * collateralRatio) / PRECISION;

        if (collateralValue < requiredCollateral) revert InsufficientCollateral();

        // Check liquidity
        uint256 available = totalDeposited - totalBorrowed;
        if (amount > available) revert InsufficientLiquidity();

        // Update position
        if (pos.borrowAmount == 0) {
            // New borrow
            pos.borrowIndex = borrowIndex;
            pos.borrowBlock = block.number;
            pos.originalBorrowAmount = amount;
        } else {
            // Additional borrow: normalize existing debt to current index
            // Normalize existing debt to current index (computed via _getUserDebt above)
            // Actually we need to convert existing debt to current index terms
            // currentDebt = pos.borrowAmount * borrowIndex / pos.borrowIndex
            // new borrowAmount at current index = currentDebt + amount
            // But we store in "index units": borrowAmount = realDebt * PRECISION / borrowIndex
            pos.borrowAmount = (currentDebt * PRECISION) / borrowIndex;
            pos.borrowIndex = borrowIndex;
            pos.originalBorrowAmount += amount;
        }

        pos.borrowAmount += (amount * PRECISION) / borrowIndex;
        totalBorrowed += amount;

        // Track borrower
        if (!isBorrower[msg.sender]) {
            borrowerList.push(msg.sender);
            isBorrower[msg.sender] = true;
        }

        usdc.safeTransfer(msg.sender, amount);

        // Apply tier discount info in event
        emit Borrowed(msg.sender, amount, tier, collateralRatio);
    }

    /// @notice Repay USDC debt (partial or full)
    /// @param amount Amount to repay (6 decimals). Pass type(uint256).max for full repay.
    function repay(uint256 amount) external nonReentrant {
        accrueInterest();

        Position storage pos = positions[msg.sender];
        if (pos.borrowAmount == 0) revert NoDebt();

        uint256 currentDebt = _getUserDebt(msg.sender);
        bool fullRepayment = false;

        if (amount >= currentDebt || amount == type(uint256).max) {
            amount = currentDebt;
            fullRepayment = true;
        }

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        if (fullRepayment) {
            // Record repayment for credit scoring
            uint256 loanOpenBlocks = block.number - pos.borrowBlock;
            creditScore.recordRepayment(
                msg.sender,
                amount,
                loanOpenBlocks,
                pos.originalBorrowAmount
            );

            // Clear position
            totalBorrowed -= currentDebt;
            pos.borrowAmount = 0;
            pos.borrowIndex = 0;
            pos.borrowBlock = 0;
            pos.originalBorrowAmount = 0;
        } else {
            // Partial repayment: reduce borrowAmount in index units
            uint256 indexUnitsRepaid = (amount * PRECISION) / borrowIndex;
            pos.borrowAmount -= indexUnitsRepaid;
            totalBorrowed -= amount;
        }

        emit Repaid(msg.sender, amount, fullRepayment);
    }

    // ============ Liquidation ============

    /// @notice Liquidate an unhealthy position. Anyone can call this.
    /// @param borrower The borrower to liquidate
    /// @param repayAmount Amount of USDC to repay on behalf of borrower
    function liquidate(address borrower, uint256 repayAmount) external nonReentrant {
        accrueInterest();

        Position storage pos = positions[borrower];
        if (pos.borrowAmount == 0) revert NoDebt();

        uint256 hf = _healthFactor(borrower);
        if (hf >= PRECISION) revert PositionHealthy();

        uint256 currentDebt = _getUserDebt(borrower);
        if (repayAmount > currentDebt) {
            repayAmount = currentDebt;
        }

        // Transfer USDC from liquidator
        usdc.safeTransferFrom(msg.sender, address(this), repayAmount);

        // Calculate collateral to seize
        // repayValueUSD = repayAmount * 1e12 (6->18 decimals)
        // collateralToSeize = repayValueUSD * (1 + BOUNTY) / ethPrice
        (uint256 ethPrice, ) = oracle.getPrice(address(weth));
        uint256 repayValueUSD = repayAmount * 1e12;
        uint256 collateralToSeize = (repayValueUSD * PRECISION) / ethPrice;
        uint256 bounty = (collateralToSeize * LIQUIDATION_BOUNTY) / BPS_BASE;
        uint256 totalSeized = collateralToSeize + bounty;

        // Cap at available collateral
        if (totalSeized > pos.collateralAmount) {
            totalSeized = pos.collateralAmount;
            bounty = totalSeized > collateralToSeize ? totalSeized - collateralToSeize : 0;
        }

        // Update state
        pos.collateralAmount -= totalSeized;

        if (repayAmount >= currentDebt) {
            totalBorrowed -= currentDebt;
            pos.borrowAmount = 0;
            pos.borrowIndex = 0;
            pos.borrowBlock = 0;
            pos.originalBorrowAmount = 0;
        } else {
            uint256 indexUnitsRepaid = (repayAmount * PRECISION) / borrowIndex;
            pos.borrowAmount -= indexUnitsRepaid;
            totalBorrowed -= repayAmount;
        }

        // Record liquidation in credit score (penalty)
        creditScore.recordLiquidation(borrower);

        // Transfer collateral + bounty to liquidator
        weth.safeTransfer(msg.sender, totalSeized);

        emit Liquidated(borrower, msg.sender, repayAmount, collateralToSeize, bounty);
    }

    // ============ View Functions ============

    /// @notice Get the full position details for a user
    function getPosition(address user)
        external
        view
        returns (
            uint256 collateralAmount,
            uint256 collateralValueUSD,
            uint256 debtAmount,
            uint256 healthFactor,
            uint256 tier,
            uint256 ratePerBlock,
            uint256 annualRate
        )
    {
        Position memory pos = positions[user];
        collateralAmount = pos.collateralAmount;
        collateralValueUSD = _getCollateralValueUSD(pos.collateralAmount);

        if (pos.borrowAmount > 0) {
            debtAmount = (pos.borrowAmount * _currentBorrowIndex()) / PRECISION;
        }

        healthFactor = pos.borrowAmount > 0 ? _healthFactorView(user) : type(uint256).max;
        tier = creditScore.getTier(user);

        (, , uint256 rateDiscount, ) = creditScore.getTerms(user);
        ratePerBlock = interestModel.getEffectiveRate(totalDeposited, totalBorrowed, rateDiscount);
        annualRate = ratePerBlock * interestModel.BLOCKS_PER_YEAR();
    }

    /// @notice Health factor for a user (1e18 = exactly at threshold)
    function getHealthFactor(address user) external view returns (uint256) {
        Position memory pos = positions[user];
        if (pos.borrowAmount == 0) return type(uint256).max;
        return _healthFactorView(user);
    }

    /// @notice Get the number of tracked borrowers (for keeper enumeration)
    function getBorrowerCount() external view returns (uint256) {
        return borrowerList.length;
    }

    /// @notice Get a borrower address by index
    function getBorrower(uint256 index) external view returns (address) {
        return borrowerList[index];
    }

    /// @notice Get available liquidity
    function getAvailableLiquidity() external view returns (uint256) {
        return totalDeposited > totalBorrowed ? totalDeposited - totalBorrowed : 0;
    }

    /// @notice Get current rates
    function getCurrentRates()
        external
        view
        returns (uint256 perBlock, uint256 annualized, uint256 utilization)
    {
        perBlock = interestModel.getPerBlockRate(totalDeposited, totalBorrowed);
        annualized = perBlock * interestModel.BLOCKS_PER_YEAR();
        utilization = interestModel.getUtilization(totalDeposited, totalBorrowed);
    }

    /// @notice Withdraw protocol reserves (owner only)
    function withdrawReserves(uint256 amount, address to) external onlyOwner {
        if (amount > totalReserves) amount = totalReserves;
        totalReserves -= amount;
        usdc.safeTransfer(to, amount);
        emit ReservesWithdrawn(to, amount);
    }

    // ============ Internal Functions ============

    function _getUserDebt(address user) internal view returns (uint256) {
        Position memory pos = positions[user];
        if (pos.borrowAmount == 0) return 0;
        return (pos.borrowAmount * borrowIndex) / PRECISION;
    }

    function _currentBorrowIndex() internal view returns (uint256) {
        if (block.number <= lastAccrualBlock || totalBorrowed == 0) {
            return borrowIndex;
        }
        uint256 blocksElapsed = block.number - lastAccrualBlock;
        uint256 ratePerBlock = interestModel.getPerBlockRate(totalDeposited, totalBorrowed);
        return borrowIndex + (borrowIndex * ratePerBlock * blocksElapsed) / PRECISION;
    }

    function _getCollateralValueUSD(uint256 collateralAmount) internal view returns (uint256) {
        if (collateralAmount == 0) return 0;
        (uint256 ethPrice, ) = oracle.getPrice(address(weth));
        // collateralAmount is 18 decimals, ethPrice is 18 decimals
        // value = collateralAmount * ethPrice / 1e18 (result in 18 decimals = USD with 18 decimals)
        return (collateralAmount * ethPrice) / PRECISION;
    }

    function _healthFactor(address user) internal view returns (uint256) {
        Position memory pos = positions[user];
        if (pos.borrowAmount == 0) return type(uint256).max;

        uint256 collateralValue = _getCollateralValueUSD(pos.collateralAmount);
        uint256 currentDebt = (pos.borrowAmount * borrowIndex) / PRECISION;

        // Get liquidation ratio for user's tier
        (, uint256 liquidationRatio, , ) = creditScore.getTerms(user);

        // debtValueUSD: convert from 6 decimals to 18
        uint256 debtValueUSD = currentDebt * 1e12;

        // healthFactor = collateralValue / (debtValueUSD * liquidationRatio / 1e18)
        // = collateralValue * 1e18 / (debtValueUSD * liquidationRatio / 1e18)
        // = collateralValue * 1e18 * 1e18 / (debtValueUSD * liquidationRatio)
        if (debtValueUSD == 0) return type(uint256).max;
        return (collateralValue * PRECISION * PRECISION) / (debtValueUSD * liquidationRatio);
    }

    function _healthFactorView(address user) internal view returns (uint256) {
        Position memory pos = positions[user];
        if (pos.borrowAmount == 0) return type(uint256).max;

        uint256 collateralValue = _getCollateralValueUSD(pos.collateralAmount);
        uint256 currentIdx = _currentBorrowIndex();
        uint256 currentDebt = (pos.borrowAmount * currentIdx) / PRECISION;

        (, uint256 liquidationRatio, , ) = creditScore.getTerms(user);
        uint256 debtValueUSD = currentDebt * 1e12;

        if (debtValueUSD == 0) return type(uint256).max;
        return (collateralValue * PRECISION * PRECISION) / (debtValueUSD * liquidationRatio);
    }
}
