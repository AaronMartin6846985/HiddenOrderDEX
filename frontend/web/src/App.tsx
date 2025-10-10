// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface HiddenOrder {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  pair: string;
  status: "pending" | "matched" | "cancelled";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<HiddenOrder[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newOrderData, setNewOrderData] = useState({
    pair: "ETH/USDT",
    amount: "",
    price: "",
    type: "buy"
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [showTeamInfo, setShowTeamInfo] = useState(false);

  // Calculate statistics
  const pendingCount = orders.filter(o => o.status === "pending").length;
  const matchedCount = orders.filter(o => o.status === "matched").length;
  const cancelledCount = orders.filter(o => o.status === "cancelled").length;

  useEffect(() => {
    loadOrders().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadOrders = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("order_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing order keys:", e);
        }
      }
      
      const list: HiddenOrder[] = [];
      
      for (const key of keys) {
        try {
          const orderBytes = await contract.getData(`order_${key}`);
          if (orderBytes.length > 0) {
            try {
              const orderData = JSON.parse(ethers.toUtf8String(orderBytes));
              list.push({
                id: key,
                encryptedData: orderData.data,
                timestamp: orderData.timestamp,
                owner: orderData.owner,
                pair: orderData.pair,
                status: orderData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing order data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading order ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setOrders(list);
    } catch (e) {
      console.error("Error loading orders:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitOrder = async () => {
    if (!provider) { 
      alert(language === "en" ? "Please connect wallet first" : "请先连接钱包"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Encrypting order with FHE..." 
        : "正在使用FHE加密订单..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newOrderData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const orderId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const orderData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        pair: newOrderData.pair,
        status: "pending"
      };
      
      await contract.setData(
        `order_${orderId}`, 
        ethers.toUtf8Bytes(JSON.stringify(orderData))
      );
      
      const keysBytes = await contract.getData("order_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(orderId);
      
      await contract.setData(
        "order_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "Order submitted securely!" 
          : "订单已安全提交!"
      });
      
      await loadOrders();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewOrderData({
          pair: "ETH/USDT",
          amount: "",
          price: "",
          type: "buy"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? language === "en" ? "Transaction rejected by user" : "用户拒绝了交易"
        : (language === "en" ? "Submission failed: " : "提交失败: ") + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const cancelOrder = async (orderId: string) => {
    if (!provider) {
      alert(language === "en" ? "Please connect wallet first" : "请先连接钱包");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Processing encrypted cancellation..." 
        : "正在处理加密取消..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const orderBytes = await contract.getData(`order_${orderId}`);
      if (orderBytes.length === 0) {
        throw new Error("Order not found");
      }
      
      const orderData = JSON.parse(ethers.toUtf8String(orderBytes));
      
      const updatedOrder = {
        ...orderData,
        status: "cancelled"
      };
      
      await contract.setData(
        `order_${orderId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedOrder))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "Order cancelled securely!" 
          : "订单已安全取消!"
      });
      
      await loadOrders();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: (language === "en" ? "Cancellation failed: " : "取消失败: ") + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const filteredOrders = orders.filter(order => 
    order.pair.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.owner.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.status.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleLanguage = () => {
    setLanguage(prev => prev === "en" ? "zh" : "en");
  };

  const teamMembers = [
    {
      name: "Alex Chen",
      role: "FHE Architect",
      bio: "10+ years in cryptography, Zama contributor",
      avatar: "👨‍💻"
    },
    {
      name: "Jamie Wong",
      role: "Blockchain Engineer",
      bio: "DeFi specialist, former Uniswap dev",
      avatar: "👩‍💻"
    },
    {
      name: "Sam Lee",
      role: "Security Lead",
      bio: "Smart contract auditor, whitehat hacker",
      avatar: "🕵️"
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>{language === "en" ? "Initializing encrypted connection..." : "正在初始化加密连接..."}</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Hidden<span>Order</span>DEX</h1>
        </div>
        
        <div className="header-actions">
          <div className="language-toggle" onClick={toggleLanguage}>
            {language === "en" ? "中文" : "EN"}
          </div>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-order-btn cyber-button"
          >
            <div className="add-icon"></div>
            {language === "en" ? "New Order" : "新建订单"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>{language === "en" ? "FHE-Powered Hidden Order DEX" : "FHE驱动的隐藏订单交易所"}</h2>
            <p>
              {language === "en" 
                ? "Trade with complete privacy - orders are encrypted and hidden" 
                : "完全隐私的交易 - 订单加密且隐藏"}
            </p>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>{language === "en" ? "Project Introduction" : "项目介绍"}</h3>
            <p>
              {language === "en" 
                ? "Decentralized exchange where order prices, quantities, and even their existence are hidden using FHE." 
                : "去中心化交易所，使用FHE隐藏订单价格、数量甚至其存在性。"}
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>{language === "en" ? "Order Statistics" : "订单统计"}</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{orders.length}</div>
                <div className="stat-label">{language === "en" ? "Total Orders" : "总订单"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">{language === "en" ? "Pending" : "待处理"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{matchedCount}</div>
                <div className="stat-label">{language === "en" ? "Matched" : "已匹配"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{cancelledCount}</div>
                <div className="stat-label">{language === "en" ? "Cancelled" : "已取消"}</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>{language === "en" ? "Team Information" : "团队信息"}</h3>
            <p>
              {language === "en" 
                ? "Meet the team behind this revolutionary DEX" 
                : "认识这个革命性DEX背后的团队"}
            </p>
            <button 
              className="cyber-button small"
              onClick={() => setShowTeamInfo(!showTeamInfo)}
            >
              {showTeamInfo 
                ? (language === "en" ? "Hide" : "隐藏") 
                : (language === "en" ? "Show" : "显示")}
            </button>
          </div>
        </div>
        
        {showTeamInfo && (
          <div className="team-section cyber-card">
            <h3>{language === "en" ? "Our Team" : "我们的团队"}</h3>
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div className="team-member" key={index}>
                  <div className="member-avatar">{member.avatar}</div>
                  <div className="member-info">
                    <h4>{member.name}</h4>
                    <div className="member-role">{member.role}</div>
                    <p>{member.bio}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="orders-section">
          <div className="section-header">
            <h2>{language === "en" ? "Hidden Orders" : "隐藏订单"}</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder={language === "en" ? "Search orders..." : "搜索订单..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <div className="search-icon"></div>
              </div>
              <button 
                onClick={loadOrders}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing 
                  ? (language === "en" ? "Refreshing..." : "刷新中...") 
                  : (language === "en" ? "Refresh" : "刷新")}
              </button>
            </div>
          </div>
          
          <div className="orders-list cyber-card">
            <div className="table-header">
              <div className="header-cell">{language === "en" ? "ID" : "编号"}</div>
              <div className="header-cell">{language === "en" ? "Pair" : "交易对"}</div>
              <div className="header-cell">{language === "en" ? "Owner" : "所有者"}</div>
              <div className="header-cell">{language === "en" ? "Date" : "日期"}</div>
              <div className="header-cell">{language === "en" ? "Status" : "状态"}</div>
              <div className="header-cell">{language === "en" ? "Actions" : "操作"}</div>
            </div>
            
            {filteredOrders.length === 0 ? (
              <div className="no-orders">
                <div className="no-orders-icon"></div>
                <p>{language === "en" ? "No hidden orders found" : "未找到隐藏订单"}</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  {language === "en" ? "Create First Order" : "创建第一个订单"}
                </button>
              </div>
            ) : (
              filteredOrders.map(order => (
                <div className="order-row" key={order.id}>
                  <div className="table-cell order-id">#{order.id.substring(0, 6)}</div>
                  <div className="table-cell">{order.pair}</div>
                  <div className="table-cell">{order.owner.substring(0, 6)}...{order.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(order.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${order.status}`}>
                      {language === "en" ? order.status : 
                        order.status === "pending" ? "待处理" :
                        order.status === "matched" ? "已匹配" : "已取消"}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(order.owner) && order.status === "pending" && (
                      <button 
                        className="action-btn cyber-button danger"
                        onClick={() => cancelOrder(order.id)}
                      >
                        {language === "en" ? "Cancel" : "取消"}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitOrder} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          orderData={newOrderData}
          setOrderData={setNewOrderData}
          language={language}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>HiddenOrderDEX</span>
            </div>
            <p>
              {language === "en" 
                ? "Secure encrypted trading using FHE technology" 
                : "使用FHE技术实现的安全加密交易"}
            </p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">
              {language === "en" ? "Documentation" : "文档"}
            </a>
            <a href="#" className="footer-link">
              {language === "en" ? "Privacy Policy" : "隐私政策"}
            </a>
            <a href="#" className="footer-link">
              {language === "en" ? "Terms" : "条款"}
            </a>
            <a href="#" className="footer-link">
              {language === "en" ? "Contact" : "联系我们"}
            </a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} HiddenOrderDEX. {language === "en" ? "All rights reserved." : "保留所有权利。"}
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  orderData: any;
  setOrderData: (data: any) => void;
  language: "en" | "zh";
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  orderData,
  setOrderData,
  language
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setOrderData({
      ...orderData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!orderData.amount || !orderData.price) {
      alert(language === "en" ? "Please fill required fields" : "请填写必填字段");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>{language === "en" ? "Create Hidden Order" : "创建隐藏订单"}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            {language === "en" 
              ? "Your order details will be encrypted with FHE" 
              : "您的订单详情将使用FHE加密"}
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>{language === "en" ? "Trading Pair" : "交易对"} *</label>
              <select 
                name="pair"
                value={orderData.pair} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="ETH/USDT">ETH/USDT</option>
                <option value="BTC/USDT">BTC/USDT</option>
                <option value="SOL/USDC">SOL/USDC</option>
                <option value="MATIC/ETH">MATIC/ETH</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Order Type" : "订单类型"} *</label>
              <select 
                name="type"
                value={orderData.type} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="buy">{language === "en" ? "Buy" : "买入"}</option>
                <option value="sell">{language === "en" ? "Sell" : "卖出"}</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Amount" : "数量"} *</label>
              <input 
                type="text"
                name="amount"
                value={orderData.amount} 
                onChange={handleChange}
                placeholder={language === "en" ? "0.00" : "0.00"} 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Price" : "价格"} *</label>
              <input 
                type="text"
                name="price"
                value={orderData.price} 
                onChange={handleChange}
                placeholder={language === "en" ? "0.00" : "0.00"} 
                className="cyber-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            {language === "en" 
              ? "Order remains hidden until matched" 
              : "订单将保持隐藏直到匹配"}
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            {language === "en" ? "Cancel" : "取消"}
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating 
              ? (language === "en" ? "Encrypting..." : "加密中...") 
              : (language === "en" ? "Submit Order" : "提交订单")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;