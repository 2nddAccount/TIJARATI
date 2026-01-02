const Utils = {
    formatNumber: (num, currency) => {
        const rates = { MAD: 1, EUR: 0.092, USD: 0.099 };
        // If currency is not passed, handle in UI layer, but here we just format
        // For simplicity let's assume we just want 2 decimals
        return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    },

    generateId: () => {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }
};

window.Utils = Utils;
