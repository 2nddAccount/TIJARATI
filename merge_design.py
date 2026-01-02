
import os
import json

HTML_PATH = r"c:\Users\H_Oussama\Desktop\Programing\androidApps\Tijarati\index.html"
BUNDLE_PATH = r"c:\Users\H_Oussama\Desktop\Programing\androidApps\Tijarati\mobile\assets\frontend_bundle.js"

BRIDGE_CODE = r"""
    // ==========================
    // Native Bridge
    // ==========================
    const API = {
        fetch: async (endpoint, options = {}) => {
            if (window.isNativeApp) {
                return API.bridgeCall(endpoint, options);
            }
            return null;
        },
        bridgeCall: (endpoint, options) => {
            return new Promise((resolve) => {
                const id = Date.now() + Math.random().toString();
                let type = '';
                let payload = null;

                if (endpoint === '/transactions' && options.method === 'POST') {
                    type = 'SAVE_TRANSACTION';
                    payload = JSON.parse(options.body);
                } else if (endpoint === '/transactions') {
                    type = 'GET_TRANSACTIONS';
                } else if (endpoint === '/partners' && options.method === 'POST') {
                    type = 'SAVE_PARTNER';
                    payload = JSON.parse(options.body);
                } else if (endpoint === '/partners') {
                    type = 'GET_PARTNERS';
                } else if (endpoint.startsWith('/partners/') && options.method === 'DELETE') {
                    type = 'DELETE_PARTNER';
                    const parts = endpoint.split('/');
                    payload = { id: parts[parts.length - 1] };
                } else if (endpoint.startsWith('/transactions/') && options.method === 'DELETE') {
                    type = 'DELETE_TRANSACTION';
                    const parts = endpoint.split('/');
                    payload = { id: parts[parts.length - 1] };
                }

                const handler = (event) => {
                   let data = event.data;
                   try { 
                     if (typeof data === 'string') data = JSON.parse(data);
                   } catch(e) {}
                   
                   if (data && data.id === id) {
                       document.removeEventListener('message', handler);
                       window.removeEventListener('message', handler);
                       resolve(data.result);
                   }
                };
                
                document.addEventListener('message', handler);
                window.addEventListener('message', handler);

                if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ id, type, payload }));
                }
            });
        },
        init: () => {
             const backHandler = (event) => {
                try {
                    let data = event.data;
                     if (typeof data === 'string') data = JSON.parse(data);
                    if (data.type === 'GO_BACK') {
                         handleBack(); 
                    } else if (data.type === 'THEME_CHANGED') {
                         window.systemTheme = data.payload;
                         if (state.theme === 'system') applyTheme();
                    }
                } catch (e) { }
            };
            document.addEventListener('message', backHandler);
            window.addEventListener('message', backHandler);
        },
        getTransactions: () => API.fetch('/transactions'),
        saveTransaction: (tx) => API.fetch('/transactions', { method: 'POST', body: JSON.stringify(tx) }),
        getPartners: () => API.fetch('/partners'),
        savePartner: (p) => API.fetch('/partners', { method: 'POST', body: JSON.stringify(p) }),
        deletePartner: (id) => API.fetch('/partners/' + id, { method: 'DELETE' }),
        deleteTransaction: (id) => API.fetch('/transactions/' + id, { method: 'DELETE' }),
        openExternal: (url) => {
             if (window.isNativeApp && window.ReactNativeWebView) {
                 window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_EXTERNAL', payload: { url } }));
             } else {
                 window.open(url, '_blank');
             }
        },
        saveFile: (fileName, content) => {
            return new Promise((resolve) => {
                if (window.isNativeApp && window.ReactNativeWebView) {
                    const id = Date.now() + Math.random().toString();
                    const handler = (event) => {
                        let data = event.data;
                        try { if (typeof data === 'string') data = JSON.parse(data); } catch(e) {}
                        if (data && data.id === id) {
                            document.removeEventListener('message', handler);
                            window.removeEventListener('message', handler);
                            resolve(data.result);
                        }
                    };
                    document.addEventListener('message', handler);
                    window.addEventListener('message', handler);
                    window.ReactNativeWebView.postMessage(JSON.stringify({ id, type: 'SAVE_FILE', payload: { fileName, content } }));
                } else {
                    const dataStr = 'data:application/json;charset=utf-8,' + encodeURIComponent(content);
                    const a = document.createElement('a');
                    a.setAttribute('href', dataStr);
                    a.setAttribute('download', fileName);
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    resolve({ success: true });
                }
            });
        },
        pickFile: () => {
            return new Promise((resolve) => {
                if (window.isNativeApp && window.ReactNativeWebView) {
                    const id = Date.now() + Math.random().toString();
                    const handler = (event) => {
                        let data = event.data;
                        try { if (typeof data === 'string') data = JSON.parse(data); } catch(e) {}
                        if (data && data.id === id) {
                            document.removeEventListener('message', handler);
                            window.removeEventListener('message', handler);
                            resolve(data.result);
                        }
                    };
                    document.addEventListener('message', handler);
                    window.addEventListener('message', handler);
                    window.ReactNativeWebView.postMessage(JSON.stringify({ id, type: 'PICK_FILE', payload: {} }));
                } else {
                    resolve({ success: false });
                }
            });
        }
    };
    
    function handleBack() {
         if (!document.getElementById('confirm-modal').classList.contains('hidden')) { closeConfirm(); return; }
         if (!document.getElementById('transaction-modal').classList.contains('hidden')) { closeModal(); return; }
         if (!document.getElementById('quick-add').classList.contains('hidden')) { closeQuickAdd(); return; }
         
         const settings = document.getElementById('settings-screen');
         if (settings && settings.classList.contains('active')) {
             closeSettings();
             return;
         }
         
         if (state.lastScreen && state.lastScreen !== 'home-screen') {
             goBack();
         } else {
             if (window.isNativeApp && window.ReactNativeWebView) {
                 window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'EXIT_APP' }));
             }
         }
    }
"""

