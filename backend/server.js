const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Middleware to log requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// --- ROUTES ---

// 1. BUY (Purchase)
app.post('/api/buy', (req, res) => {
    const { itemName, quantity, price, date } = req.body;
    if (!price) {
        return res.status(400).json({ error: "Price is required" });
    }

    const sql = `INSERT INTO transactions (type, item_name, quantity, amount, date) VALUES (?, ?, ?, ?, ?)`;
    const params = ['BUY', itemName || 'Unknown', quantity || 1, price, date || new Date().toISOString()];

    db.run(sql, params, function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, message: "Purchase recorded" });
    });
});

// 2. SELL (Sale)
app.post('/api/sell', (req, res) => {
    const { itemName, quantity, price, date } = req.body;
    if (!price) {
        return res.status(400).json({ error: "Price is required" });
    }

    const sql = `INSERT INTO transactions (type, item_name, quantity, amount, date) VALUES (?, ?, ?, ?, ?)`;
    const params = ['SELL', itemName || 'Unknown', quantity || 1, price, date || new Date().toISOString()];

    db.run(sql, params, function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, message: "Sale recorded" });
    });
});

// 3. DASHBOARD SUMMARY
app.get('/api/summary', (req, res) => {
    // Basic summary: Total In, Total Out, Profit (for today)
    // Note: For simplicity in this MVP, we might return all-time or filter by date in SQL.
    // Let's do "Today" by default if requested, or just all-time for now to start simple.

    // We'll return all-time totals for now to check basic connectivity
    const sql = `
        SELECT 
            SUM(CASE WHEN type = 'SELL' THEN amount ELSE 0 END) as total_in,
            SUM(CASE WHEN type = 'BUY' THEN amount ELSE 0 END) as total_out
        FROM transactions
    `;

    db.get(sql, [], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const totalIn = row.total_in || 0;
        const totalOut = row.total_out || 0;
        const profit = totalIn - totalOut;
        res.json({ totalIn, totalOut, profit });
    });
});

// 4. TRANSACTIONS LIST (Optional for history)
app.get('/api/transactions', (req, res) => {
    const sql = `SELECT * FROM transactions ORDER BY date DESC LIMIT 50`;
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ data: rows });
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
