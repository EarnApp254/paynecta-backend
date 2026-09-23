import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

import { initializeApp, cert } from "firebase-admin/app";
import {
    getFirestore,
    FieldValue
} from "firebase-admin/firestore";

import { getAuth } from "firebase-admin/auth";

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
const firebaseAuth = getAuth(firebaseApp);

// ==========================
// EXPRESS APP
// ==========================

const app = express();

app.use(cors());

// IMPORTANT:
// Paystack webhook needs the RAW request body.
// Therefore this route must come BEFORE express.json().
app.post(
    "/paystack/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {

        try {

            const signature =
                req.headers["x-paystack-signature"];

            if (!signature) {
                return res.status(401).send("Missing signature");
            }

            const hash = crypto
                .createHmac(
                    "sha512",
                    process.env.PAYSTACK_SECRET_KEY
                )
                .update(req.body)
                .digest("hex");

            if (hash !== signature) {
                return res.status(401).send("Invalid signature");
            }

            const event = JSON.parse(req.body.toString());

            console.log("PAYSTACK WEBHOOK:", event.event);

            // ==========================
            // TRANSFER SUCCESS
            // ==========================

            if (event.event === "transfer.success") {

                const transfer = event.data;

                const reference =
                    transfer.reference;

                const withdrawalRef =
                    firestore
                        .collection("withdrawals")
                        .doc(reference);

                await firestore.runTransaction(
                    async (transaction) => {

                        const withdrawalSnap =
                            await transaction.get(
                                withdrawalRef
                            );

                        if (!withdrawalSnap.exists) {
                            return;
                        }

                        const withdrawal =
                            withdrawalSnap.data();

                        // Already finalized
                        if (
                            withdrawal.status === "successful"
                        ) {
                            return;
                        }

                        transaction.update(
                            withdrawalRef,
                            {
                                status: "successful",
                                transferCode:
                                    transfer.transfer_code || null,
                                completedAt:
                                    FieldValue.serverTimestamp()
                            }
                        );

                    }
                );
            }

            // ==========================
            // TRANSFER FAILED
            // ==========================

            else if (event.event === "transfer.failed") {

                await refundFailedWithdrawal(
                    event.data
                );

            }

            // ==========================
            // TRANSFER REVERSED
            // ==========================

            else if (event.event === "transfer.reversed") {

                await refundFailedWithdrawal(
                    event.data
                );

            }

            return res.sendStatus(200);

        } catch (error) {

            console.error(
                "WEBHOOK ERROR:",
                error
            );

            return res.sendStatus(500);
        }

    }
);

// ==========================
// NORMAL JSON BODY
// ==========================

app.use(express.json());

// ==========================
// HOME
// ==========================

