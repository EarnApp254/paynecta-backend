import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("MEGASTAKE Paystack Backend Running");
});

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

        res.json(data);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            status: false,
            message: error.message
        });

    }

});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});



app.get("/health", (req, res) => {
    res.json({
        status: true,
        message: "Backend is working"
    });
});