const fs = require('fs');
const path = require('path');

const DB_FILE = path.resolve(__dirname, 'tijarati.json');

const load = () => {
    try {
        if (!fs.existsSync(DB_FILE)) return { transactions: [], partners: [], settings: {} };
        return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
        return { transactions: [], partners: [], settings: {} };
    }
};

const save = (data) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

const db = {
    getTransactions: () => {
        const data = load();
        // Format to match API expectations (isCredit boolean etc already stored as is? JSON preserves types)
        return data.transactions;
    },
    addTransaction: (tx) => {
        const data = load();
        // Upsert
        const index = data.transactions.findIndex(t => t.id === tx.id);
        if (index > -1) data.transactions[index] = tx;
        else data.transactions.push(tx);
        save(data);
    },
    getPartners: () => load().partners,
    addPartner: (p) => {
        const data = load();
        p.id = p.id || Date.now();
        data.partners.push(p);
        save(data);
        return p.id;
    },
    deletePartner: (id) => {
        const data = load();
        data.partners = data.partners.filter(p => p.id != id);
        save(data);
    }
};

module.exports = db;
