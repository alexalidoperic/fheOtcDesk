pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FHEOTCDesk is ZamaEthereumConfig {
    struct Order {
        euint32 encryptedAmount;
        euint32 encryptedPrice;
        uint256 publicTokenId;
        address trader;
        bool isBuy;
        uint256 expiration;
        bool isActive;
    }

    uint256 public nextOrderId = 1;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) public traderOrders;

    event OrderPlaced(uint256 indexed orderId, address indexed trader, bool isBuy);
    event OrderMatched(uint256 indexed buyOrderId, uint256 indexed sellOrderId, uint256 amount, uint256 price);
    event OrderCancelled(uint256 indexed orderId);

    constructor() ZamaEthereumConfig() {}

    function placeOrder(
        externalEuint32 encryptedAmount,
        externalEuint32 encryptedPrice,
        bytes calldata amountProof,
        bytes calldata priceProof,
        uint256 publicTokenId,
        bool isBuy,
        uint256 expiration
    ) external {
        // Validate encrypted inputs
        require(FHE.isInitialized(FHE.fromExternal(encryptedAmount, amountProof)), "Invalid encrypted amount");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPrice, priceProof)), "Invalid encrypted price");

        // Create order
        uint256 orderId = nextOrderId++;
        orders[orderId] = Order({
            encryptedAmount: FHE.fromExternal(encryptedAmount, amountProof),
            encryptedPrice: FHE.fromExternal(encryptedPrice, priceProof),
            publicTokenId: publicTokenId,
            trader: msg.sender,
            isBuy: isBuy,
            expiration: expiration,
            isActive: true
        });

        // Allow contract to use encrypted values
        FHE.allowThis(orders[orderId].encryptedAmount);
        FHE.allowThis(orders[orderId].encryptedPrice);

        // Make values decryptable by anyone
        FHE.makePubliclyDecryptable(orders[orderId].encryptedAmount);
        FHE.makePubliclyDecryptable(orders[orderId].encryptedPrice);

        // Track trader's orders
        traderOrders[msg.sender].push(orderId);

        emit OrderPlaced(orderId, msg.sender, isBuy);
    }

    function matchOrders(
        uint256 buyOrderId,
        uint256 sellOrderId,
        bytes calldata amountProof,
        bytes calldata priceProof
    ) external {
        // Validate orders exist and are active
        require(orders[buyOrderId].isActive, "Buy order not active");
        require(orders[sellOrderId].isActive, "Sell order not active");
        require(orders[buyOrderId].isBuy, "Not a buy order");
        require(!orders[sellOrderId].isBuy, "Not a sell order");
        require(orders[buyOrderId].publicTokenId == orders[sellOrderId].publicTokenId, "Token mismatch");
        require(block.timestamp < orders[buyOrderId].expiration, "Buy order expired");
        require(block.timestamp < orders[sellOrderId].expiration, "Sell order expired");

        // Homomorphically compute if prices match
        euint32 priceDifference = orders[buyOrderId].encryptedPrice - orders[sellOrderId].encryptedPrice;
        require(FHE.isZero(priceDifference), "Prices don't match");

        // Homomorphically compute trade amount (minimum of buy and sell amounts)
        euint32 tradeAmount = FHE.min(orders[buyOrderId].encryptedAmount, orders[sellOrderId].encryptedAmount);

        // Update order amounts
        orders[buyOrderId].encryptedAmount = orders[buyOrderId].encryptedAmount - tradeAmount;
        orders[sellOrderId].encryptedAmount = orders[sellOrderId].encryptedAmount - tradeAmount;

        // Deactivate orders if amounts are zero
        if (FHE.isZero(orders[buyOrderId].encryptedAmount)) {
            orders[buyOrderId].isActive = false;
        }
        if (FHE.isZero(orders[sellOrderId].encryptedAmount)) {
            orders[sellOrderId].isActive = false;
        }

        // Emit match event with encrypted values
        bytes memory encryptedTradeAmount = FHE.toBytes(orders[buyOrderId].encryptedAmount);
        bytes memory encryptedTradePrice = FHE.toBytes(orders[buyOrderId].encryptedPrice);

        emit OrderMatched(
            buyOrderId,
            sellOrderId,
            abi.decode(encryptedTradeAmount, (uint32)),
            abi.decode(encryptedTradePrice, (uint32))
        );
    }

    function cancelOrder(uint256 orderId) external {
        require(orders[orderId].trader == msg.sender, "Not order owner");
        require(orders[orderId].isActive, "Order not active");

        orders[orderId].isActive = false;
        emit OrderCancelled(orderId);
    }

    function getActiveOrders() external view returns (uint256[] memory) {
        uint256[] memory activeOrders = new uint256[](nextOrderId - 1);
        uint256 count = 0;

        for (uint256 i = 1; i < nextOrderId; i++) {
            if (orders[i].isActive) {
                activeOrders[count] = i;
                count++;
            }
        }

        assembly {
            mstore(activeOrders, count)
        }

        return activeOrders;
    }

    function getTraderOrders(address trader) external view returns (uint256[] memory) {
        return traderOrders[trader];
    }

    function getOrderDetails(uint256 orderId) external view returns (
        euint32 encryptedAmount,
        euint32 encryptedPrice,
        uint256 publicTokenId,
        address trader,
        bool isBuy,
        uint256 expiration,
        bool isActive
    ) {
        Order storage order = orders[orderId];
        return (
            order.encryptedAmount,
            order.encryptedPrice,
            order.publicTokenId,
            order.trader,
            order.isBuy,
            order.expiration,
            order.isActive
        );
    }
}