app.get("/", (req, res) => {

    res.send(
        "MEGASTAKE Paystack Backend Running"
    );

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

        const {
            phone,
            amount,
            email
        } = req.body;

        if (!phone || !amount || !email) {

            return res.status(400).json({
                status: false,
                message: "Missing required fields"
            });

        }

        const response = await fetch(
            "https://api.paystack.co/charge",
            {
                method: "POST",

                headers: {
                    Authorization:
                        `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({

                    email,

                    amount:
                        Math.round(Number(amount) * 100),

                    mobile_money: {
                        phone,
                        provider: "mpesa"
                    }

                })
            }
        );

        const data =
            await response.json();

        console.log(
            "STK RESPONSE:",
            data
        );

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

app.get(
    "/verify/:reference",
    async (req, res) => {

        try {

            const response = await fetch(
                `https://api.paystack.co/transaction/verify/${req.params.reference}`,
                {
                    headers: {
                        Authorization:
                            `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
                    }
                }
            );

            const data =
                await response.json();

            console.log(
                "VERIFY RESPONSE:",
                data
            );

            res.json(data);

        } catch (error) {

            console.error(error);

            res.status(500).json({
                status: false,
                message: error.message
            });

        }

    }
);

// ==================================================
// WITHDRAW
// ==================================================

app.post(
    "/withdraw",
    async (req, res) => {

        try {

            // ==========================
            // AUTHENTICATE FIREBASE USER
            // ==========================

            const authHeader =
                req.headers.authorization || "";

            if (
                !authHeader.startsWith(
                    "Bearer "
                )
            ) {

                return res.status(401).json({
                    status: false,
                    message:
                        "Authentication required"
                });

            }

            const idToken =
                authHeader.split("Bearer ")[1];

            const decodedToken =
                await firebaseAuth.verifyIdToken(
                    idToken
                );

            const uid =
                decodedToken.uid;

            // ==========================
            // VALIDATE AMOUNT
            // ==========================

            const amount =
                Number(req.body.amount);

            if (
                !Number.isFinite(amount) ||
                !Number.isInteger(amount)
            ) {

                return res.status(400).json({
                    status: false,
                    message:
                        "Invalid withdrawal amount"
                });

            }

            if (amount < 100) {

                return res.status(400).json({
                    status: false,
                    message:
                        "Minimum withdrawal is KSH 100"
                });

            }

            if (amount > 150000) {

                return res.status(400).json({
                    status: false,
                    message:
                        "Maximum withdrawal is KSH 150,000"
                });

            }

            // ==========================
            // GET USER
            // ==========================

            const userRef =
                firestore
                    .collection("users")
                    .doc(uid);

            const userSnap =
                await userRef.get();

            if (!userSnap.exists) {

                return res.status(404).json({
                    status: false,
                    message:
                        "User account not found"
                });

            }

            const userData =
                userSnap.data();

            // ==========================
            // PHONE
            // ==========================

            let phone =
                String(
                    userData.phone || ""
                ).trim();

            if (!phone) {

                return res.status(400).json({
                    status: false,
                    message:
                        "No M-PESA phone number found"
                });

            }

            if (phone.startsWith("+254")) {
                phone =
                    phone.substring(1);
            }

            if (phone.startsWith("254")) {
                phone =
                    "0" + phone.substring(3);
            }

            if (
                !/^07\d{8}$/.test(phone) &&
                !/^01\d{8}$/.test(phone)
            ) {

                return res.status(400).json({
                    status: false,
                    message:
                        "Invalid M-PESA phone number"
                });

            }

            // ==========================
            // CREATE UNIQUE REFERENCE
            // ==========================

            const reference =
                `wd_${crypto.randomUUID()}`;

            const withdrawalRef =
                firestore
                    .collection("withdrawals")
                    .doc(reference);

            // ==========================
            // RESERVE / DEDUCT BALANCE
            // ==========================

            await firestore.runTransaction(
                async (transaction) => {

                    const freshUserSnap =
                        await transaction.get(
                            userRef
                        );

                    if (!freshUserSnap.exists) {

                        throw new Error(
                            "USER_NOT_FOUND"
                        );

                    }

                    const freshUser =
                        freshUserSnap.data();

                    const balance =
                        Number(
                            freshUser.balance || 0
                        );

                    if (balance < amount) {

                        throw new Error(
                            "INSUFFICIENT_BALANCE"
                        );

                    }

                    transaction.update(
                        userRef,
                        {
                            balance:
                                balance - amount
                        }
                    );

                    transaction.set(
                        withdrawalRef,
                        {
                            uid,
                            phone,
                            amount,
                            currency: "KES",
                            reference,
                            status: "pending",
                            balanceDeducted: true,
                            refunded: false,
                            createdAt:
                                FieldValue.serverTimestamp()
                        }
                    );

                }
            );

            // ==========================
            // CREATE PAYSTACK RECIPIENT
            // ==========================

            const recipientResponse =
                await fetch(
                    "https://api.paystack.co/transferrecipient",
                    {
                        method: "POST",

                        headers: {
                            Authorization:
                                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            type:
                                "mobile_money",

                            name:
                                userData.name ||
                                phone,

                            account_number:
                                phone,

                            bank_code:
                                "MPESA",

                            currency:
                                "KES"

                        })
                    }
                );

            const recipientData =
                await recipientResponse.json();

            console.log(
                "RECIPIENT RESPONSE:",
                recipientData
            );

            if (
                !recipientResponse.ok ||
                !recipientData.status ||
                !recipientData.data?.recipient_code
            ) {

                await refundWithdrawal(
                    reference
                );

                return res.status(400).json({
                    status: false,
                    message:
                        recipientData.message ||
                        "Could not create M-PESA recipient"
                });

            }

            const recipientCode =
                recipientData.data.recipient_code;

            // ==========================
            // UPDATE WITHDRAWAL
            // ==========================

            await withdrawalRef.update({

                recipientCode,

                status:
                    "processing"

            });

            // ==========================
            // SEND PAYSTACK TRANSFER
            // ==========================

            const transferResponse =
                await fetch(
                    "https://api.paystack.co/transfer",
                    {
                        method: "POST",

                        headers: {
                            Authorization:
                                `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            source:
                                "balance",

                            amount:
                                amount * 100,

                            recipient:
                                recipientCode,

                            reference,

                            reason:
                                `Withdrawal for user ${uid}`

                        })
                    }
                );

            const transferData =
                await transferResponse.json();

            console.log(
                "TRANSFER RESPONSE:",
                transferData
            );

            if (
                !transferResponse.ok ||
                !transferData.status
            ) {

                await refundWithdrawal(
                    reference
                );

                return res.status(400).json({
                    status: false,
                    message:
                        transferData.message ||
                        "Transfer could not be initiated"
                });

            }

            await withdrawalRef.update({

                status:
                    "processing",

                transferCode:
                    transferData.data?.transfer_code ||
                    null

            });

            // IMPORTANT:
            // Do NOT call this successful yet.
            // Paystack webhook will finalize it.

            return res.json({

                status: true,

                message:
                    "Withdrawal is being processed",

                reference,

                transferCode:
                    transferData.data?.transfer_code ||
                    null

            });

        } catch (error) {

            console.error(
                "WITHDRAW ERROR:",
                error
            );

            if (
                error.message ===
                "INSUFFICIENT_BALANCE"
            ) {

                return res.status(400).json({
                    status: false,
                    message:
                        "Insufficient balance"
                });

            }

            if (
                error.message ===
                "USER_NOT_FOUND"
            ) {

                return res.status(404).json({
                    status: false,
                    message:
                        "User account not found"
                });

            }

            return res.status(500).json({
                status: false,
                message:
                    "Withdrawal failed"
            });

        }

    }
);

