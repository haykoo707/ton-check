const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // Node < 18 համար

const app = express();
app.use(cors());
app.use(express.json());

const RECEIVER = "UQBfrU75WGhBLnRpBs1ImWE5sPdxKsFMBgogpD578JxXyDbK"; // քո TON wallet հասցեն
const AMOUNT = 100000; // frontend-ի 0.0001 TON nanoTON

app.post("/check-payment", async (req, res) => {
  const { txHash } = req.body;
  if (!txHash) return res.json({ success: false });

  try {
    const response = await fetch(`https://tonapi.io/v1/blockchain/transactions/${txHash}`);
    const data = await response.json();

    // Պроверяем, եթե transaction-ը ճիշտ հասցե ուղարկվել է և գումարը բավարար է
    const msg = data.in_msg;
    if (msg?.destination === RECEIVER && parseInt(msg?.value || "0") >= AMOUNT) {
      return res.json({ success: true });
    }

    return res.json({ success: false });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
});

app.listen(3000, () => console.log("✅ Backend running on port 3000"));
