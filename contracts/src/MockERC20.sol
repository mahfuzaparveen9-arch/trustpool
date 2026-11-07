// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20 — Mintable test token with a public faucet
/// @notice Used for hackathon demos. Anyone can mint via faucet().
contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public constant FAUCET_AMOUNT_FACTOR = 1000; // 1000 units per faucet call
    uint256 public constant FAUCET_COOLDOWN = 0; // No cooldown for demos

    mapping(address => uint256) public lastFaucet;

    event Fauceted(address indexed to, uint256 amount);

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint tokens to any address (for test setup scripts)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Public faucet — anyone can get test tokens
    function faucet() external {
        uint256 amount = FAUCET_AMOUNT_FACTOR * (10 ** _decimals);
        _mint(msg.sender, amount);
        lastFaucet[msg.sender] = block.timestamp;
        emit Fauceted(msg.sender, amount);
    }

    /// @notice Faucet a specific amount (for flexibility in demos)
    function faucetAmount(uint256 amount) external {
        _mint(msg.sender, amount);
        lastFaucet[msg.sender] = block.timestamp;
        emit Fauceted(msg.sender, amount);
    }
}