// ==================================================
// REFUND WITHDRAWAL
// ==================================================

async function refundWithdrawal(
    reference
) {

    const withdrawalRef =
        firestore
            .collection("withdrawals")
            .doc(reference);

    await firestore.runTransaction(
        async (transaction) => {

            const withdrawalSnap =
                await transaction.get(
                    withdrawalRef
                );

            if (!withdrawalSnap.exists) {
                return;
            }

            const withdrawal =
                withdrawalSnap.data();

            if (
                withdrawal.refunded === true
            ) {
                return;
            }

            const userRef =
                firestore
                    .collection("users")
                    .doc(
                        withdrawal.uid
                    );

            const userSnap =
                await transaction.get(
                    userRef
                );

            if (!userSnap.exists) {
                return;
            }

            const currentBalance =
                Number(
                    userSnap.data().balance ||
                    0
                );

            transaction.update(
                userRef,
                {
                    balance:
                        currentBalance +
                        Number(
                            withdrawal.amount
                        )
                }
            );

            transaction.update(
                withdrawalRef,
                {
                    status:
                        "failed",

                    refunded:
                        true,

                    failedAt:
                        FieldValue.serverTimestamp()
                }
            );

        }
    );

}

// ==================================================
// REFUND FAILED / REVERSED TRANSFER
// ==================================================

async function refundFailedWithdrawal(
    transfer
) {

    if (!transfer?.reference) {
        return;
    }

    await refundWithdrawal(
        transfer.reference
    );

}

// ==================================================
// START SERVER
// ==================================================

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {

        console.log(
            `Server running on port ${PORT}`
        );

    }
);