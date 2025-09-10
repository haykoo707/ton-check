const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// TON blockchain receiver address (must match frontend)
const RECEIVER = "UQCb8i7V_2QxUurP0ZCIHCVglCmKSeKjIzgHekP3XDondvbm";
const AMOUNT = 100; // nanotons (0.0000001 TON)

app.use(cors());
app.use(bodyParser.json());

// Dummy in-memory store for user spins (in real app use DB)
const userSpins = {};

// Helper: verify payment on TON blockchain
// This is a simplified example using TON API (adjust to your blockchain provider)
async function verifyPayment({ txHash, txBoc, from, to, amount }) {
  try {
    // For example, use TON API to get transaction info by hash
    // Replace with your actual TON blockchain API endpoint
    if (!txHash) {
      return { success: false, error: "No txHash provided" };
    }

    // Example: call TON blockchain API to get transaction details
    // This is a placeholder URL, replace with real TON API endpoint
    const apiUrl = `https://toncenter.com/api/v2/getTransaction?hash=${txHash}&account=${to}&api_key=YOUR_API_KEY`;

    const resp = await axios.get(apiUrl);
    if (!resp.data || !resp.data.result) {
      return { success: false, error: "Transaction not found" };
    }

    const tx = resp.data.result;

    // Check if transaction is to the correct receiver and amount matches
    // This depends on the API response structure, adjust accordingly
    // Example check:
    if (tx.in_msg && tx.in_msg.source === from && tx.in_msg.destination === to) {
      const valueNano = parseInt(tx.in_msg.value);
      if (valueNano >= amount) {
        return { success: true };
      } else {
        return { success: false, error: "Amount too low" };
      }
    }

    return { success: false, error: "Transaction details mismatch" };
  } catch (err) {
    console.error("Error verifying payment:", err.message);
    return { success: false, error: "Error verifying payment" };
  }
}

app.post('/check-payment', async (req, res) => {
  const { txHash, txBoc, from, to, amount } = req.body;

  if (!txHash && !txBoc) {
    return res.status(400).json({ success: false, error: "Missing txHash or txBoc" });
  }
  if (!to || to !== RECEIVER) {
    return res.status(400).json({ success: false, error: "Invalid receiver address" });
  }
  if (!amount || amount < AMOUNT) {
    return res.status(400).json({ success: false, error: "Invalid amount" });
  }

  // Verify payment on blockchain
  const verification = await verifyPayment({ txHash, txBoc, from, to, amount });

  if (!verification.success) {
    return res.json({ success: false, error: verification.error || "Verification failed" });
  }

  // Here you can add logic to credit spins to user, e.g. by user address
  // For demo, just return success
  return res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`TON Spin backend listening on port ${PORT}`);
});
