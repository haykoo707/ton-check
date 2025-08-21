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
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://ton-check.onrender.com'
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

const RECEIVER = "UQBfrU75WGhBLnRpBs1ImWE5sPdxKsFMBgogpD578JxXyDbK";

// Package configurations that match your HTML
const PACKAGES = {
  "10000": { spins: 1, name: "0.00001 TON = 1 Spin" },
  "1000000000": { spins: 3, name: "1 TON = 3 Spins" },
  "1500000000": { spins: 5, name: "1.5 TON = 5 Spins" },
  "2800000000": { spins: 10, name: "2.8 TON = 10 Spins" }
};

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({ 
    message: "TON Spin Game Payment Verification API",
    endpoints: ["/health", "/check-payment", "/verify-transaction"],
    version: "2.0.0",
    receiver: RECEIVER,
    packages: PACKAGES
  });
});

// Main payment verification endpoint
app.post("/check-payment", async (req, res) => {
  const { txHash, txBoc, senderAddress, amount } = req.body;
  
  console.log("Payment check request:", { 
    txHash: !!txHash, 
    txBoc: !!txBoc, 
    senderAddress, 
    amount 
  });

  try {
    // Validate input
    if (!txHash && !senderAddress) {
      return res.status(400).json({ 
        success: false, 
        error: "Either txHash or senderAddress is required" 
      });
    }

    let isValidPayment = false;
    let spinsEarned = 0;
    let packageName = "";
    let txDetails = null;

    if (txHash) {
      // Method 1: Direct transaction verification by hash
      console.log("Verifying payment by txHash:", txHash);
      
      try {
        const response = await fetch(`https://tonapi.io/v2/blockchain/transactions/${txHash}`, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error(`TonAPI responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log("Transaction data:", JSON.stringify(data, null, 2));
        
        // Check transaction validity
        const msg = data.in_msg;
        if (!msg) {
          return res.json({ 
            success: false, 
            error: "Invalid transaction format - no input message found" 
          });
        }

        const destination = msg.destination?.address || msg.destination;
        const value = parseInt(msg.value || "0");
        
        console.log("Transaction details:", {
          destination,
          expectedReceiver: RECEIVER,
          value,
          valueInTON: value / 1000000000
        });

        // Check if payment goes to correct receiver
        if (destination === RECEIVER) {
          // Find matching package
          const package = Object.entries(PACKAGES).find(([packageAmount, _]) => {
            return value >= parseInt(packageAmount);
          });

          if (package) {
            isValidPayment = true;
            spinsEarned = package[1].spins;
            packageName = package[1].name;
            txDetails = {
              hash: txHash,
              from: msg.source?.address || msg.source,
              to: destination,
              amount: value,
              amountTON: (value / 1000000000).toFixed(4)
            };
          }
        }

      } catch (apiError) {
        console.error("TonAPI Error:", apiError);
        return res.status(500).json({ 
          success: false, 
          error: "Failed to fetch transaction data from TonAPI",
          details: apiError.message 
        });
      }
    } else if (senderAddress) {
      // Method 2: Check recent transactions from sender address
      console.log("Checking recent transactions from address:", senderAddress);
      
      try {
        // Wait a bit for transaction to be indexed
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const response = await fetch(`https://tonapi.io/v2/accounts/${senderAddress}/events?limit=20`, {
          headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error(`TonAPI responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log("Account events found:", data.events?.length || 0);
        
        // Look for recent outgoing transactions to our receiver
        const recentPayment = data.events?.find(event => {
          const action = event.actions?.[0];
          if (action?.type === 'TonTransfer') {
            const transfer = action.TonTransfer;
            const recipientAddr = transfer?.recipient?.address;
            const transferAmount = parseInt(transfer?.amount || "0");
            
            // Check if this is a payment to our receiver within last 10 minutes
            const isToReceiver = recipientAddr === RECEIVER;
            const isRecent = new Date(event.timestamp * 1000) > new Date(Date.now() - 10 * 60 * 1000);
            
            console.log("Checking transaction:", {
              recipient: recipientAddr,
              amount: transferAmount,
              timestamp: new Date(event.timestamp * 1000),
              isToReceiver,
              isRecent
            });
            
            if (isToReceiver && isRecent) {
              // Find matching package
              const package = Object.entries(PACKAGES).find(([packageAmount, _]) => {
                return transferAmount >= parseInt(packageAmount);
              });

              if (package) {
                spinsEarned = package[1].spins;
                packageName = package[1].name;
                txDetails = {
                  eventId: event.event_id,
                  from: senderAddress,
                  to: recipientAddr,
                  amount: transferAmount,
                  amountTON: (transferAmount / 1000000000).toFixed(4),
                  timestamp: new Date(event.timestamp * 1000)
                };
                return true;
              }
            }
          }
          return false;
        });
        
        if (recentPayment) {
          isValidPayment = true;
        }
        
      } catch (apiError) {
        console.error("TonAPI Error for address check:", apiError);
        return res.status(500).json({ 
          success: false, 
          error: "Failed to fetch account transactions from TonAPI",
          details: apiError.message 
        });
      }
    }

    if (isValidPayment) {
      return res.json({ 
        success: true, 
        message: "Payment verified successfully!",
        spins: spinsEarned,
        package: packageName,
        transaction: txDetails
      });
    } else {
      return res.json({ 
        success: false, 
        error: "No valid payment found",
        message: "Either transaction not found, amount insufficient, or payment not to correct receiver",
        expectedReceiver: RECEIVER,
        availablePackages: PACKAGES
      });
    }

  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ 
      success: false, 
      error: "Internal server error",
      details: err.message 
    });
  }
});

// Alternative endpoint for transaction verification (backward compatibility)
app.post("/verify-transaction", async (req, res) => {
  return app.post("/check-payment")(req, res);
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: "Endpoint not found",
    availableEndpoints: ["/", "/health", "/check-payment", "/verify-transaction"]
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
  console.log(`✅ TON Spin Game Backend running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/check-payment`);
  console.log(`🎰 Receiver address: ${RECEIVER}`);
  console.log(`💰 Available packages:`, PACKAGES);
});

module.exports = app;
