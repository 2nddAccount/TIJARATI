const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'tijarati.db');
const db = new Database(dbPath);

console.log('Connected to SQLite database at', dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL, -- 'sale' or 'purchase'
    item TEXT NOT NULL,
    amount REAL NOT NULL,
    quantity REAL DEFAULT 1,
    date TEXT NOT NULL,
    isCredit INTEGER DEFAULT 0, -- boolean (0 or 1)
    clientName TEXT,
    paidAmount REAL,
    isFullyPaid INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'MAD',
    synced INTEGER DEFAULT 1, -- For potential sync logic later
    createdAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    percent REAL NOT NULL,
    createdAt INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

module.exports = db;
