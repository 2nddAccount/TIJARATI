const Functions = {
    showScreen: (id) => UI.showScreen(id),

    goBack: () => {
        // Simple Go Back Logic
        if (State.get('currentScreen') !== 'home-screen') {
            UI.showScreen('home-screen');
        } else {
            // If Native, request Exit
            if (window.isNativeApp) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'EXIT_APP' }));
            }
        }
    },

    // Called by Bridge
    handleBack: () => {
        const modal = document.getElementById('transaction-modal');
        if (!modal.classList.contains('hidden')) {
            Functions.closeModal();
            return;
        }

        // Settings Overlay?
        const settings = document.getElementById('settings-screen');
        if (settings.classList.contains('active')) {
            Functions.goBack(); // This goes home
            return;
        }

        Functions.goBack();
    },

    startFlow: (type) => {
        State.set('currentFlow', type);
        const modal = document.getElementById('transaction-modal');
        const header = document.getElementById('modal-header');
        const title = document.getElementById('modal-title');

        // Reset Inputs
        document.getElementById('tx-item').value = '';
        document.getElementById('tx-price').value = '';
        document.getElementById('tx-qty').value = '1';
        document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('tx-client').value = '';
        document.getElementById('tx-paid-amount').value = '';

        if (type === 'sale') {
            header.className = 'p-4 text-white flex justify-between items-center bg-teal-600';
            title.innerText = I18n.t('newSale');
            Functions.generateSuggestions(['خبز', 'حليب', 'قهوة', 'مسمن', 'عصير', 'ماء']);
        } else {
            header.className = 'p-4 text-white flex justify-between items-center bg-slate-700';
            title.innerText = I18n.t('newPurchase');
            Functions.generateSuggestions(['طحين', 'زيت', 'سكر', 'خضرة', 'بوطة']);
        }

        Functions.setPaymentType('paid');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    },

    closeModal: () => {
        const modal = document.getElementById('transaction-modal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    },

    setPaymentType: (type) => {
        State.set('paymentType', type);
        const btnPaid = document.getElementById('btn-paid');
        const btnCredit = document.getElementById('btn-credit');
        const details = document.getElementById('credit-details');

        if (type === 'paid') {
            btnPaid.className = 'px-3 py-1 rounded text-sm font-bold bg-teal-100 text-teal-700 transition-all';
            btnCredit.className = 'px-3 py-1 rounded text-sm font-bold text-gray-500 transition-all';
            details.classList.add('hidden');
        } else {
            btnPaid.className = 'px-3 py-1 rounded text-sm font-bold text-gray-500 transition-all';
            btnCredit.className = 'px-3 py-1 rounded text-sm font-bold bg-orange-100 text-orange-700 transition-all';
            details.classList.remove('hidden');
        }
    },

    saveTransaction: async () => {
        const item = document.getElementById('tx-item').value.trim();
        const price = parseFloat(document.getElementById('tx-price').value);
        const qty = parseFloat(document.getElementById('tx-qty').value) || 1;
        const date = document.getElementById('tx-date').value;
        const type = State.get('currentFlow');

        if (!item || isNaN(price)) {
            Functions.showToast('Please fill info', 'error');
            return;
        }

        let isCredit = State.get('paymentType') === 'credit';
        let client = '';
        let paidAmount = price;

        if (isCredit) {
            client = document.getElementById('tx-client').value.trim();
            paidAmount = parseFloat(document.getElementById('tx-paid-amount').value) || 0;
            if (!client) {
                Functions.showToast('Client Name Required', 'error');
                return;
            }
        }

        const tx = {
            id: Utils.generateId(),
            type,
            item,
            amount: price,
            quantity: qty,
            date,
            isCredit,
            clientName: client,
            paidAmount,
            isFullyPaid: !isCredit,
            currency: State.get('currency'),
            createdAt: Date.now()
        };

        await State.addTransaction(tx);
        Functions.closeModal();
        Functions.showToast(I18n.t('save') + ' Success');
    },

    generateSuggestions: (items) => {
        const container = document.getElementById('quick-suggestions');
        container.innerHTML = items.map(i => `
             <button onclick="document.getElementById('tx-item').value='${i}'" class="px-4 py-2 bg-white border border-gray-200 rounded-full text-sm font-bold text-gray-600 whitespace-nowrap active:bg-gray-100">
                 ${i}
             </button>
         `).join('');
    },

    showToast: (msg, type = 'success') => {
        const toast = document.getElementById('toast');
        document.getElementById('toast-message').innerText = msg;
        const icon = document.getElementById('toast-icon');

        if (type === 'error') icon.innerHTML = '<i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>';
        else icon.innerHTML = '<i data-lucide="check-circle" class="w-5 h-5 text-emerald-400"></i>';

        if (window.lucide) lucide.createIcons();

        toast.classList.remove('-translate-y-20', 'opacity-0');
        setTimeout(() => toast.classList.add('-translate-y-20', 'opacity-0'), 3000);
    },

    filterHistory: (filter) => UI.renderHistory(filter),

    settleDebt: async (id) => {
        if (!confirm(I18n.t('areYouSure'))) return;

        const txs = State.get('transactions');
        const tx = txs.find(t => t.id === id);
        if (tx) {
            tx.paidAmount = tx.amount;
            tx.isFullyPaid = true;
            // Update local state properly
            State.save();
            UI.updateAll();

            // Sync
            await API.saveTransaction(tx);
            Functions.showToast('Debt Settled');
        }
    },

    switchPartnerTab: (tab) => {
        const viewStock = document.getElementById('stock-view');
        const viewPartners = document.getElementById('partners-view');
        const btnStock = document.getElementById('tab-stock');
        const btnPartners = document.getElementById('tab-partners');

        if (tab === 'stock') {
            viewStock.classList.remove('hidden');
            viewPartners.classList.add('hidden');
            btnStock.classList.add('bg-white', 'shadow-sm', 'text-teal-700');
            btnStock.classList.remove('text-gray-500');
            btnPartners.classList.remove('bg-white', 'shadow-sm', 'text-teal-700');
            btnPartners.classList.add('text-gray-500');
            Functions.renderStock();
        } else {
            viewStock.classList.add('hidden');
            viewPartners.classList.remove('hidden');
            btnStock.classList.remove('bg-white', 'shadow-sm', 'text-teal-700');
            btnStock.classList.add('text-gray-500');
            btnPartners.classList.add('bg-white', 'shadow-sm', 'text-teal-700');
            btnPartners.classList.remove('text-gray-500');
            UI.renderPartners();
        }
    },

    renderStock: () => {
        const inventory = {};
        (State.get('transactions') || []).forEach(t => {
            const name = t.item.toLowerCase().trim();
            if (!inventory[name]) inventory[name] = 0;
            if (t.type === 'purchase') inventory[name] += t.quantity;
            if (t.type === 'sale') inventory[name] -= t.quantity;
        });
        const container = document.getElementById('stock-view');
        const items = Object.entries(inventory).filter(([_, qty]) => qty !== 0);

        if (items.length === 0) {
            container.innerHTML = `<p class="text-center p-10 text-gray-400">Empty Stock</p>`;
            return;
        }
        container.innerHTML = items.map(([name, qty]) => `
             <div class="pro-card p-4 flex justify-between items-center">
                 <div class="flex items-center gap-3">
                     <div class="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center"><i data-lucide="package" class="w-5 h-5"></i></div>
                     <p class="font-bold text-gray-800 capitalize">${name}</p>
                 </div>
                 <span class="px-3 py-1 rounded-lg font-bold ${qty > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${qty}</span>
             </div>
         `).join('');
        if (window.lucide) lucide.createIcons();
    },

    addPartner: () => {
        const name = document.getElementById('partner-name').value;
        const percent = parseFloat(document.getElementById('partner-percent').value);
        if (name && percent) {
            State.addPartner({ id: Date.now(), name, percent }); // Using Date.now for ID until synced
            document.getElementById('partner-name').value = '';
            document.getElementById('partner-percent').value = '';
        }
    },

    removePartner: (id) => {
        if (confirm(I18n.t('areYouSure'))) State.removePartner(parseInt(id));
    },

    setLanguage: (l) => {
        State.set('language', l);
        I18n.apply();
        UI.updateDashboard();
    },

    setCurrency: (c) => {
        State.set('currency', c);
        // Also update UI to reflect selection?
        UI.updateAll();
    },

    toggleTheme: () => {
        const html = document.documentElement;
        if (html.classList.contains('dark')) {
            html.classList.remove('dark');
            State.set('theme', 'light');
        } else {
            html.classList.add('dark');
            State.set('theme', 'dark');
        }
    }
};

window.Functions = Functions;

// Init
document.addEventListener('DOMContentLoaded', async () => {
    State.load();
    I18n.apply();

    // Theme Init
    if (State.get('theme') === 'dark') document.documentElement.classList.add('dark');

    UI.updateAll();

    // Default Tab
    Functions.switchPartnerTab('stock');

    // Hide Loader
    setTimeout(() => {
        const loader = document.getElementById('loading-screen');
        loader.style.opacity = '0';
        setTimeout(() => loader.style.display = 'none', 300);
    }, 800);

    // Sync
    API.init();
    await State.sync();
});
