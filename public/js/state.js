const State = {
    data: {
        language: 'darija',
        currency: 'MAD',
        transactions: [],
        partners: [],
        online: true
    },

    load: () => {
        const saved = localStorage.getItem('tijarati_v2');
        if (saved) {
            const parsed = JSON.parse(saved);
            // Merge carefully or just overwrite? Overwrite is safer for simplicity
            State.data = { ...State.data, ...parsed };
        }
    },

    save: () => {
        localStorage.setItem('tijarati_v2', JSON.stringify({
            language: State.data.language,
            currency: State.data.currency,
            transactions: State.data.transactions,
            partners: State.data.partners
        }));
    },

    get: (key) => State.data[key],
    set: (key, val) => {
        State.data[key] = val;
        State.save();
    },

    sync: async () => {
        try {
            const txs = await API.getTransactions();
            const parts = await API.getPartners();

            if (txs) {
                // Determine if we have unsynced local changes?
                // For now, Server wins.
                State.data.transactions = txs;
                State.data.online = true;
            } else {
                State.data.online = false;
            }

            if (parts) State.data.partners = parts;
            State.save();
            if (window.UI) window.UI.updateAll();
        } catch (e) {
            console.log('Sync failed', e);
            State.data.online = false;
        }
    },

    addTransaction: async (tx) => {
        // Optimistic Update
        State.data.transactions.unshift(tx); // Add to top
        State.save();
        if (window.UI) window.UI.updateAll();

        // Network Request
        const res = await API.saveTransaction(tx);
        if (!res) {
            console.warn('Offline mode: Saved locally');
            // Logic to mark as 'pending_sync' could be added here
        }
    },

    addPartner: async (p) => {
        // Optimistic
        State.data.partners.push(p); // We need an ID temporarily?
        State.save();
        if (window.UI) window.UI.renderPartners();

        const res = await API.savePartner(p);
        if (res && res.success) {
            // Refresh to get ID
            State.sync();
        }
    },

    removePartner: async (id) => {
        // Optimistic
        State.data.partners = State.data.partners.filter(p => p.id !== id);
        State.save();
        if (window.UI) window.UI.renderPartners();

        await API.deletePartner(id); // Fire and forget
    }
};
window.State = State;
