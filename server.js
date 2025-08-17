const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch"); // Node <18

const app = express();
app.use(cors());
app.use(express.json());

const RECEIVER = "UQBfrU75WGhBLnRpBs1ImWE5sPdxKsFMBgogpD578JxXyDbK";
const AMOUNT = 100000; // nanoTONs

// Հիմնական POST endpoint
app.post("/check-payment", async (req, res) => {
  const { txHash, txBoc, from, to, amount } = req.body;

  try {
    // Եթե ունենք hash
    if (txHash) {
      const response = await fetch(`https://tonapi.io/v1/blockchain/transactions/${txHash}`);
      const data = await response.json();
      const msg = data.in_msg;
      if (msg?.destination === RECEIVER && parseInt(msg?.value || "0") >= AMOUNT) {
        return res.json({ success: true });
      }
      return res.json({ success: false });
    }

    // Եթե ունենք BOC
    if (txBoc) {
      // TON API-ում BOC ստուգելու համար կարող ենք օգտագործել search կամ transactions
      const query = `https://tonapi.io/v1/blockchain/transactions?address=${from}&limit=5`;
      const response = await fetch(query);
      const data = await response.json();

      // Փնտրում ենք վերջին 5 transaction-ը, որը համապատասխանում է receiver + amount
      const validTx = data.transactions?.find(t =>
        t.in_msg?.destination === to &&
        parseInt(t.in_msg?.value || "0") >= amount
      );

      if (validTx) {
        return res.json({ success: true });
      } else {
        return res.json({ success: false });
      }
    }

    // Եթե ոչ hash, ոչ BOC
    return res.json({ success: false });

  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
});

app.listen(3000, () => console.log("✅ Backend running on port 3000"));
