import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface OrderData {
  id: string;
  pair: string;
  amount: number;
  price: number;
  type: 'buy' | 'sell';
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newOrderData, setNewOrderData] = useState({ 
    pair: "BTC/USDT", 
    amount: "", 
    price: "", 
    type: "buy" as 'buy' | 'sell' 
  });
  const [selectedOrder, setSelectedOrder] = useState<OrderData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<'all' | 'buy' | 'sell'>('all');

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const ordersList: OrderData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          ordersList.push({
            id: businessId,
            pair: businessData.name,
            amount: Number(businessData.publicValue1) || 0,
            price: Number(businessData.publicValue2) || 0,
            type: Number(businessData.publicValue1) > 0 ? 'buy' : 'sell',
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setOrders(ordersList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createOrder = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingOrder(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted order..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const amountValue = parseInt(newOrderData.amount) || 0;
      const businessId = `order-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, amountValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newOrderData.pair,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        amountValue,
        parseInt(newOrderData.price) || 0,
        `OTC ${newOrderData.type.toUpperCase()} Order`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Order created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewOrderData({ pair: "BTC/USDT", amount: "", price: "", type: "buy" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingOrder(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) return null;
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = order.pair.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || order.type === filterType;
    return matchesSearch && matchesFilter;
  });

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE OTC Desk 🔐</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access Private OTC</h2>
            <p>Connect your wallet to start encrypted OTC trading with full privacy protection.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading OTC Desk...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE OTC Desk 🔐</h1>
          <span>Encrypted Over-The-Counter Trading</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Order
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Orders</h3>
            <div className="stat-value">{orders.length}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified Orders</h3>
            <div className="stat-value">{orders.filter(o => o.isVerified).length}</div>
          </div>
          <div className="stat-panel">
            <h3>Active Pairs</h3>
            <div className="stat-value">{new Set(orders.map(o => o.pair)).size}</div>
          </div>
        </div>

        <div className="fhe-flow">
          <div className="flow-step">
            <div className="step-number">1</div>
            <p>Encrypt Order Data</p>
          </div>
          <div className="flow-arrow">→</div>
          <div className="flow-step">
            <div className="step-number">2</div>
            <p>Store on Chain</p>
          </div>
          <div className="flow-arrow">→</div>
          <div className="flow-step">
            <div className="step-number">3</div>
            <p>Private Matching</p>
          </div>
          <div className="flow-arrow">→</div>
          <div className="flow-step">
            <div className="step-number">4</div>
            <p>Secure Settlement</p>
          </div>
        </div>

        <div className="orders-section">
          <div className="section-header">
            <h2>Encrypted Order Book</h2>
            <div className="controls">
              <input
                type="text"
                placeholder="Search pairs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
              <select 
                value={filterType} 
                onChange={(e) => setFilterType(e.target.value as any)}
                className="filter-select"
              >
                <option value="all">All Orders</option>
                <option value="buy">Buy Orders</option>
                <option value="sell">Sell Orders</option>
              </select>
              <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="orders-list">
            {filteredOrders.length === 0 ? (
              <div className="no-orders">
                <p>No orders found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Order
                </button>
              </div>
            ) : (
              filteredOrders.map((order) => (
                <div 
                  key={order.id}
                  className={`order-item ${order.type} ${selectedOrder?.id === order.id ? 'selected' : ''}`}
                  onClick={() => setSelectedOrder(order)}
                >
                  <div className="order-header">
                    <span className="pair">{order.pair}</span>
                    <span className={`type ${order.type}`}>{order.type.toUpperCase()}</span>
                  </div>
                  <div className="order-details">
                    <span>Amount: {order.amount}</span>
                    <span>Price: ${order.price}</span>
                  </div>
                  <div className="order-footer">
                    <span>{new Date(order.timestamp * 1000).toLocaleDateString()}</span>
                    <span className={`status ${order.isVerified ? 'verified' : 'pending'}`}>
                      {order.isVerified ? '✅ Verified' : '🔓 Pending'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="faq-section">
          <h3>FHE OTC FAQ</h3>
          <div className="faq-item">
            <strong>How does FHE protect my trade?</strong>
            <p>Your order details are encrypted on-chain, visible only to matched counterparties.</p>
          </div>
          <div className="faq-item">
            <strong>What data types are supported?</strong>
            <p>Currently supports integer values for amount and price encryption.</p>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-order-modal">
            <div className="modal-header">
              <h2>New Encrypted Order</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Trading Pair</label>
                <input 
                  type="text" 
                  value={newOrderData.pair}
                  onChange={(e) => setNewOrderData({...newOrderData, pair: e.target.value})}
                  placeholder="e.g., BTC/USDT"
                />
              </div>
              <div className="form-group">
                <label>Amount (FHE Encrypted)</label>
                <input 
                  type="number" 
                  value={newOrderData.amount}
                  onChange={(e) => setNewOrderData({...newOrderData, amount: e.target.value})}
                  placeholder="Enter amount"
                />
              </div>
              <div className="form-group">
                <label>Price (Public)</label>
                <input 
                  type="number" 
                  value={newOrderData.price}
                  onChange={(e) => setNewOrderData({...newOrderData, price: e.target.value})}
                  placeholder="Enter price"
                />
              </div>
              <div className="form-group">
                <label>Order Type</label>
                <select 
                  value={newOrderData.type}
                  onChange={(e) => setNewOrderData({...newOrderData, type: e.target.value as any})}
                >
                  <option value="buy">Buy</option>
                  <option value="sell">Sell</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createOrder} 
                disabled={creatingOrder || isEncrypting}
                className="submit-btn"
              >
                {creatingOrder || isEncrypting ? "Creating..." : "Create Order"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedOrder && (
        <OrderDetailModal 
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onDecrypt={() => decryptData(selectedOrder.id)}
          isDecrypting={isDecrypting || fheIsDecrypting}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

const OrderDetailModal: React.FC<{
  order: OrderData;
  onClose: () => void;
  onDecrypt: () => void;
  isDecrypting: boolean;
}> = ({ order, onClose, onDecrypt, isDecrypting }) => {
  return (
    <div className="modal-overlay">
      <div className="order-detail-modal">
        <div className="modal-header">
          <h2>Order Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        <div className="modal-body">
          <div className="order-info">
            <div className="info-row">
              <span>Pair:</span>
              <strong>{order.pair}</strong>
            </div>
            <div className="info-row">
              <span>Type:</span>
              <strong className={order.type}>{order.type.toUpperCase()}</strong>
            </div>
            <div className="info-row">
              <span>Amount:</span>
              <strong>{order.amount}</strong>
            </div>
            <div className="info-row">
              <span>Price:</span>
              <strong>${order.price}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{order.creator.substring(0, 8)}...{order.creator.substring(34)}</strong>
            </div>
            <div className="info-row">
              <span>Status:</span>
              <strong className={order.isVerified ? 'verified' : 'pending'}>
                {order.isVerified ? 'On-chain Verified' : 'Encrypted'}
              </strong>
            </div>
          </div>
          
          {order.isVerified && order.decryptedValue && (
            <div className="decrypted-section">
              <h3>Decrypted Values</h3>
              <div className="decrypted-value">
                Original Amount: <strong>{order.decryptedValue}</strong>
              </div>
            </div>
          )}
          
          <div className="fhe-info">
            <h4>FHE Protection</h4>
            <p>Order amount is encrypted using Zama FHE technology. Only matched counterparties can decrypt the actual values.</p>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!order.isVerified && (
            <button 
              onClick={onDecrypt} 
              disabled={isDecrypting}
              className="decrypt-btn"
            >
              {isDecrypting ? "Decrypting..." : "Verify Decryption"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;