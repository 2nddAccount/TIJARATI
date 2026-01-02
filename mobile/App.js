import { useColorScheme } from 'react-native';

import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, Platform, BackHandler, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import * as SQLite from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import { htmlContent } from './assets/frontend_bundle';

const db = SQLite.openDatabaseSync('tijarati.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, type TEXT, item TEXT, amount REAL, quantity REAL, date TEXT, isCredit INTEGER, clientName TEXT, paidAmount REAL, isFullyPaid INTEGER, currency TEXT, createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, percent REAL, createdAt INTEGER
  );
`);

// Add missing columns for newer UI versions (safe on existing installs)
try {
  const txCols = db.getAllSync('PRAGMA table_info(transactions)');
  const hasCol = (name) => Array.isArray(txCols) && txCols.some(c => c && c.name === name);
  if (!hasCol('unitPrice')) db.runSync('ALTER TABLE transactions ADD COLUMN unitPrice REAL');
  if (!hasCol('dueDate')) db.runSync('ALTER TABLE transactions ADD COLUMN dueDate TEXT');
  if (!hasCol('reminderId')) db.runSync('ALTER TABLE transactions ADD COLUMN reminderId TEXT');
} catch { }

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const webViewRef = useRef(null);
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const themeColor = isDark ? '#111827' : '#0F766E';

  const htmlSource = { html: htmlContent, baseUrl: 'file:///android_asset/' };

  useEffect(() => {
    const backAction = () => {
      if (webViewRef.current) {
        // Send a message to WebView to handle back navigation
        webViewRef.current.postMessage(JSON.stringify({ type: 'GO_BACK' }));
        return true; // Stop hardware back (exit)
      }
      return false;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, []);

  useEffect(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({ type: 'THEME_CHANGED', payload: colorScheme }));
    }
  }, [colorScheme]);

  useEffect(() => {
    (async () => {
      try {
        const perm = await Notifications.getPermissionsAsync();
        if (perm.status !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('debts', {
            name: 'Debt reminders',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#14b8a6',
          });
        }
      } catch { }
    })();
  }, []);

  const handleMessage = async (event) => {
    let id = null;
    let type = null;
    let payload = null;
    let result = null;

    try {
      const data = JSON.parse(event.nativeEvent.data);
      id = data?.id;
      type = data?.type;
      payload = data?.payload;

      if (type === 'EXIT_APP') {
        BackHandler.exitApp();
        return;
      }

      if (type === 'GET_TRANSACTIONS') {
        const rows = db.getAllSync('SELECT * FROM transactions ORDER BY date DESC');
        // Map DB schema -> v3 UI schema
        result = (rows || []).map((r) => ({
          id: r.id,
          type: r.type,
          item: r.item,
          quantity: Number(r.quantity ?? 1),
          unitPriceBase: Number(r.unitPrice ?? 0),
          amountBase: Number(r.amount ?? 0),
          date: r.date,
          isCredit: !!r.isCredit,
          clientName: r.clientName ?? '',
          paidAmountBase: Number(r.paidAmount ?? 0),
          isFullyPaid: !!r.isFullyPaid,
          currency: r.currency ?? 'MAD',
          createdAt: Number(r.createdAt ?? 0),
          dueDate: r.dueDate ?? '',
          reminderId: r.reminderId ?? null,
        }));
      } else if (type === 'SAVE_TRANSACTION') {
        const tx = payload;
        db.runSync(
          'INSERT OR REPLACE INTO transactions (id, type, item, amount, quantity, unitPrice, date, isCredit, clientName, paidAmount, isFullyPaid, currency, createdAt, dueDate, reminderId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            String(tx.id),
            String(tx.type ?? ''),
            String(tx.item ?? ''),
            Number(tx.amountBase ?? tx.amount ?? 0),
            Number(tx.quantity ?? 1),
            Number(tx.unitPriceBase ?? tx.unitPrice ?? 0),
            String(tx.date ?? ''),
            tx.isCredit ? 1 : 0,
            String(tx.clientName ?? ''),
            Number(tx.paidAmountBase ?? tx.paidAmount ?? 0),
            tx.isFullyPaid ? 1 : 0,
            String(tx.currency ?? 'MAD'),
            Number(tx.createdAt ?? Date.now()),
            String(tx.dueDate ?? ''),
            tx.reminderId ? String(tx.reminderId) : null,
          ]
        );
        result = { success: true };
      } else if (type === 'GET_PARTNERS') {
        result = db.getAllSync('SELECT * FROM partners');
      } else if (type === 'SAVE_PARTNER') {
        const p = payload;
        // Preserve explicit id when provided (older bundles didn't)
        const idNum = (p && p.id !== undefined && p.id !== null) ? Number(p.id) : null;
        if (idNum !== null && Number.isFinite(idNum)) {
          db.runSync('INSERT OR REPLACE INTO partners (id, name, percent, createdAt) VALUES (?, ?, ?, ?)', [idNum, p.name, p.percent, p.createdAt ?? Date.now()]);
        } else {
          db.runSync('INSERT INTO partners (name, percent, createdAt) VALUES (?, ?, ?)', [p.name, p.percent, p.createdAt ?? Date.now()]);
        }
        result = { success: true };
      } else if (type === 'DELETE_PARTNER') {
        db.runSync('DELETE FROM partners WHERE id = ?', [payload.id]);
        result = { success: true };
      } else if (type === 'DELETE_TRANSACTION') {
        // Best-effort: cancel scheduled reminder if present
        try {
          const row = db.getFirstSync('SELECT reminderId FROM transactions WHERE id = ?', [payload.id]);
          const reminderId = row?.reminderId;
          if (reminderId) {
            try { await Notifications.cancelScheduledNotificationAsync(String(reminderId)); } catch { }
          }
        } catch { }
        db.runSync('DELETE FROM transactions WHERE id = ?', [payload.id]);
        result = { success: true };
      } else if (type === 'SCHEDULE_DEBT_REMINDER') {
        const ts = Number(payload?.timestamp);
        const title = String(payload?.title ?? 'Debt reminder');
        const body = String(payload?.body ?? '');
        if (!ts || Number.isNaN(ts)) {
          result = { success: false, error: 'Invalid timestamp' };
        } else {
          try {
            const now = Date.now();
            const diffMs = ts - now;
            const diffSeconds = Math.ceil(diffMs / 1000);
            if (!Number.isFinite(diffSeconds) || diffSeconds < 5) {
              result = { success: false, error: 'Reminder time must be in the future' };
            } else {
            const id = await Notifications.scheduleNotificationAsync({
              content: {
                title,
                body,
                sound: true,
                data: { txId: payload?.txId ?? null },
                ...(Platform.OS === 'android' ? { channelId: 'debts' } : {}),
              },
              // Use time interval trigger for reliability across Android OEMs/WebView bridges.
              trigger: { seconds: diffSeconds, repeats: false },
            });
            result = { success: true, reminderId: id };
            }
          } catch (err) {
            result = { success: false, error: String(err?.message || err) };
          }
        }
      } else if (type === 'CANCEL_DEBT_REMINDER') {
        try {
          const reminderId = payload?.id;
          if (reminderId) {
            await Notifications.cancelScheduledNotificationAsync(String(reminderId));
          }
          result = { success: true };
        } catch (err) {
          result = { success: false, error: String(err?.message || err) };
        }
      } else if (type === 'CLEAR_ALL_DATA') {
        // Cancel all scheduled reminders stored in DB
        try {
          const reminderRows = db.getAllSync("SELECT reminderId FROM transactions WHERE reminderId IS NOT NULL AND reminderId != ''");
          for (const r of reminderRows || []) {
            const rid = r?.reminderId;
            if (!rid) continue;
            try { await Notifications.cancelScheduledNotificationAsync(String(rid)); } catch { }
          }
        } catch { }

        db.execSync('BEGIN');
        try {
          db.runSync('DELETE FROM transactions');
          db.runSync('DELETE FROM partners');
          // Reset autoincrement counter (safe even if table missing in sqlite_sequence)
          try {
            db.runSync("DELETE FROM sqlite_sequence WHERE name = 'partners'");
          } catch { }
          db.execSync('COMMIT');
          result = { success: true };
        } catch (err) {
          try { db.execSync('ROLLBACK'); } catch { }
          result = { success: false, error: String(err?.message || err) };
        }
      } else if (type === 'IMPORT_DATA') {
        const incoming = payload?.content
          ? JSON.parse(payload.content)
          : (payload?.state ?? payload);

        const transactions = Array.isArray(incoming?.transactions) ? incoming.transactions : [];
        const partners = Array.isArray(incoming?.partners) ? incoming.partners : [];

        // Cancel previously scheduled reminders stored in DB (best-effort)
        try {
          const reminderRows = db.getAllSync("SELECT reminderId FROM transactions WHERE reminderId IS NOT NULL AND reminderId != ''");
          for (const r of reminderRows || []) {
            const rid = r?.reminderId;
            if (!rid) continue;
            try { await Notifications.cancelScheduledNotificationAsync(String(rid)); } catch { }
          }
        } catch { }

        db.execSync('BEGIN');
        try {
          db.runSync('DELETE FROM transactions');
          db.runSync('DELETE FROM partners');

          for (const p of partners) {
            if (!p) continue;
            const name = String(p.name ?? '').trim();
            if (!name) continue;
            const percent = Number(p.percent ?? 0);
            const createdAt = Number(p.createdAt ?? Date.now());

            // Preserve imported id when present so future deletes match.
            if (p.id !== undefined && p.id !== null && p.id !== '') {
              const idNum = Number(p.id);
              if (!Number.isNaN(idNum)) {
                db.runSync(
                  'INSERT OR REPLACE INTO partners (id, name, percent, createdAt) VALUES (?, ?, ?, ?)',
                  [idNum, name, percent, createdAt]
                );
                continue;
              }
            }

            db.runSync('INSERT INTO partners (name, percent, createdAt) VALUES (?, ?, ?)', [name, percent, createdAt]);
          }

          for (const tx of transactions) {
            if (!tx) continue;
            const txId = String(tx.id ?? '').trim();
            if (!txId) continue;
            db.runSync(
              'INSERT OR REPLACE INTO transactions (id, type, item, amount, quantity, unitPrice, date, isCredit, clientName, paidAmount, isFullyPaid, currency, createdAt, dueDate, reminderId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                txId,
                String(tx.type ?? ''),
                String(tx.item ?? ''),
                Number(tx.amountBase ?? tx.amount ?? 0),
                Number(tx.quantity ?? 1),
                Number(tx.unitPriceBase ?? tx.unitPrice ?? 0),
                String(tx.date ?? ''),
                tx.isCredit ? 1 : 0,
                String(tx.clientName ?? ''),
                Number(tx.paidAmountBase ?? tx.paidAmount ?? 0),
                tx.isFullyPaid ? 1 : 0,
                String(tx.currency ?? ''),
                Number(tx.createdAt ?? Date.now()),
                String(tx.dueDate ?? ''),
                tx.reminderId ? String(tx.reminderId) : null,
              ]
            );
          }

          // Ensure next AUTOINCREMENT doesn't collide
          try {
            const maxPartnerId = db.getFirstSync('SELECT MAX(id) as maxId FROM partners')?.maxId;
            if (maxPartnerId) {
              db.runSync(
                "INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('partners', ?)",
                [Number(maxPartnerId)]
              );
            }
          } catch { }

          db.execSync('COMMIT');
          result = { success: true, counts: { partners: partners.length, transactions: transactions.length } };
        } catch (err) {
          try { db.execSync('ROLLBACK'); } catch { }
          result = { success: false, error: String(err?.message || err) };
        }
      } else if (type === 'OPEN_EXTERNAL') {
        const rawUrl = payload?.url;
        const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
        // Prevent Android FileUriExposed errors for internal WebView base URLs.
        const isSafeExternal =
          url.startsWith('http://') ||
          url.startsWith('https://') ||
          url.startsWith('mailto:') ||
          url.startsWith('tel:');
        if (!url || !isSafeExternal) {
          console.warn('Blocked OPEN_EXTERNAL url:', url);
          return;
        }
        Linking.openURL(url);
        return;
      } else if (type === 'SHARE_TEXT') {
        const title = String(payload?.title ?? 'Receipt');
        const text = String(payload?.text ?? '');
        const safeBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'receipt';
        const fileName = `${safeBase}_${Date.now()}.txt`;
        const fileUri = FileSystem.documentDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, text, { encoding: FileSystem.EncodingType.UTF8 });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri);
          result = { success: true, message: 'Shared' };
        } else {
          result = { success: false, message: 'Sharing is not available on this device' };
        }
      } else if (type === 'SAVE_FILE') {
        const fileName = payload.fileName || 'tijarati_backup.json';
        const mimeType = payload.mimeType || (String(fileName).toLowerCase().endsWith('.txt') ? 'text/plain' : 'application/json');
        const fileUri = FileSystem.documentDirectory + fileName;
        await FileSystem.writeAsStringAsync(fileUri, payload.content, { encoding: FileSystem.EncodingType.UTF8 });

        // On newer Android versions, MediaLibrary APIs are restricted and are meant for media.
        // For JSON backups, use SAF (user picks Download/Documents), otherwise fall back to share.
        if (Platform.OS === 'android') {
          const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (permissions.granted) {
            const targetUri = await FileSystem.StorageAccessFramework.createFileAsync(
              permissions.directoryUri,
              fileName,
              mimeType
            );
            await FileSystem.writeAsStringAsync(targetUri, payload.content, { encoding: FileSystem.EncodingType.UTF8 });
            result = { success: true, message: 'File saved' };
          } else {
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(fileUri);
              result = { success: true, message: 'File shared' };
            } else {
              result = { success: false, message: 'Sharing is not available on this device' };
            }
          }
        } else {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri);
            result = { success: true, message: 'File shared' };
          } else {
            result = { success: false, message: 'Sharing is not available on this device' };
          }
        }
      } else if (type === 'PICK_FILE') {
        const doc = await DocumentPicker.getDocumentAsync({ type: 'application/json' });
        if (doc.canceled === false && doc.assets && doc.assets[0]) {
          const content = await FileSystem.readAsStringAsync(doc.assets[0].uri);
          result = { success: true, content };
        } else {
          result = { success: false };
        }
      }

      // Note: response is injected in finally
    } catch (e) {
      console.error(e);
      if (!result) result = { success: false, error: String(e?.message || e) };
    } finally {
      // Always respond to avoid leaving the WebView awaiting forever.
      if (id && webViewRef.current) {
        const responseJS = `
          window.postMessage(${JSON.stringify({ id, result })});
          true;
        `;
        webViewRef.current.injectJavaScript(responseJS);
      }
    }
  };

  const initialJS = `
    window.isNativeApp = true;
    window.systemTheme = '${colorScheme}';
    if ('${colorScheme}' === 'dark') document.documentElement.classList.add('dark');

    (function patchNativeImportClear() {
      function nativeRequest(type, payload) {
        return new Promise((resolve) => {
          const id = Date.now() + Math.random().toString();
          const handler = (event) => {
            let data = event && event.data;
            try {
              if (typeof data === 'string') data = JSON.parse(data);
            } catch (e) {}
            if (data && data.id === id) {
              document.removeEventListener('message', handler);
              window.removeEventListener('message', handler);
              resolve(data.result);
            }
          };
          document.addEventListener('message', handler);
          window.addEventListener('message', handler);
          window.ReactNativeWebView.postMessage(JSON.stringify({ id, type, payload }));
        });
      }

      function tryPatch() {
        if (!window.isNativeApp) return;
        if (!window.ReactNativeWebView) return;

        // Patch Clear Data
        // Clear data is handled by the web UI (calls API.clearAllData()).

        // Patch Import (import into SQLite first, then apply to local state)
        if (typeof window.processImport === 'function' && !window.processImport.__nativePatched) {
          const originalProcessImport = window.processImport;
          const patchedProcessImport = async function (content, event) {
            try {
              const incoming = JSON.parse(String(content || '{}'));
              const res = await nativeRequest('IMPORT_DATA', { state: incoming });
              if (!res || !res.success) {
                if (typeof window.showToast === 'function') window.showToast('Import failed', 'error');
                if (event && event.target) event.target.value = '';
                return;
              }
            } catch (e) {
              // Fall through to existing error handling (Invalid file)
            }
            return originalProcessImport(content, event);
          };
          patchedProcessImport.__nativePatched = true;
          window.processImport = patchedProcessImport;
        }
      }

      // Poll briefly because the bundle defines functions after load
      let attempts = 0;
      const timer = setInterval(() => {
        attempts++;
        tryPatch();
        if (window.processImport && window.processImport.__nativePatched) {
          clearInterval(timer);
        }
        if (attempts > 200) clearInterval(timer);
      }, 50);
    })();

    true;
  `;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, { backgroundColor: themeColor }]} edges={['top', 'left', 'right']}>
        <StatusBar style={isDark ? "light" : "light"} backgroundColor={themeColor} />
        <WebView
          ref={webViewRef}
          source={htmlSource}
          style={[styles.webview, { backgroundColor: isDark ? '#111827' : '#F3F4F6' }]}
          javaScriptEnabled={true}
          onMessage={handleMessage}
          injectedJavaScriptBeforeContentLoaded={initialJS}
          onError={(e) => console.warn('WebView Error', e.nativeEvent)}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