def main():
    try:
        with open(HTML_PATH, 'r', encoding='utf-8') as f:
            html = f.read()
        
        # 1. Insert Bridge Code
        html = html.replace('<script>', '<script>\n' + BRIDGE_CODE)
        
        # 2. Inject Sync in init()
        sync_logic = r"""
      if (window.isNativeApp) {
          API.init();
          try {
              const txs = await API.getTransactions();
              if (txs && Array.isArray(txs) && txs.length > 0) {
                  state.transactions = txs;
              }
              const parts = await API.getPartners();
              if (parts && Array.isArray(parts)) {
                  state.partners = parts;
              }
              saveState();
              renderAll();
          } catch(e) { console.log('Sync error', e); }
      }
"""
        html = html.replace('loadState();', 'loadState();' + sync_logic)
        
        # 3. Inject API calls in saveTransaction
        save_tx_hook = r"""
      if (window.isNativeApp) API.saveTransaction(tx);
"""
        html = html.replace('state.transactions.push(tx);\n      saveState();', 'state.transactions.push(tx);\n      saveState();' + save_tx_hook)

        # 4. Inject API calls in addPartner
        html = html.replace('state.partners.push({ name, percent: clamp(percent, 0, 100) });', 
                            'const newP = { id: Date.now(), name, percent: clamp(percent, 0, 100) };\n      state.partners.push(newP);')
        
        add_partner_hook = r"""
      if (window.isNativeApp) API.savePartner(newP);
"""
        html = html.replace('saveState();\n      document.getElementById(\'partner-name\')', 
                            'saveState();' + add_partner_hook + '\n      document.getElementById(\'partner-name\')')
                            
        # 5. Inject API calls in removePartner
        remove_partner_logic = r"""
    function removePartner(name) {
      const p = state.partners.find(p => p.name === name);
      if (p && p.id && window.isNativeApp) API.deletePartner(p.id);
      
      state.partners = state.partners.filter(p => p.name !== name);
      saveState();
      renderPartners();
    }
"""
        old_remove_partner = r"""function removePartner(name) {
      state.partners = state.partners.filter(p => p.name !== name);
      saveState();
      renderPartners();
    }"""
        if old_remove_partner in html:
            html = html.replace(old_remove_partner, remove_partner_logic)

        # 6. Inject API calls in settleDebt
        html = html.replace('tx.isFullyPaid = true;\n          saveState();', 
                            'tx.isFullyPaid = true;\n          saveState();\n          if (window.isNativeApp) API.saveTransaction(tx);')

        # 7. Inject API calls in deleteTransaction
        html = html.replace('state.transactions = state.transactions.filter(t => t.id !== id);',
                            'if (window.isNativeApp) API.deleteTransaction(id);\n          state.transactions = state.transactions.filter(t => t.id !== id);')

        # 8. Change init() to async init() because we use await
        html = html.replace('function init() {', 'async function init() {')

        # Wrap in export
        json_str = json.dumps(html)
        js_content = f"export const htmlContent = {json_str};"
        
        with open(BUNDLE_PATH, 'w', encoding='utf-8') as f:
            f.write(js_content)
            
        print("Successfully merged and created frontend_bundle.js (Safely Escaped)")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
