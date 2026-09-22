import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config();

// ==========================
// FIREBASE ADMIN
// ==========================

const firebaseApp = initializeApp({
    credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
});

const firestore = getFirestore(firebaseApp);

// ==========================
// EXPRESS APP
// ==========================

const app = express();

app.use(cors());
app.use(express.json());

// ==========================
// HOME
// ==========================

app.get("/", (req, res) => {
    res.send("MEGASTAKE Paystack Backend Running");
});

// ==========================
// HEALTH CHECK
// ==========================

app.get("/health", (req, res) => {
    res.json({
        status: true,
        message: "Backend is working"
    });
});

// ==========================
// FIREBASE TEST
// ==========================

app.get("/firebase-test", async (req, res) => {

    try {

        const snap = await firestore
            .collection("users")
            .limit(1)
            .get();

        res.json({
            success: true,
            count: snap.size
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });

    }

});

// ==========================
// STK PUSH
// ==========================

app.post("/stkpush", async (req, res) => {

    try {

        const { phone, amount, email } = req.body;

        const response = await fetch(
            "https://api.paystack.co/charge",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email,
                    amount: amount * 100,
                    mobile_money: {
                        phone,
                        provider: "mpesa"
                    }
                })
            }
        );

        const data = await response.json();

        console.log("STK RESPONSE:", data);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            status: false,
            message: error.message
        });

    }

});

// ==========================
// VERIFY PAYMENT
// ==========================

app.get("/verify/:reference", async (req, res) => {

    try {

        const response = await fetch(
            `https://api.paystack.co/transaction/verify/${req.params.reference}`,
            {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
                }
            }
        );

        const data = await response.json();

        console.log("VERIFY RESPONSE:", data);

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            status: false,
            message: error.message
        });

    }

});

// ==========================
// START SERVER
// ==========================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});