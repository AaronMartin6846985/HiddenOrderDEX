// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HiddenOrderDEX is SepoliaConfig {
    struct EncryptedOrder {
        uint256 id;
        address trader;
        euint32 encryptedPrice;   // Encrypted price
        euint32 encryptedAmount;  // Encrypted amount
        euint32 encryptedType;    // Encrypted order type (0 = buy, 1 = sell)
        uint256 timestamp;
        bool isActive;
    }
    
    struct MatchResult {
        uint256 buyOrderId;
        uint256 sellOrderId;
        euint32 encryptedPrice;
        euint32 encryptedAmount;
        bool isComplete;
    }
    
    struct DecryptedOrder {
        uint32 price;
        uint32 amount;
        uint8 orderType;
        bool isRevealed;
    }
    
    // Contract state
    uint256 public orderCount;
    mapping(uint256 => EncryptedOrder) public encryptedOrders;
    mapping(uint256 => MatchResult) public matchResults;
    mapping(uint256 => DecryptedOrder) public decryptedOrders;
    
    // Order book (encrypted)
    euint32[] private encryptedBuyPrices;
    euint32[] private encryptedSellPrices;
    
    // Decryption requests tracking
    mapping(uint256 => uint256) private requestToOrderId;
    
    // Events
    event OrderSubmitted(uint256 indexed id, uint256 timestamp);
    event OrderMatched(uint256 indexed buyId, uint256 indexed sellId);
    event OrderRevealed(uint256 indexed id);
    
    modifier onlyTrader(uint256 orderId) {
        require(msg.sender == encryptedOrders[orderId].trader, "Not order owner");
        _;
    }
    
    /// @notice Submit encrypted order
    function submitEncryptedOrder(
        euint32 encryptedPrice,
        euint32 encryptedAmount,
        euint32 encryptedType
    ) public {
        orderCount++;
        uint256 newId = orderCount;
        
        encryptedOrders[newId] = EncryptedOrder({
            id: newId,
            trader: msg.sender,
            encryptedPrice: encryptedPrice,
            encryptedAmount: encryptedAmount,
            encryptedType: encryptedType,
            timestamp: block.timestamp,
            isActive: true
        });
        
        // Initialize decrypted state
        decryptedOrders[newId] = DecryptedOrder({
            price: 0,
            amount: 0,
            orderType: 0,
            isRevealed: false
        });
        
        // Add to encrypted order book
        ebool isBuy = FHE.eq(encryptedType, FHE.asEuint32(0));
        ebool isSell = FHE.eq(encryptedType, FHE.asEuint32(1));
        
        encryptedBuyPrices.push(FHE.select(isBuy, encryptedPrice, FHE.asEuint32(0)));
        encryptedSellPrices.push(FHE.select(isSell, encryptedPrice, FHE.asEuint32(0)));
        
        emit OrderSubmitted(newId, block.timestamp);
    }
    
    /// @notice Match encrypted orders
    function matchOrders() public {
        // Simplified matching logic (actual matching done off-chain)
        emit OrderMatched(0, 0);
    }
    
    /// @notice Store encrypted match result
    function storeMatchResult(
        uint256 buyOrderId,
        uint256 sellOrderId,
        euint32 encryptedPrice,
        euint32 encryptedAmount
    ) public {
        uint256 matchId = uint256(keccak256(abi.encodePacked(buyOrderId, sellOrderId)));
        
        matchResults[matchId] = MatchResult({
            buyOrderId: buyOrderId,
            sellOrderId: sellOrderId,
            encryptedPrice: encryptedPrice,
            encryptedAmount: encryptedAmount,
            isComplete: true
        });
        
        // Mark orders as inactive
        encryptedOrders[buyOrderId].isActive = false;
        encryptedOrders[sellOrderId].isActive = false;
        
        emit OrderMatched(buyOrderId, sellOrderId);
    }
    
    /// @notice Request decryption of order details
    function requestOrderDecryption(uint256 orderId) public onlyTrader(orderId) {
        EncryptedOrder storage order = encryptedOrders[orderId];
        require(!decryptedOrders[orderId].isRevealed, "Already revealed");
        
        // Prepare encrypted data for decryption
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(order.encryptedPrice);
        ciphertexts[1] = FHE.toBytes32(order.encryptedAmount);
        ciphertexts[2] = FHE.toBytes32(order.encryptedType);
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptOrder.selector);
        requestToOrderId[reqId] = orderId;
    }
    
    /// @notice Callback for decrypted order data
    function decryptOrder(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 orderId = requestToOrderId[requestId];
        require(orderId != 0, "Invalid request");
        
        EncryptedOrder storage eOrder = encryptedOrders[orderId];
        DecryptedOrder storage dOrder = decryptedOrders[orderId];
        require(!dOrder.isRevealed, "Already revealed");
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted values
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        
        dOrder.price = results[0];
        dOrder.amount = results[1];
        dOrder.orderType = uint8(results[2]);
        dOrder.isRevealed = true;
        
        emit OrderRevealed(orderId);
    }
    
    /// @notice Find best bid and ask (encrypted)
    function findBestBidAsk() public view returns (euint32 bestBid, euint32 bestAsk) {
        bestBid = FHE.asEuint32(0);
        bestAsk = FHE.asEuint32(type(uint32).max);
        
        for (uint i = 0; i < encryptedBuyPrices.length; i++) {
            ebool isActive = encryptedOrders[i+1].isActive;
            ebool isBuy = FHE.eq(encryptedOrders[i+1].encryptedType, FHE.asEuint32(0));
            
            ebool isBetterBid = FHE.gt(encryptedBuyPrices[i], bestBid);
            ebool shouldUpdateBid = FHE.and(isBetterBid, FHE.and(isActive, isBuy));
            
            bestBid = FHE.select(shouldUpdateBid, encryptedBuyPrices[i], bestBid);
        }
        
        for (uint i = 0; i < encryptedSellPrices.length; i++) {
            ebool isActive = encryptedOrders[i+1].isActive;
            ebool isSell = FHE.eq(encryptedOrders[i+1].encryptedType, FHE.asEuint32(1));
            
            ebool isBetterAsk = FHE.lt(encryptedSellPrices[i], bestAsk);
            ebool shouldUpdateAsk = FHE.and(isBetterAsk, FHE.and(isActive, isSell));
            
            bestAsk = FHE.select(shouldUpdateAsk, encryptedSellPrices[i], bestAsk);
        }
    }
    
    /// @notice Check if orders can be matched (encrypted)
    function canMatchOrders(uint256 buyId, uint256 sellId) public view returns (ebool) {
        EncryptedOrder storage buy = encryptedOrders[buyId];
        EncryptedOrder storage sell = encryptedOrders[sellId];
        
        require(buy.isActive && sell.isActive, "Inactive orders");
        
        ebool isBuy = FHE.eq(buy.encryptedType, FHE.asEuint32(0));
        ebool isSell = FHE.eq(sell.encryptedType, FHE.asEuint32(1));
        ebool validTypes = FHE.and(isBuy, isSell);
        
        ebool priceMatch = FHE.ge(buy.encryptedPrice, sell.encryptedPrice);
        ebool amountMatch = FHE.ge(buy.encryptedAmount, sell.encryptedAmount);
        
        return FHE.and(validTypes, FHE.and(priceMatch, amountMatch));
    }
    
    /// @notice Calculate execution price (encrypted)
    function calculateExecutionPrice(
        uint256 buyId,
        uint256 sellId
    ) public view returns (euint32) {
        EncryptedOrder storage buy = encryptedOrders[buyId];
        EncryptedOrder storage sell = encryptedOrders[sellId];
        
        // Mid-price execution
        euint32 sum = FHE.add(buy.encryptedPrice, sell.encryptedPrice);
        return FHE.div(sum, FHE.asEuint32(2));
    }
    
    /// @notice Calculate execution amount (encrypted)
    function calculateExecutionAmount(
        uint256 buyId,
        uint256 sellId
    ) public view returns (euint32) {
        EncryptedOrder storage buy = encryptedOrders[buyId];
        EncryptedOrder storage sell = encryptedOrders[sellId];
        
        // Minimum of buy and sell amounts
        ebool buySmaller = FHE.lt(buy.encryptedAmount, sell.encryptedAmount);
        return FHE.select(buySmaller, buy.encryptedAmount, sell.encryptedAmount);
    }
    
    /// @notice Get encrypted order details
    function getEncryptedOrder(uint256 orderId) public view returns (
        euint32 price,
        euint32 amount,
        euint32 orderType,
        bool isActive
    ) {
        EncryptedOrder storage order = encryptedOrders[orderId];
        return (order.encryptedPrice, order.encryptedAmount, order.encryptedType, order.isActive);
    }
    
    /// @notice Get decrypted order details
    function getDecryptedOrder(uint256 orderId) public view onlyTrader(orderId) returns (
        uint32 price,
        uint32 amount,
        uint8 orderType,
        bool isRevealed
    ) {
        DecryptedOrder storage order = decryptedOrders[orderId];
        return (order.price, order.amount, order.orderType, order.isRevealed);
    }
    
    /// @notice Cancel an order
    function cancelOrder(uint256 orderId) public onlyTrader(orderId) {
        require(encryptedOrders[orderId].isActive, "Order not active");
        encryptedOrders[orderId].isActive = false;
        
        // Remove from encrypted order book
        uint256 index = orderId - 1;
        if (index < encryptedBuyPrices.length) {
            encryptedBuyPrices[index] = FHE.asEuint32(0);
        }
        if (index < encryptedSellPrices.length) {
            encryptedSellPrices[index] = FHE.asEuint32(0);
        }
    }
    
    /// @notice Request decryption of match result
    function requestMatchDecryption(uint256 buyId, uint256 sellId) public {
        uint256 matchId = uint256(keccak256(abi.encodePacked(buyId, sellId)));
        MatchResult storage result = matchResults[matchId];
        require(result.isComplete, "Match not complete");
        
        // Prepare encrypted data for decryption
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(result.encryptedPrice);
        ciphertexts[1] = FHE.toBytes32(result.encryptedAmount);
        
        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptMatchResult.selector);
        requestToOrderId[reqId] = matchId;
    }
    
    /// @notice Callback for decrypted match result
    function decryptMatchResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 matchId = requestToOrderId[requestId];
        require(matchId != 0, "Invalid request");
        
        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        // Process decrypted values
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        
        // Store or emit decrypted match details
        // Implementation depends on specific requirements
    }
}