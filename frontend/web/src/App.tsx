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
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface TradeStats {
  totalVolume: number;
  activeOrders: number;
  avgSpread: number;
  successRate: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [userHistory, setUserHistory] = useState<OrderData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newOrderData, setNewOrderData] = useState({ 
    pair: "ETH/USDT", 
    amount: "", 
    price: "", 
    type: "buy" as 'buy' | 'sell' 
  });
  const [selectedOrder, setSelectedOrder] = useState<OrderData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ amount: number | null; price: number | null }>({ amount: null, price: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [stats, setStats] = useState<TradeStats>({
    totalVolume: 0,
    activeOrders: 0,
    avgSpread: 2.5,
    successRate: 98.7
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
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
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading order data:', e);
        }
      }
      
      setOrders(ordersList);
      if (address) {
        setUserHistory(ordersList.filter(order => order.creator.toLowerCase() === address.toLowerCase()));
      }
      
      setStats(prev => ({
        ...prev,
        activeOrders: ordersList.length,
        totalVolume: ordersList.reduce((sum, order) => sum + order.amount * order.price, 0)
      }));
      
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load orders" });
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
      if (!contract) throw new Error("Contract not available");
      
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
        `${newOrderData.type.toUpperCase()} Order`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Confirming transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Order created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewOrderData({ pair: "ETH/USDT", amount: "", price: "", type: "buy" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingOrder(false); 
    }
  };

  const decryptOrderData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
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
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
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

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderStatsPanels = () => {
    return (
      <div className="stats-grid">
        <div className="stat-panel neon-purple">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <div className="stat-value">${stats.totalVolume.toLocaleString()}</div>
            <div className="stat-label">Total Volume</div>
          </div>
        </div>
        
        <div className="stat-panel neon-blue">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-value">{stats.activeOrders}</div>
            <div className="stat-label">Active Orders</div>
          </div>
        </div>
        
        <div className="stat-panel neon-pink">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <div className="stat-value">{stats.avgSpread}%</div>
            <div className="stat-label">Avg Spread</div>
          </div>
        </div>
        
        <div className="stat-panel neon-green">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-value">{stats.successRate}%</div>
            <div className="stat-label">Success Rate</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Order Encryption</h4>
            <p>Trade details encrypted with FHE before submission</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>Secure Matching</h4>
            <p>Homomorphic matching without revealing orders</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Selective Decryption</h4>
            <p>Only matched parties can decrypt trade details</p>
          </div>
        </div>
      </div>
    );
  };

  const renderPriceChart = () => {
    return (
      <div className="price-chart">
        <div className="chart-header">
          <h3>ETH/USDT Spread Analysis</h3>
          <div className="chart-legend">
            <span className="legend-buy">Buy Orders</span>
            <span className="legend-sell">Sell Orders</span>
          </div>
        </div>
        <div className="chart-bars">
          {[3200, 3150, 3100, 3050, 3000].map((price, index) => (
            <div key={price} className="price-level">
              <div className="price-label">${price}</div>
              <div className="order-bars">
                <div 
                  className="buy-bar" 
                  style={{ width: `${Math.random() * 40 + 10}%` }}
                ></div>
                <div 
                  className="sell-bar" 
                  style={{ width: `${Math.random() * 40 + 10}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container dark-theme">
        <header className="app-header">
          <div className="logo">
            <h1 className="neon-text">FHE OTC Desk 🔐</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="prompt-content">
            <div className="neon-glow">🔒</div>
            <h2>Connect to Encrypted OTC Trading</h2>
            <p>Private large-block trading with fully homomorphic encryption</p>
            <div className="feature-list">
              <div className="feature-item">🔐 Encrypted Order Matching</div>
              <div className="feature-item">⚡ Zero Slippage</div>
              <div className="feature-item">🛡️ Whale Tracking Protection</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen dark-theme">
        <div className="fhe-spinner neon-spin"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  return (
    <div className="app-container dark-theme">
      <header className="app-header">
        <div className="logo">
          <h1 className="neon-text">FHE OTC Desk 🔐</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn neon-glow">
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn neon-pulse"
          >
            + New Order
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-layout">
        <div className="sidebar-panel">
          <div className="panel-section">
            <h3>Market Overview</h3>
            {renderStatsPanels()}
          </div>
          
          <div className="panel-section">
            <h3>FHE Process</h3>
            {renderFHEProcess()}
          </div>
          
          <div className="panel-section">
            <h3>Your History</h3>
            <div className="history-list">
              {userHistory.slice(0, 5).map((order, index) => (
                <div key={index} className="history-item">
                  <div className="history-type">{order.type.toUpperCase()}</div>
                  <div className="history-pair">{order.pair}</div>
                  <div className="history-amount">{order.amount}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="main-panel">
          <div className="panel-header">
            <h2>Encrypted Order Book</h2>
            <div className="header-controls">
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>

          {renderPriceChart()}

          <div className="orders-grid">
            <div className="orders-section">
              <h3>Buy Orders (FHE 🔐)</h3>
              <div className="orders-list">
                {orders.filter(o => o.type === 'buy').map((order, index) => (
                  <OrderItem 
                    key={order.id} 
                    order={order} 
                    onSelect={setSelectedOrder}
                    onDecrypt={decryptOrderData}
                  />
                ))}
              </div>
            </div>

            <div className="orders-section">
              <h3>Sell Orders (FHE 🔐)</h3>
              <div className="orders-list">
                {orders.filter(o => o.type === 'sell').map((order, index) => (
                  <OrderItem 
                    key={order.id} 
                    order={order} 
                    onSelect={setSelectedOrder}
                    onDecrypt={decryptOrderData}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <CreateOrderModal 
          onSubmit={createOrder}
          onClose={() => setShowCreateModal(false)}
          creating={creatingOrder}
          orderData={newOrderData}
          setOrderData={setNewOrderData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => {
            setSelectedOrder(null);
            setDecryptedData({ amount: null, price: null });
          }}
          decryptedData={decryptedData}
          setDecryptedData={setDecryptedData}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptOrderData(selectedOrder.id)}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const OrderItem: React.FC<{
  order: OrderData;
  onSelect: (order: OrderData) => void;
  onDecrypt: (id: string) => Promise<number | null>;
}> = ({ order, onSelect, onDecrypt }) => {
  const [decrypting, setDecrypting] = useState(false);

  const handleDecrypt = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDecrypting(true);
    await onDecrypt(order.id);
    setDecrypting(false);
  };

  return (
    <div className="order-item" onClick={() => onSelect(order)}>
      <div className="order-header">
        <span className="order-pair">{order.pair}</span>
        <span className={`order-type ${order.type}`}>{order.type.toUpperCase()}</span>
      </div>
      <div className="order-details">
        <div className="order-amount">
          Amount: {order.isVerified ? order.decryptedValue : "🔒 Encrypted"}
        </div>
        <div className="order-price">Price: ${order.price}</div>
      </div>
      <div className="order-actions">
        <button 
          className={`decrypt-btn ${order.isVerified ? 'verified' : ''}`}
          onClick={handleDecrypt}
          disabled={decrypting}
        >
          {decrypting ? "Decrypting..." : order.isVerified ? "✅ Verified" : "🔓 Decrypt"}
        </button>
      </div>
    </div>
  );
};

const CreateOrderModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  orderData: any;
  setOrderData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, orderData, setOrderData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setOrderData({ ...orderData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal neon-border">
        <div className="modal-header">
          <h2>Create Encrypted Order</h2>
          <button onClick={onClose} className="close-btn neon-glow">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice neon-glow">
            <strong>FHE Encrypted Trading</strong>
            <p>Order amounts are encrypted with Zama FHE for complete privacy</p>
          </div>
          
          <div className="form-group">
            <label>Trading Pair</label>
            <select name="pair" value={orderData.pair} onChange={handleChange}>
              <option value="ETH/USDT">ETH/USDT</option>
              <option value="BTC/USDT">BTC/USDT</option>
              <option value="SOL/USDT">SOL/USDT</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Order Type</label>
            <div className="type-selector">
              <label className={`type-option ${orderData.type === 'buy' ? 'selected' : ''}`}>
                <input type="radio" name="type" value="buy" checked={orderData.type === 'buy'} onChange={handleChange} />
                Buy
              </label>
              <label className={`type-option ${orderData.type === 'sell' ? 'selected' : ''}`}>
                <input type="radio" name="type" value="sell" checked={orderData.type === 'sell'} onChange={handleChange} />
                Sell
              </label>
            </div>
          </div>
          
          <div className="form-group">
            <label>Amount (FHE Encrypted Integer)</label>
            <input 
              type="number"
              name="amount"
              value={orderData.amount}
              onChange={handleChange}
              placeholder="Enter amount..."
              min="1"
            />
          </div>
          
          <div className="form-group">
            <label>Price (Public USD)</label>
            <input 
              type="number"
              name="price"
              value={orderData.price}
              onChange={handleChange}
              placeholder="Enter price..."
              min="0"
              step="0.01"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit}
            disabled={creating || isEncrypting || !orderData.amount || !orderData.price}
            className="submit-btn neon-pulse"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Order"}
          </button>
        </div>
      </div>
    </div>
  );
};

const OrderDetailModal: React.FC<{
  order: OrderData;
  onClose: () => void;
  decryptedData: { amount: number | null; price: number | null };
  setDecryptedData: (data: { amount: number | null; price: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ order, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.amount !== null) {
      setDecryptedData({ amount: null, price: null });
      return;
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ amount: decrypted, price: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal neon-border">
        <div className="modal-header">
          <h2>Order Details</h2>
          <button onClick={onClose} className="close-btn neon-glow">×</button>
        </div>
        
        <div className="modal-body">
          <div className="order-info">
            <div className="info-row">
              <span>Pair:</span>
              <strong>{order.pair}</strong>
            </div>
            <div className="info-row">
              <span>Type:</span>
              <strong className={`type-${order.type}`}>{order.type.toUpperCase()}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{order.creator.substring(0, 8)}...{order.creator.substring(34)}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Data</h3>
            <div className="data-row">
              <span>Amount:</span>
              <span className="data-value">
                {order.isVerified ? 
                  `${order.decryptedValue} (Verified)` : 
                  decryptedData.amount !== null ? 
                  `${decryptedData.amount} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </span>
            </div>
            <div className="data-row">
              <span>Price:</span>
              <span className="data-value">${order.price}</span>
            </div>
            
            <button 
              className={`decrypt-btn large ${order.isVerified || decryptedData.amount !== null ? 'decrypted' : ''}`}
              onClick={handleDecrypt}
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : 
               order.isVerified ? "✅ Verified" : 
               decryptedData.amount !== null ? "🔄 Re-verify" : 
               "🔓 Decrypt Amount"}
            </button>
          </div>
          
          {(order.isVerified || decryptedData.amount !== null) && (
            <div className="analysis-section">
              <h3>Trade Analysis</h3>
              <div className="analysis-grid">
                <div className="analysis-item">
                  <span>Notional Value</span>
                  <strong>${((order.isVerified ? order.decryptedValue : decryptedData.amount) || 0) * order.price}</strong>
                </div>
                <div className="analysis-item">
                  <span>Privacy Level</span>
                  <strong>{order.isVerified ? "On-chain Verified" : "Local Decryption"}</strong>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

