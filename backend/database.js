const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to SQLite database
const dbPath = path.resolve(__dirname, 'tijarati.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database ' + dbPath + ': ' + err.message);
    } else {
        console.log('Connected to the SQLite database.');

        // Initialize Tables
        db.serialize(() => {
            // Transactions Table
            // Type: 'BUY' or 'SELL'
            // Amount: REAL (Float)
            // Date: ISO String
            db.run(`CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                item_name TEXT,
                quantity INTEGER DEFAULT 1,
                amount REAL NOT NULL,
                date TEXT
            )`);

            // Partners Table (For Phase 2)
            db.run(`CREATE TABLE IF NOT EXISTS partners (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                percentage REAL DEFAULT 0
            )`);
        });
    }
});

module.exports = db;
