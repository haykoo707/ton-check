const express = require("express");
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
      'https://hayinvest.github.io',
      'https://hayinvest.github.io/',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://ton-check.onrender.com'
    ];
    
    // Check if origin is allowed
    if (allowedOrigins.some(allowedOrigin => origin.startsWith(allowedOrigin))) {
      return callback(null, true);
    }
    
    console.log('CORS blocked origin:', origin);
    return callback(null, false); // Properly block non-allowed origins
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
  
  console.log("Payment check request:", { 
    txHash: !!txHash, 
    txHashValue: txHash,
    txBoc: !!txBoc, 
    from, 
    to, 
    amount,
    fullBody: req.body
  });

  try {
    // Validate input - ավելի մանրակրկիտ ստուգում
    if ((!txHash || txHash === null || txHash === '') && (!txBoc || txBoc === null || txBoc === '')) {
      return res.status(400).json({ 
        success: false, 
        error: "Either txHash or txBoc is required",
        received: { txHash, txBoc, from, to, amount }
      });
    }

    if (txHash && txHash !== null && txHash !== '') {
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

    if (txBoc && txBoc !== null && txBoc !== '') {
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
      error: "Invalid request format - no valid txHash or txBoc provided",
      received: { txHash, txBoc }
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

// Render.com-ը պահանջում է որ server-ը listen անի process.env.PORT-ին
const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => { // ← Ավելացնել '0.0.0.0' host
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/check-payment`);
});

module.exports = app;
