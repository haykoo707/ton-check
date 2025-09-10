// server.js (updated)
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");

const app = express();

// Allowed frontends (add/remove as needed)
const ALLOWED_ORIGINS = [
  'https://haykoo707.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://ton-check.onrender.com'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow non-browser requests (curl/postman)
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    // fallback: allow dev by hostname match (optional)
    // if (origin.includes('github.io')) return callback(null, true);
    return callback(new Error('Not allowed by CORS: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  if (req.method === 'POST') {
    try { console.log('Body:', JSON.stringify(req.body, null, 2)); } catch(e){ console.log('Body (raw):', req.body); }
  }
  next();
});

const RECEIVER = "UQCb8i7V_2QxUurP0ZCIHCVglCmKSeKjIzgHekP3XDondvbm"; // user-friendly
// raw / workchain form (if you have it) — helps matching
const RECEIVER_RAW = "0:9bf22ed5ff643152eacfd190881c256094298a49e2a32338077a43f75c3a2776";

const AMOUNT_NANO = BigInt(100); // expected minimum (in nanotons)

// helpers
const safeToString = v => (v === undefined || v === null) ? "" : String(v);

function parseToBigInt(value) {
  if (value === undefined || value === null) return 0n;
  if (typeof value === 'bigint') return value;
  // extract digits (works if value like "100" or "1000" or "0.0001" etc)
  const s = String(value);
  // if it's pure digits, just BigInt
  const pureDigits = s.match(/-?\d+/g);
  if (!pureDigits) return 0n;
  // join all number parts (this is conservative)
  return BigInt(pureDigits.join(''));
}

function collectPossibleMsgs(txData) {
  const msgs = [];
  if (!txData) return msgs;
  // common fields returned by different explorers/providers
  if (txData.in_msg) msgs.push(txData.in_msg);
  if (txData.in_message) msgs.push(txData.in_message);
  if (Array.isArray(txData.messages)) msgs.push(...txData.messages);
  if (Array.isArray(txData.msgs)) msgs.push(...txData.msgs);
  if (txData.transaction) {
    if (txData.transaction.in_message) msgs.push(txData.transaction.in_message);
    if (Array.isArray(txData.transaction.messages)) msgs.push(...txData.transaction.messages);
  }
  if (txData.tx && txData.tx.in_msg) msgs.push(txData.tx.in_msg);
  // Include top-level fields that might represent a simple message
  if (txData.destination || txData.dst || txData.to) msgs.push(txData);
  return msgs.filter(Boolean);
}

async function fetchTxFromTonApi(txHash) {
  const urls = [
    `https://tonapi.io/v2/blockchain/transactions/${txHash}`,
    `https://tonapi.io/v1/blockchain/transactions/${txHash}`
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' }});
      if (!resp.ok) {
        console.warn('tonapi fetch not ok', url, resp.status);
        continue;
      }
      const json = await resp.json();
      return json;
    } catch (e) {
      console.error('fetchTxFromTonApi error for', url, e.message);
    }
  }
  throw new Error('All tonapi endpoints failed');
}

app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
  res.json({
    message: "TON Payment Verification API",
    endpoints: ["/health", "/check-payment"],
    version: "1.0.0"
  });
});

