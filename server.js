const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const RECEIVER = "EQCxxxxxxxxxxxxxxxx"; // քո TON wallet հասցեն
const AMOUNT = 2 * 1e9; // 2 TON in nanoTONs

app.post("/check-payment", async (req, res) => {
  const { txHash } = req.body;
  if (!txHash) return res.json({ success: false });

  try {
    const response = await fetch(`https://tonapi.io/v1/blockchain/transactions/${txHash}`);
    const data = await response.json();

    if (
      data.in_msg?.destination === RECEIVER &&
      parseInt(data.in_msg?.value || "0") >= AMOUNT
    ) {
      return res.json({ success: true });
    }

    res.json({ success: false });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

app.listen(3000, () => console.log("✅ Backend running on port 3000"));
