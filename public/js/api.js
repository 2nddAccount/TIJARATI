const API = {
    baseUrl: '/api',

    fetch: async (endpoint, options = {}) => {
        // BRIDGE INTERCEPTOR
        if (window.isNativeApp) {
            return API.bridgeCall(endpoint, options);
        }

        try {
            const res = await fetch(API.baseUrl + endpoint, {
                headers: { 'Content-Type': 'application/json' },
                ...options
            });
            if (!res.ok) throw new Error('API Error');
            return await res.json();
        } catch (e) {
            console.error(e);
            return null;
        }
    },

    bridgeCall: (endpoint, options) => {
        return new Promise((resolve) => {
            const id = Date.now() + Math.random().toString();
            let type = '';
            let payload = null;

            // Map Endpoints to Action Types
            if (endpoint === '/transactions' && options.method === 'POST') {
                type = 'SAVE_TRANSACTION';
                payload = JSON.parse(options.body);
            } else if (endpoint === '/transactions') {
                type = 'GET_TRANSACTIONS';
            } else if (endpoint === '/partners' && options.method === 'POST') {
                type = 'SAVE_PARTNER'; // Not implemented in App.js yet for brevity but logic similar
                payload = JSON.parse(options.body);
            } else if (endpoint === '/partners') {
                type = 'GET_PARTNERS';
            }

            // Listen for response
            const handler = (event) => {
                // In React Native WebView, message comes in event.data? Or we might need to listen to 'message'
                const data = event.data;
                if (data && data.id === id) {
                    window.removeEventListener('message', handler); // Cleanup
                    if (data.error) {
                        console.error(data.error);
                        resolve(null);
                    } else {
                        // Transform SQLite result to array if needed
                        // expo-sqlite returns { rows: { _array: [] } } or similar depending on version/method
                        // App.js uses getAllSync which returns plain array. perfect.
                        resolve(data.result);
                    }
                }
            };

            window.addEventListener('message', handler);
            window.addEventListener('message', handler);
            // Also handle document-level event if needed for Android
            document.addEventListener('message', handler);

            // Send to Native
            window.ReactNativeWebView.postMessage(JSON.stringify({ id, type, payload }));
        });
    },

    // Init Back Listener
    init: () => {
        if (window.isNativeApp) {
            document.addEventListener('message', (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'GO_BACK') {
                        if (window.Functions && window.Functions.handleBack) window.Functions.handleBack();
                    }
                } catch (e) { }
            });
        }
    },

    getTransactions: () => API.fetch('/transactions'),
    saveTransaction: (tx) => API.fetch('/transactions', { method: 'POST', body: JSON.stringify(tx) }),

    getPartners: () => API.fetch('/partners'),
    savePartner: (p) => API.fetch('/partners', { method: 'POST', body: JSON.stringify(p) }),
    deletePartner: (id) => API.fetch(`/partners/${id}`, { method: 'DELETE' }),

    checkStatus: () => API.fetch('/status')
};

window.API = API;