app.post("/check-payment", async (req, res) => {
  try {
    const { txHash, txBoc, from, to, amount } = req.body || {};
    console.log('Check payment request received', { txHash: !!txHash, txBoc: !!txBoc, from, to, amount });

    if (!txHash && !txBoc) {
      return res.status(400).json({ success: false, error: "Either txHash or txBoc is required" });
    }

    // Normalize expected receiver and amount
    const expectedAmount = amount ? BigInt(amount) : AMOUNT_NANO;
    const expectedTo = to || RECEIVER;

    // ---------- Case: txHash ----------
    if (txHash) {
      try {
        const data = await fetchTxFromTonApi(txHash);
        console.log('tonapi transaction raw response:', JSON.stringify(data).slice(0, 2000)); // trim large logs

        const msgs = collectPossibleMsgs(data);
        console.log('Collected candidate messages count:', msgs.length);

        for (const m of msgs) {
          // possible fields for dest and value
          const dest = safeToString(m.destination || m.dst || m.to || m?.destination?.address || m?.dst?.address || "");
          const valCandidate = m.value || m.amount || m?.value?.amount || m?.withdraw || m?.valueNano || m?.msg_amount;
          const value = parseToBigInt(valCandidate);

          console.log('Checking msg => dest:', dest, 'value:', value.toString());

          const matchesReceiver = dest === expectedTo || dest === RECEIVER_RAW || dest === RECEIVER || dest.includes(RECEIVER_RAW) || dest.includes(RECEIVER);
          if (matchesReceiver && value >= expectedAmount) {
            return res.json({
              success: true,
              message: "Payment verified successfully",
              txHash,
              details: { dest, value: value.toString(), expectedAmount: expectedAmount.toString() }
            });
          }
        }

        return res.json({
          success: false,
          error: "Payment validation failed",
          details: { note: 'No matching message found in tx', txHash }
        });

      } catch (apiErr) {
        console.error('Error fetching/parsing txHash:', apiErr);
        return res.status(500).json({ success: false, error: "Failed to fetch/parse transaction", details: apiErr.message });
      }
    }

    // ---------- Case: txBoc (we'll look at account events) ----------
    if (txBoc) {
      if (!from || !to) {
        return res.status(400).json({ success: false, error: "from and to required when using txBoc" });
      }

      // small delay to allow indexing
      await new Promise(r => setTimeout(r, 2000));

      try {
        const query = `https://tonapi.io/v2/accounts/${from}/events?limit=20`;
        const resp = await fetch(query, { headers: { 'Accept': 'application/json' }});
        if (!resp.ok) throw new Error('Events fetch failed: ' + resp.status);
        const evtData = await resp.json();
        console.log('Account events returned:', JSON.stringify(evtData).slice(0,2000));

        const events = evtData.events || [];
        const expectedReceiverRaw = RECEIVER_RAW; // if you have mapping, use it

        for (const e of events) {
          const actions = e.actions || [];
          for (const a of actions) {
            // check multiple shapes
            const type = a.type || a.actionType || '';
            // TonTransfer shape
            const tonTransfer = a.TonTransfer || a.TonTransferEvent || a.transfer || a.TonTransfer;
            if (tonTransfer) {
              const recipient = safeToString(tonTransfer?.recipient?.address || tonTransfer?.recipient || tonTransfer?.to || '');
              const amountVal = parseToBigInt(tonTransfer?.amount || tonTransfer?.value || tonTransfer?.amountNano);
              const ts = e.timestamp ? new Date(e.timestamp * 1000) : null;
              const isRecent = !ts || ts > new Date(Date.now() - 10 * 60 * 1000);
              console.log('Event check', { recipient, amountVal: amountVal.toString(), isRecent });
              if ((recipient === expectedTo || recipient === expectedReceiverRaw || recipient.includes(expectedReceiverRaw)) && amountVal >= expectedAmount && isRecent) {
                return res.json({ success: true, message: "Payment verified successfully via txBoc", event: e });
              }
            }
            // Other possible shapes: action.type === 'message' etc
            if (a.type === 'TonTransfer' && a.TonTransfer) {
              // already handled above
            }
          }
        }

        return res.json({ success: false, error: "No matching transaction found in account events" });

      } catch (errEvt) {
        console.error('Error checking txBoc events:', errEvt);
        return res.status(500).json({ success: false, error: "Failed to fetch account events", details: errEvt.message });
      }
    }

    return res.status(400).json({ success: false, error: "Invalid request format" });

  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ success: false, error: "Internal server error", details: err.message });
  }
});

// 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    availableEndpoints: ["/", "/health", "/check-payment"]
  });
});

// global error handler
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);
  res.status(500).json({ success: false, error: "Internal server error", details: error.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on port ${PORT}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`📡 API endpoint: http://localhost:${PORT}/check-payment`);
});

module.exports = app;
