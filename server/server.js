const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./json-db');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('../public'));

// ================= API ROUTES =================

// Check Status
app.get('/api/status', (req, res) => {
    res.json({ status: 'online', time: new Date().toISOString() });
});

// --- TRANSACTIONS ---
app.get('/api/transactions', (req, res) => {
    try {
        const transactions = db.getTransactions();
        // Sort by date desc
        transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/transactions', (req, res) => {
    try {
        const tx = req.body;
        if (!tx.id || !tx.item || !tx.amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        db.addTransaction(tx);
        res.json({ success: true, id: tx.id });
    } catch (error) {
        console.error('Insert Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- PARTNERS ---
app.get('/api/partners', (req, res) => {
    try {
        const partners = db.getPartners();
        res.json(partners);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/partners', (req, res) => {
    try {
        const { name, percent } = req.body;
        const id = db.addPartner({ name, percent, createdAt: Date.now() });
        res.json({ success: true, id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/partners/:id', (req, res) => {
    try {
        db.deletePartner(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Tijarati Server running on http://localhost:${PORT}`);
});
