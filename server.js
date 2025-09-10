// index.js
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const RECEIVER = "UQCb8i7V_2QxUurP0ZCIHCVglCmKSeKjIzgHekP3XDondvbm";
const AMOUNT = 100; // nanotons

// POST /check-payment
app.post("/check-payment", async (req, res) => {
  try {
    const { txHash, from } = req.body;

    if (!txHash || !from) {
      return res.status(400).json({ success: false, error: "Missing txHash or from" });
    }

    // Fetch last 20 transactions for RECEIVER from tonapi.io
    const url = `https://tonapi.io/v2/blockchain/accounts/${RECEIVER}/transactions?limit=20`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (!data.transactions) {
      return res.json({ success: false, error: "No transactions found" });
    }

    // Check if transaction exists
    for (const tx of data.transactions) {
      const txId = tx.hash;
      const inMsg = tx.in_msg;
      if (!inMsg) continue;

      const source = inMsg.source?.address;
      const value = parseInt(inMsg.value || "0");

      if (txId === txHash && source === from && value >= AMOUNT) {
        return res.json({ success: true });
      }
    }

    return res.json({ success: false, error: "Transaction not found or invalid" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
