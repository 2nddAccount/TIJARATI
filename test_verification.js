const assert = (condition, msg) => {
    if (!condition) { console.error('❌ ' + msg); process.exit(1); }
    else console.log('✅ ' + msg);
};

(async () => {
    const BASE = 'http://localhost:3000/api';
    console.log('Testing API at ' + BASE);

    // 1. Status
    try {
        const r1 = await fetch(BASE + '/status');
        const d1 = await r1.json();
        assert(d1.status === 'online', 'Server is online');
    } catch (e) {
        console.error('❌ Server not reachable. Is it running? ' + e.message);
        process.exit(1);
    }

    // 2. Add Transaction
    const id = 'test_' + Date.now();
    const tx = {
        id,
        type: 'sale',
        item: 'Test Item Verification',
        amount: 250,
        quantity: 2,
        date: new Date().toISOString().split('T')[0],
        currency: 'MAD'
    };

    const r2 = await fetch(BASE + '/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tx)
    });
    const d2 = await r2.json();
    assert(d2.success === true, 'Transaction Created');

    // 3. List Transactions
    const r3 = await fetch(BASE + '/transactions');
    const d3 = await r3.json();
    const found = d3.find(t => t.id === id);
    assert(found, 'Transaction found in list');
    assert(found.amount === 250, 'Transaction amount matches');
    assert(found.item === 'Test Item Verification', 'Transaction item matches');

    console.log('🚀 ALL API TESTS PASSED');
})();
