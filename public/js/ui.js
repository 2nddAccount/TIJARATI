const UI = {
    screens: ['home-screen', 'history-screen', 'debts-screen', 'partners-screen', 'settings-screen'],

    showScreen: (id) => {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = document.getElementById(id);
        if (screen) screen.classList.add('active');
        State.set('currentScreen', id); // Track for Back Handler

        // Nav Update
        document.querySelectorAll('.nav-item').forEach(n => {
            n.classList.remove('active', 'text-teal-600');
            n.classList.add('text-gray-400');
            if (n.dataset.target === id) {
                n.classList.add('active', 'text-teal-600');
                n.classList.remove('text-gray-400');
            }
        });

        if (id === 'home-screen') UI.updateDashboard();
        if (id === 'history-screen') UI.renderHistory();
        if (id === 'debts-screen') UI.renderDebts();
        if (id === 'partners-screen') UI.renderPartners();
    },

    updateAll: () => {
        I18n.apply();
        UI.updateDashboard();
        UI.renderHistory(); // Only if visible? efficiently update current screen
        // But for simplicity update dashboard which is usually home
    },

    updateDashboard: () => {
        const txs = State.get('transactions') || [];
        const today = new Date().toISOString().split('T')[0];
        const todayTx = txs.filter(t => t.date === today);

        const income = todayTx.filter(t => t.type === 'sale').reduce((sum, t) => sum + (t.paidAmount || t.amount), 0);
        const expense = todayTx.filter(t => t.type === 'purchase').reduce((sum, t) => sum + (t.paidAmount || t.amount), 0);
        const balance = income - expense;

        document.getElementById('dashboard-income').innerText = Utils.formatNumber(income);
        document.getElementById('dashboard-expense').innerText = Utils.formatNumber(expense);

        const balEl = document.getElementById('dashboard-balance');
        balEl.innerText = Utils.formatNumber(Math.abs(balance));
        balEl.className = `text-4xl font-bold ${balance >= 0 ? 'text-white' : 'text-red-300'}`;

        // Recent
        const recent = txs.slice(0, 5); // Assumed sorted
        const container = document.getElementById('recent-transactions-list');
        if (recent.length === 0) {
            container.innerHTML = `<p class="text-center text-gray-400 text-sm py-4">No activity</p>`;
        } else {
            container.innerHTML = recent.map(tx => UI.createTxRow(tx)).join('');
        }

        // Debt Alert
        const debt = txs.filter(t => t.isCredit && !t.isFullyPaid).reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
        const alert = document.getElementById('debt-alert');
        if (debt > 0) {
            alert.classList.remove('hidden');
            document.getElementById('total-pending-debt').innerText = Utils.formatNumber(debt);
        } else {
            alert.classList.add('hidden');
        }

        if (window.lucide) lucide.createIcons();
    },

    createTxRow: (tx) => {
        const isSale = tx.type === 'sale';
        const colorClass = isSale ? 'text-emerald-600' : 'text-red-600';
        const bgClass = isSale ? 'bg-emerald-100' : 'bg-red-100';
        const icon = isSale ? 'arrow-up' : 'arrow-down';

        return `
             <div class="pro-card p-3 flex items-center justify-between animate-slide-up">
                 <div class="flex items-center gap-3">
                     <div class="w-10 h-10 ${bgClass} rounded-full flex items-center justify-center ${colorClass}">
                         <i data-lucide="${icon}" class="w-5 h-5"></i>
                     </div>
                     <div>
                         <p class="font-bold text-gray-800 text-sm">${tx.item}</p>
                         <div class="flex items-center gap-2 text-xs text-gray-400">
                             <span>${tx.date}</span>
                             ${tx.isCredit ? '<span class="px-1.5 py-0.5 bg-orange-100 text-orange-600 rounded font-bold">Credit</span>' : ''}
                         </div>
                     </div>
                 </div>
                 <div class="text-right">
                     <p class="font-bold ${colorClass}">${Utils.formatNumber(tx.amount)} <span class="text-[10px] currency-symbol">DH</span></p>
                 </div>
             </div>
         `;
    },

    renderHistory: (filter = 'all') => {
        // ... (Similar implementation to original but using State)
        const container = document.getElementById('full-history-list');
        let data = State.get('transactions') || [];

        // UI updates for filter buttons
        document.querySelectorAll('.filter-chip').forEach(btn => {
            if (btn.dataset.filter === filter) btn.classList.add('bg-teal-600', 'text-white');
            else { btn.classList.remove('bg-teal-600', 'text-white'); btn.classList.add('bg-gray-200'); }
        });

        if (filter === 'sale') data = data.filter(t => t.type === 'sale');
        if (filter === 'purchase') data = data.filter(t => t.type === 'purchase');
        if (filter === 'debt') data = data.filter(t => t.isCredit && !t.isFullyPaid);

        if (data.length === 0) {
            container.innerHTML = `<p class="text-center text-gray-400 mt-10">Empty</p>`;
        } else {
            container.innerHTML = data.map(tx => UI.createTxRow(tx)).join('');
        }
        if (window.lucide) lucide.createIcons();
    },

    renderDebts: () => {
        const container = document.getElementById('debts-list');
        const debts = (State.get('transactions') || []).filter(t => t.isCredit && !t.isFullyPaid);
        const total = debts.reduce((sum, t) => sum + (t.amount - (t.paidAmount || 0)), 0);
        document.getElementById('debts-total').innerText = Utils.formatNumber(total);

        if (debts.length === 0) {
            container.innerHTML = `<p class="text-center text-gray-400">No debts</p>`;
            return;
        }

        container.innerHTML = debts.map(tx => {
            const remaining = tx.amount - (tx.paidAmount || 0);
            return `
            <div class="pro-card p-4 flex justify-between items-center animate-slide-up">
                <div>
                    <p class="font-bold text-gray-800 text-lg">${tx.clientName}</p>
                    <p class="text-xs text-gray-500">${tx.item} • ${tx.date}</p>
                </div>
                <div class="text-right">
                    <p class="font-bold text-orange-600 text-lg">${Utils.formatNumber(remaining)}</p>
                    <button onclick="Functions.settleDebt('${tx.id}')" class="mt-1 px-3 py-1 bg-teal-100 text-teal-700 rounded-lg text-xs font-bold">Pay</button>
                </div>
            </div>`;
        }).join('');
        if (window.lucide) lucide.createIcons();
    },

    renderPartners: () => {
        const container = document.getElementById('partners-list');
        const partners = State.get('partners') || [];

        // Calculate Profit (Simple)
        const txs = State.get('transactions') || [];
        const profit = txs.filter(t => t.type === 'sale').reduce((sum, t) => sum + t.amount, 0) -
            txs.filter(t => t.type === 'purchase').reduce((sum, t) => sum + t.amount, 0);
        const netProfit = Math.max(0, profit);

        container.innerHTML = partners.map(p => {
            const share = (netProfit * p.percent) / 100;
            return `
             <div class="pro-card p-4 flex justify-between items-center">
                 <div>
                     <p class="font-bold text-gray-800">${p.name}</p>
                     <p class="text-xs text-gray-500">${p.percent}% Share</p>
                 </div>
                 <div class="text-right">
                     <p class="font-bold text-teal-600">${Utils.formatNumber(share)}</p>
                     <button onclick="Functions.removePartner('${p.id}')" class="text-red-400 text-xs mt-1">Remove</button>
                 </div>
             </div>`;
        }).join('');
    }
};
window.UI = UI;
