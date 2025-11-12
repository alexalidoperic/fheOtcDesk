// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract demo_base_src {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function dummy() public pure returns (uint256) {
        return 42;
    }
}

