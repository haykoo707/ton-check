փոփոխիր server.js const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();

// CORS configuration for GitHub Pages
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'https://haykoo707.github.io',
      'https://haykoo707.github.io/test-payment',
      'https://haykoo707.github.io/test-payment/',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://ton-check.onrender.com'
      'https://hayinvest.github.io/TOOF/'
    'https://hayinvest.github.io/TOOF'
    ];
    
    // Check if origin is allowed
    if (allowedOrigins.some(allowedOrigin => origin.startsWith(allowedOrigin))) {
      return callback(null, true);
    }
    
    console.log('CORS blocked origin:', origin);
    return callback(null, true); // Temporarily allow all origins for debugging
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

// Handle preflight OPTIONS requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.use(express.json({ limit: '10mb' }));

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  if (req.method === 'POST') {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

const RECEIVER = "UQCb8i7V_2QxUurP0ZCIHCVglCmKSeKjIzgHekP3XDondvbm";
const AMOUNT = 100; // nanoTONs

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({ 
    message: "TON Payment Verification API",
    endpoints: ["/health", "/check-payment"],
    version: "1.0.0"
  });
});

app.post("/check-payment", async (req, res) => {
  const { txHash, txBoc, from, to, amount } = req.body;
  
  console.log("Payment check request:", { txHash: !!txHash, txBoc: !!txBoc, from, to, amount });

  try {
    // Validate input
    if (!txHash && !txBoc) {
      return res.status(400).json({ 
        success: false, 
        error: "Either txHash or txBoc is required" 
      });
    }

    if (txHash) {
      console.log("Checking payment by txHash:", txHash);
      
      // Try different API endpoints for better reliability
      let response, data;
      
      try {
        // First try tonapi.io v2
        response = await fetch(`https://tonapi.io/v2/blockchain/transactions/${txHash}`, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
          // Fallback to v1
          response = await fetch(`https://tonapi.io/v1/blockchain/transactions/${txHash}`, {
            headers: { 'Accept': 'application/json' }
          });
        }
        
        if (!response.ok) {
          throw new Error(`API responded with status: ${response.status}`);
        }
        
        data = await response.json();
        console.log("Transaction data:", JSON.stringify(data, null, 2));
        
      } catch (apiError) {
        console.error("API Error:", apiError);
        return res.status(500).json({ 
          success: false, 
          error: "Failed to fetch transaction data",
          details: apiError.message 
        });
      }

      // Check transaction validity
      const msg = data.in_msg;
      const isValidReceiver = msg?.destination === RECEIVER || 
                             msg?.destination?.address === RECEIVER;
      const isValidAmount = parseInt(msg?.value || "0") >= AMOUNT;
      
      console.log("Validation:", {
        destination: msg?.destination,
        expectedReceiver: RECEIVER,
        value: msg?.value,
        expectedAmount: AMOUNT,
        isValidReceiver,
        isValidAmount
      });

      if (isValidReceiver && isValidAmount) {
        return res.json({ 
          success: true, 
          message: "Payment verified successfully",
          txHash: txHash
        });
      }
      
      return res.json({ 
        success: false, 
        error: "Payment validation failed",
        details: {
          receiverMatch: isValidReceiver,
          amountMatch: isValidAmount,
          actualReceiver: msg?.destination,
          actualAmount: msg?.value
        }
      });
    }

    if (txBoc) {
      console.log("Checking payment by txBoc for address:", from);
      
      if (!from || !to) {
        return res.status(400).json({ 
          success: false, 
          error: "from and to addresses are required when using txBoc" 
        });
      }

      // Wait a bit for transaction to be indexed
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const query = `https://tonapi.io/v2/accounts/${from}/events?limit=10`;
      
      try {
        const response = await fetch(query, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error(`API responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log("Account events:", JSON.stringify(data, null, 2));
        
        // Convert user-friendly address to raw format for comparison
        function userFriendlyToRaw(address) {
          if (!address || address.startsWith('0:')) return address;
          
          // Simple conversion for the specific address we're expecting
          if (address === 'UQCb8i7V_2QxUurP0ZCIHCVglCmKSeKjIzgHekP3XDondvbm') {
            return '0:9bf22ed5ff643152eacfd190881c256094298a49e2a32338077a43f75c3a2776';
          }
          
          return address;
        }
        
        const expectedReceiverRaw = userFriendlyToRaw(to);
        console.log("Looking for payments to:", { 
          original: to, 
          rawFormat: expectedReceiverRaw 
        });

        // Look for recent outgoing transaction to our receiver
        const recentTx = data.events?.find(event => {
          const action = event.actions?.[0];
          if (action?.type === 'TonTransfer') {
            const transfer = action.TonTransfer;
            const recipientAddr = transfer?.recipient?.address || transfer?.recipient;
            
            // Check if recipient matches our expected address (in raw format)
            const isToReceiver = recipientAddr === expectedReceiverRaw || 
                               recipientAddr === to;
            
            const isValidAmount = parseInt(transfer?.amount || "0") >= amount;
            const isRecent = new Date(event.timestamp * 1000) > new Date(Date.now() - 10 * 60 * 1000); // 10 minutes
            
            console.log("Transaction check:", {
              recipient: recipientAddr,
              expectedReceiverRaw,
              originalTo: to,
              amount: transfer?.amount,
              timestamp: new Date(event.timestamp * 1000),
              isToReceiver,
              isValidAmount,
              isRecent
            });
            
            return isToReceiver && isValidAmount && isRecent;
          }
          return false;
        });
        
        if (recentTx) {
          return res.json({ 
            success: true, 
            message: "Payment verified successfully via txBoc",
            eventId: recentTx.event_id
          });
        }
        
        return res.json({ 
          success: false, 
          error: "No matching transaction found",
          details: "Transaction may not be indexed yet or doesn't match criteria"
        });
        
      } catch (apiError) {
        console.error("API Error for txBoc:", apiError);
        return res.status(500).json({ 
          success: false, 
          error: "Failed to fetch account transactions",
          details: apiError.message 
        });
      }
    }

    return res.status(400).json({ 
      success: false, 
      error: "Invalid request format" 
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      details: err.message 
    });
  }
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: "Endpoint not found",
    availableEndpoints: ["/", "/health", "/check-payment"]
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);
  res.status(500).json({ 
    success: false, 
    error: "Internal server error",
    details: error.message 
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/check-payment`);
});

module.exports = app;


ըստ index.html ի <!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>TON Spin Game</title>
  <script src="https://unpkg.com/@tonconnect/ui@2.0.9/dist/tonconnect-ui.min.js"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 700px;
      margin: 0 auto;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: white;
      text-align: center;
    }

    .container {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 30px;
      box-shadow: 0 8px 32px rgba(31, 38, 135, 0.37);
      border: 1px solid rgba(255, 255, 255, 0.18);
    }

    h2 { font-size: 2.5em; margin-bottom: 20px; }

    button {
      border: none;
      padding: 12px 25px;
      font-size: 16px;
      border-radius: 50px;
      cursor: pointer;
      margin: 8px;
      transition: all 0.3s ease;
    }

    button:hover:not(:disabled) {
      transform: translateY(-3px);
      box-shadow: 0 6px 20px rgba(0,0,0,0.3);
    }

    button:disabled { opacity: 0.5; cursor: not-allowed; }

    #connect-root { margin: 20px 0; }

    #spinsLeft, #userScore, #result {
      font-size: 1.2em;
      margin: 15px 0;
      padding: 10px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.1);
    }

    .loading { display: none; }
    .loading.show { display: block; }

    /* 🎡 Spin Wheel */
    .wheel-container { margin: 30px auto; position: relative; width: 300px; height: 300px; }
    .wheel {
      width: 100%; height: 100%; border-radius: 50%;
      border: 10px solid #fff;
      position: relative;
      overflow: hidden;
      transition: transform 4s cubic-bezier(0.17, 0.67, 0.83, 0.67);
    }
    .segment {
      position: absolute;
      width: 50%; height: 50%;
      background: rgba(255,255,255,0.2);
      transform-origin: 100% 100%;
      display: flex; justify-content: center; align-items: center;
      font-size: 14px; font-weight: bold;
      color: #fff; text-shadow: 1px 1px 2px black;
    }
    .arrow {
      position: absolute;
      top: -25px; left: 50%; transform: translateX(-50%);
      width: 0; height: 0;
      border-left: 20px solid transparent;
      border-right: 20px solid transparent;
      border-bottom: 40px solid red;
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>🎰 TON Spin Game</h2>
    <div id="connect-root"></div>

    <!-- Payment Packages -->
    <button class="pay-package" data-spins="1" data-amount="100000">💰 0.0001 TON = 1 Spin</button>
    <button class="pay-package" data-spins="3" data-amount="1000000000">💰 1 TON = 3 Spins</button>
    <button class="pay-package" data-spins="5" data-amount="1500000000">💰 1.5 TON = 5 Spins</button>
    <button class="pay-package" data-spins="10" data-amount="2800000000">💰 2.8 TON = 10 Spins</button>

    <div class="loading" id="loading">⏳ Processing payment...</div>

    <!-- Wheel -->
    <div class="wheel-container">
      <div class="arrow"></div>
      <div class="wheel" id="wheel"></div>
    </div>

    <button id="spinBtn" disabled>🎡 Spin Now</button>

    <div id="spinsLeft">Spins left: 0</div>
    <div id="userScore">Score: 0</div>
    <div id="result"></div>
  </div>

<script>
  const BACKEND_URL = "https://ton-check.onrender.com";
  const RECEIVER = "UQCb8i7V_2QxUurP0ZCIHCVglCmKSeKjIzgHekP3XDondvbm";

  const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: "https://haykoo707.github.io/test-payment/tonconnect-manifest.json",
    buttonRootId: "connect-root",
    uiPreferences: { theme: "SYSTEM" }
  });

  let spins = 0;
  let userScore = parseInt(localStorage.getItem("userScore")) || 0;

  const spinBtn = document.getElementById("spinBtn");
  const spinsEl = document.getElementById("spinsLeft");
  const scoreEl = document.getElementById("userScore");
  const resultEl = document.getElementById("result");
  const wheel = document.getElementById("wheel");
  const loadingEl = document.getElementById("loading");

  const rewards = [1000, 2000, 4000, 5000, 7500, 10000, 20000, 5000];

  // Build wheel segments
  function buildWheel() {
    const segmentAngle = 360 / rewards.length;
    rewards.forEach((reward, i) => {
      const segment = document.createElement("div");
      segment.className = "segment";
      segment.style.transform = `rotate(${i * segmentAngle}deg) skewY(${90 - segmentAngle}deg)`;
      segment.innerText = `+${reward}`;
      wheel.appendChild(segment);
    });
  }
  buildWheel();

  function updateUI() {
    spinsEl.innerText = `Spins left: ${spins}`;
    scoreEl.innerText = `Score: ${userScore}`;
    spinBtn.disabled = spins <= 0;
  }
  updateUI();

  function showLoading(show = true) {
    loadingEl.classList.toggle("show", show);
  }

  // Handle wallet connection
  tonConnectUI.onStatusChange(wallet => {
    document.querySelectorAll(".pay-package").forEach(btn => {
      btn.disabled = !wallet;
    });
    updateUI();
  });

  // Payment packages
  document.querySelectorAll(".pay-package").forEach(btn => {
    btn.addEventListener("click", async () => {
      const spinsToAdd = parseInt(btn.dataset.spins);
      const amount = btn.dataset.amount;
      showLoading(true);

      try {
        const tx = {
          validUntil: Math.floor(Date.now() / 1000) + 600,
          messages: [{ address: RECEIVER, amount: amount.toString() }]
        };
        const sendRes = await tonConnectUI.sendTransaction(tx);
        if (!sendRes) throw new Error("Transaction failed");

        // wait + check backend
        await new Promise(r => setTimeout(r, 3000));

        spins += spinsToAdd;
        updateUI();
        resultEl.innerText = `✅ You received ${spinsToAdd} spins!`;
      } catch (err) {
        resultEl.innerText = "❌ Payment failed: " + err.message;
      } finally {
        showLoading(false);
      }
    });
  });

  // Spin animation
  spinBtn.addEventListener("click", () => {
    if (spins <= 0) return;
    spins--;
    updateUI();

    const segmentAngle = 360 / rewards.length;
    const winningIndex = Math.floor(Math.random() * rewards.length);
    const rotation = 360 * 5 + (360 - winningIndex * segmentAngle - segmentAngle/2);

    wheel.style.transition = "transform 4s cubic-bezier(0.17,0.67,0.83,0.67)";
    wheel.style.transform = `rotate(${rotation}deg)`;

    setTimeout(() => {
      const reward = rewards[winningIndex];
      userScore += reward;
      localStorage.setItem("userScore", userScore);
      updateUI();
      resultEl.innerText = `🎉 You won +${reward} Score!`;
    }, 4200);
  });
</script>
</body>
</html>
