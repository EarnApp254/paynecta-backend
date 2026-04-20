require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();

app.use(express.json());
app.use(cors());

// ======================
// TEST ROUTE
// ======================
app.get("/", (req, res) => {
    res.send("Backend is running 🚀");
});

// ======================
// PAYNECTA KEYS (DIRECTLY ADDED)
// ======================
const PAYNECTA_API_KEY = "hmp_jf4l9FqKl3VC8qlQ5RASDIXVqe6oCZCTbjKC8nsa";
const PAYNECTA_PUBLISHABLE_KEY = "ISPubKey_live_2f1fbe1d-3f94-4456-87e3-22e8c4e2012c";

// ======================
// PAY (STK PUSH)
// ======================
app.post("/pay", async (req, res) => {
    const { phone } = req.body;

    // Validate Kenyan number
    if (!/^254[71]\d{8}$/.test(phone)) {
        return res.status(400).json({
            success: false,
            message: "Invalid phone number"
        });
    }

    const amount = 200;

    try {
        const response = await axios.post(
            "https://api.paynecta.com/stkpush",
            {
                phone: phone,
                amount: amount,
                account_reference: "EARN_APP",
                transaction_desc: "Website Payment",
                callback_url: "https://backed-1-vbvl.onrender.com"
            },
            {
                headers: {
                    Authorization: `Bearer ${hmp_jf4l9FqKl3VC8qlQ5RASDIXVqe6oCZCTbjKC8nsa}`,
                    "Content-Type": "application/json",
                    "ISPubKey_live_2f1fbe1d-3f94-4456-87e3-22e8c4e2012c ":PAYNECTA_PUBLISHABLE_KEY
                }
            }
        );

        console.log("STK Push sent ✔");

        res.json({
            success: true,
            message: "Check your phone for M-Pesa popup 📱"
        });

    } catch (error) {
        console.log("PAYNECTA ERROR:", error.response?.data || error.message);

        res.status(500).json({
            success: false,
            message: "Payment failed"
        });
    }
});

// ======================
// WEBHOOK
// ======================
app.post("/webhook/paynecta", (req, res) => {
    const event = req.body.event;
    const data = req.body.data;

    console.log("Webhook event:", event);
    console.log("Data:", data);

    if (event === "payment.success") {
        console.log("✅ Payment Successful");
    }

    if (event === "payment.failed") {
        console.log("❌ Payment Failed");
    }

    res.sendStatus(200);
});

// ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log("Server running on port", PORT);
});