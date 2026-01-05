import { useColorScheme } from 'react-native';

import React, { useEffect, useState, useRef } from 'react';
import { StyleSheet, View, Text, Platform, BackHandler, Linking, TextInput, Pressable, AppState } from 'react-native';
import { WebView } from 'react-native-webview';
import * as SQLite from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { getApp } from '@react-native-firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
} from '@react-native-firebase/auth';
import {
  getStorage,
  ref as storageRef,
  uploadString,
  getDownloadURL,
} from '@react-native-firebase/storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { htmlContent } from './assets/frontend_bundle';

const db = SQLite.openDatabaseSync('tijarati.db');

db.execSync(`
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, type TEXT, item TEXT, amount REAL, quantity REAL, date TEXT, isCredit INTEGER, clientName TEXT, paidAmount REAL, isFullyPaid INTEGER, currency TEXT, createdAt INTEGER, isMock INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, percent REAL, createdAt INTEGER, isMock INTEGER DEFAULT 0
  );
`);

// Add missing columns for newer UI versions (safe on existing installs)
try {
  const txCols = db.getAllSync('PRAGMA table_info(transactions)');
  const hasCol = (name) => Array.isArray(txCols) && txCols.some(c => c && c.name === name);
  if (!hasCol('unitPrice')) db.runSync('ALTER TABLE transactions ADD COLUMN unitPrice REAL');
  if (!hasCol('pricingMode')) db.runSync('ALTER TABLE transactions ADD COLUMN pricingMode TEXT');
  if (!hasCol('isInstallmentPlan')) db.runSync('ALTER TABLE transactions ADD COLUMN isInstallmentPlan INTEGER DEFAULT 0');
  if (!hasCol('installments')) db.runSync('ALTER TABLE transactions ADD COLUMN installments TEXT');
  if (!hasCol('dueDate')) db.runSync('ALTER TABLE transactions ADD COLUMN dueDate TEXT');
  if (!hasCol('reminderId')) db.runSync('ALTER TABLE transactions ADD COLUMN reminderId TEXT');
  if (!hasCol('isMock')) db.runSync('ALTER TABLE transactions ADD COLUMN isMock INTEGER DEFAULT 0');
} catch { }

try {
  const partnerCols = db.getAllSync('PRAGMA table_info(partners)');
  const hasPartnerCol = (name) => Array.isArray(partnerCols) && partnerCols.some(c => c && c.name === name);
  if (!hasPartnerCol('isMock')) db.runSync('ALTER TABLE partners ADD COLUMN isMock INTEGER DEFAULT 0');
  if (!hasPartnerCol('investedBase')) db.runSync('ALTER TABLE partners ADD COLUMN investedBase REAL');
  if (!hasPartnerCol('investedAt')) db.runSync('ALTER TABLE partners ADD COLUMN investedAt TEXT');
  if (!hasPartnerCol('profitSchedule')) db.runSync('ALTER TABLE partners ADD COLUMN profitSchedule TEXT');
  if (!hasPartnerCol('notes')) db.runSync('ALTER TABLE partners ADD COLUMN notes TEXT');
  if (!hasPartnerCol('payouts')) db.runSync('ALTER TABLE partners ADD COLUMN payouts TEXT');
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

  const aiServerUrlRaw = (() => {
    try {
      // Expo SDK 49+ prefers expoConfig. Keep a fallback for older manifests.
      return (
        Constants?.expoConfig?.extra?.aiServerUrl
        || Constants?.manifest?.extra?.aiServerUrl
        || Constants?.manifest2?.extra?.aiServerUrl
        || ''
      );
    } catch {
      return '';
    }
  })();

  const aiServerUrl = String(aiServerUrlRaw || '').trim();

  const htmlSource = { html: htmlContent, baseUrl: 'file:///android_asset/' };

  // ==========================
  // App Lock (PIN + Fingerprint)
  // ==========================
  const [locked, setLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [lockError, setLockError] = useState('');
  const [pinEnabled, setPinEnabled] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);

  const hashPin = async (pin) => {
    const raw = String(pin || '').trim();
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  };

  const refreshSecurityStatus = async () => {
    const pinHash = await SecureStore.getItemAsync('tijarati_pin_hash');
    const bioFlag = await SecureStore.getItemAsync('tijarati_bio_enabled');

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    const available = !!hasHardware && !!enrolled;

    setPinEnabled(!!pinHash);
    setBiometricEnabled(bioFlag === '1');
    setBiometricsAvailable(available);
    setLocked(!!pinHash);

    return { pinEnabled: !!pinHash, biometricEnabled: bioFlag === '1', biometricsAvailable: available };
  };

  const tryBiometricUnlock = async () => {
    try {
      if (!pinEnabled) return false;
      if (!biometricEnabled) return false;
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) return false;

      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Tijarati',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: true
      });

      if (res && res.success) {
        setLocked(false);
        setPinInput('');
        setLockError('');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const unlockWithPin = async () => {
    try {
      const pinHash = await SecureStore.getItemAsync('tijarati_pin_hash');
      if (!pinHash) {
        setLocked(false);
        return;
      }
      const entered = String(pinInput || '').trim();
      if (entered.length < 4) {
        setLockError('PIN must be at least 4 digits');
        return;
      }

      const enteredHash = await hashPin(entered);
      if (enteredHash === pinHash) {
        setLocked(false);
        setPinInput('');
        setLockError('');
      } else {
        setLockError('Wrong PIN');
      }
    } catch {
      setLockError('Unlock failed');
    }
  };

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
    refreshSecurityStatus();
  }, []);

  useEffect(() => {
    try {
      // webClientId comes from google-services.json (oauth_client client_type=3)
      GoogleSignin.configure({
        webClientId: '796219379032-to20l2jbsnk2k4armola7j71b82k6met.apps.googleusercontent.com',
        offlineAccess: false,
      });
    } catch { }
  }, []);

  useEffect(() => {
    if (locked) {
      tryBiometricUnlock();
    }
  }, [locked, pinEnabled, biometricEnabled]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refreshSecurityStatus();
      } else if (next === 'background') {
        if (pinEnabled) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [pinEnabled]);

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

      const mapUser = (u) => {
        if (!u) return null;
        return {
          uid: u.uid,
          email: u.email || '',
          displayName: u.displayName || ''
        };
      };

      const app = getApp();
      const firebaseAuth = getAuth(app);
      const firebaseStorage = getStorage(app);

      if (type === 'EXIT_APP') {
        BackHandler.exitApp();
        return;
      }

      // ==========================
      // Cloud (Native Firebase)
      // ==========================
      if (type === 'CLOUD_GET_USER') {
        const u = firebaseAuth.currentUser;
        result = { success: true, user: mapUser(u) };
      } else if (type === 'CLOUD_SIGNIN') {
        try {
          await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
          const signInRes = await GoogleSignin.signIn();
          const idToken = signInRes?.idToken || signInRes?.data?.idToken;
          if (!idToken) {
            result = { success: false, error: 'Google sign-in failed (no idToken)' };
          } else {
            const credential = GoogleAuthProvider.credential(idToken);
            const userCred = await signInWithCredential(firebaseAuth, credential);
            result = { success: true, user: mapUser(userCred?.user || firebaseAuth.currentUser) };
          }
        } catch (e) {
          result = { success: false, error: String(e?.message || e || 'Sign-in failed') };
        }
      } else if (type === 'CLOUD_SIGNOUT') {
        try { await firebaseSignOut(firebaseAuth); } catch { }
        try { await GoogleSignin.signOut(); } catch { }
        result = { success: true };
      } else if (type === 'CLOUD_BACKUP') {
        const u = firebaseAuth.currentUser;
        if (!u) {
          result = { success: false, error: 'Not signed in' };
        } else {
          const snapshot = payload?.snapshot;
          const manifest = payload?.manifest;
          if (!snapshot || typeof snapshot !== 'object') {
            result = { success: false, error: 'Invalid snapshot' };
          } else {
            const basePath = `tijarati_backups/${u.uid}`;
            const snapStr = JSON.stringify(snapshot);
            const manStr = JSON.stringify((manifest && typeof manifest === 'object') ? manifest : {});

            await uploadString(
              storageRef(firebaseStorage, `${basePath}/latest.json`),
              snapStr,
              'raw',
              { contentType: 'application/json' }
            );
            await uploadString(
              storageRef(firebaseStorage, `${basePath}/latest_manifest.json`),
              manStr,
              'raw',
              { contentType: 'application/json' }
            );

            result = { success: true, user: mapUser(u), manifest: (manifest && typeof manifest === 'object') ? manifest : null };
          }
        }
      } else if (type === 'CLOUD_STATUS') {
        const u = firebaseAuth.currentUser;
        if (!u) {
          result = { success: true, user: null, manifest: null };
        } else {
          const basePath = `tijarati_backups/${u.uid}`;
          const manifestFileRef = storageRef(firebaseStorage, `${basePath}/latest_manifest.json`);
          let manifest = null;
          try {
            const url = await getDownloadURL(manifestFileRef);
            const res = await fetch(url);
            if (res.ok) manifest = await res.json();
          } catch {
            manifest = null;
          }
          result = { success: true, user: mapUser(u), manifest };
        }
      } else if (type === 'CLOUD_RESTORE') {
        const u = firebaseAuth.currentUser;
        if (!u) {
          result = { success: false, error: 'Not signed in' };
        } else {
          const basePath = `tijarati_backups/${u.uid}`;
          const snapRef = storageRef(firebaseStorage, `${basePath}/latest.json`);
          const manRef = storageRef(firebaseStorage, `${basePath}/latest_manifest.json`);
          let snapshot = null;
          let manifest = null;

          try {
            const mUrl = await getDownloadURL(manRef);
            const mRes = await fetch(mUrl);
            if (mRes.ok) manifest = await mRes.json();
          } catch { manifest = null; }

          try {
            const sUrl = await getDownloadURL(snapRef);
            const sRes = await fetch(sUrl);
            if (sRes.ok) snapshot = await sRes.json();
          } catch { snapshot = null; }

          result = { success: true, user: mapUser(u), snapshot, manifest };
        }
      }

      // Security: PIN + biometrics
      if (type === 'SECURITY_GET') {
        result = await refreshSecurityStatus();
      } else if (type === 'SECURITY_SET_PIN') {
        const pin = String(payload?.pin || '').trim();
        if (pin.length < 4) {
          result = { success: false, error: 'PIN must be at least 4 digits' };
        } else {
          const pinHash = await hashPin(pin);
          await SecureStore.setItemAsync('tijarati_pin_hash', pinHash);
          setPinEnabled(true);
          setLocked(true);
          result = { success: true };
        }
      } else if (type === 'SECURITY_DISABLE_PIN') {
        await SecureStore.deleteItemAsync('tijarati_pin_hash');
        await SecureStore.setItemAsync('tijarati_bio_enabled', '0');
        setPinEnabled(false);
        setBiometricEnabled(false);
        setLocked(false);
        result = { success: true };
      } else if (type === 'SECURITY_SET_BIOMETRIC') {
        const enabled = !!payload?.enabled;
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        const available = !!hasHardware && !!enrolled;
        setBiometricsAvailable(available);

        if (enabled && !pinEnabled) {
          result = { success: false, error: 'Enable PIN first' };
        } else if (enabled && !available) {
          result = { success: false, error: 'Biometrics not available' };
        } else {
          await SecureStore.setItemAsync('tijarati_bio_enabled', enabled ? '1' : '0');
          setBiometricEnabled(enabled);
          result = { success: true };
        }
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
          pricingMode: r.pricingMode ?? 'unit',
          date: r.date,
          isCredit: !!r.isCredit,
          clientName: r.clientName ?? '',
          paidAmountBase: Number(r.paidAmount ?? 0),
          isFullyPaid: !!r.isFullyPaid,
          currency: r.currency ?? 'MAD',
          createdAt: Number(r.createdAt ?? 0),
          dueDate: r.dueDate ?? '',
          reminderId: r.reminderId ?? null,
          isInstallmentPlan: !!r.isInstallmentPlan,
          installments: (() => {
            try {
              const raw = r.installments;
              if (!raw) return [];
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })(),
          isMock: !!r.isMock,
        }));
      } else if (type === 'SAVE_TRANSACTION') {
        const tx = payload;
        const installmentsJson = (() => {
          try {
            return JSON.stringify(Array.isArray(tx.installments) ? tx.installments : []);
          } catch {
            return '[]';
          }
        })();
        db.runSync(
          'INSERT OR REPLACE INTO transactions (id, type, item, amount, quantity, unitPrice, pricingMode, date, isCredit, clientName, paidAmount, isFullyPaid, currency, createdAt, dueDate, reminderId, isInstallmentPlan, installments, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            String(tx.id),
            String(tx.type ?? ''),
            String(tx.item ?? ''),
            Number(tx.amountBase ?? tx.amount ?? 0),
            Number(tx.quantity ?? 1),
            Number(tx.unitPriceBase ?? tx.unitPrice ?? 0),
            String(tx.pricingMode ?? 'unit'),
            String(tx.date ?? ''),
            tx.isCredit ? 1 : 0,
            String(tx.clientName ?? ''),
            Number(tx.paidAmountBase ?? tx.paidAmount ?? 0),
            tx.isFullyPaid ? 1 : 0,
            String(tx.currency ?? 'MAD'),
            Number(tx.createdAt ?? Date.now()),
            String(tx.dueDate ?? ''),
            tx.reminderId ? String(tx.reminderId) : null,
            tx.isInstallmentPlan ? 1 : 0,
            installmentsJson,
            0,
          ]
        );
        result = { success: true };
      } else if (type === 'GET_PARTNERS') {
        const rows = db.getAllSync('SELECT * FROM partners');
        result = (rows || []).map((r) => {
          let payouts = [];
          const raw = r?.payouts;
          if (typeof raw === 'string' && raw.trim()) {
            try {
              const parsed = JSON.parse(raw);
              payouts = Array.isArray(parsed) ? parsed : [];
            } catch {
              payouts = [];
            }
          } else if (Array.isArray(raw)) {
            payouts = raw;
          }
          return {
            ...r,
            profitSchedule: r?.profitSchedule ?? '',
            notes: r?.notes ?? '',
            payouts,
          };
        });
      } else if (type === 'SAVE_PARTNER') {
        const p = payload;
        const payoutsJson = (() => {
          try {
            return JSON.stringify(Array.isArray(p?.payouts) ? p.payouts : []);
          } catch {
            return '[]';
          }
        })();
        // Preserve explicit id when provided (older bundles didn't)
        const idNum = (p && p.id !== undefined && p.id !== null) ? Number(p.id) : null;
        if (idNum !== null && Number.isFinite(idNum)) {
          db.runSync(
            'INSERT OR REPLACE INTO partners (id, name, percent, createdAt, investedBase, investedAt, profitSchedule, notes, payouts, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [idNum, p.name, p.percent, p.createdAt ?? Date.now(), Number(p.investedBase ?? 0), p.investedAt ? String(p.investedAt) : '', String(p.profitSchedule ?? ''), String(p.notes ?? ''), payoutsJson, 0]
          );
        } else {
          db.runSync(
            'INSERT INTO partners (name, percent, createdAt, investedBase, investedAt, profitSchedule, notes, payouts, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [p.name, p.percent, p.createdAt ?? Date.now(), Number(p.investedBase ?? 0), p.investedAt ? String(p.investedAt) : '', String(p.profitSchedule ?? ''), String(p.notes ?? ''), payoutsJson, 0]
          );
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
            const investedBase = Number(p.investedBase ?? 0);
            const investedAt = p.investedAt ? String(p.investedAt) : '';
            const profitSchedule = String(p.profitSchedule ?? '');
            const notes = String(p.notes ?? '');
            const payoutsJson = (() => {
              try {
                return JSON.stringify(Array.isArray(p?.payouts) ? p.payouts : []);
              } catch {
                return '[]';
              }
            })();

            // Preserve imported id when present so future deletes match.
            if (p.id !== undefined && p.id !== null && p.id !== '') {
              const idNum = Number(p.id);
              if (!Number.isNaN(idNum)) {
                db.runSync(
                  'INSERT OR REPLACE INTO partners (id, name, percent, createdAt, investedBase, investedAt, profitSchedule, notes, payouts, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                  [idNum, name, percent, createdAt, investedBase, investedAt, profitSchedule, notes, payoutsJson, 0]
                );
                continue;
              }
            }

            db.runSync(
              'INSERT INTO partners (name, percent, createdAt, investedBase, investedAt, profitSchedule, notes, payouts, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [name, percent, createdAt, investedBase, investedAt, profitSchedule, notes, payoutsJson, 0]
            );
          }

          for (const tx of transactions) {
            if (!tx) continue;
            const txId = String(tx.id ?? '').trim();
            if (!txId) continue;

            const installmentsJson = (() => {
              try {
                return JSON.stringify(Array.isArray(tx.installments) ? tx.installments : []);
              } catch {
                return '[]';
              }
            })();

            db.runSync(
              'INSERT OR REPLACE INTO transactions (id, type, item, amount, quantity, unitPrice, pricingMode, date, isCredit, clientName, paidAmount, isFullyPaid, currency, createdAt, dueDate, reminderId, isInstallmentPlan, installments, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [
                txId,
                String(tx.type ?? ''),
                String(tx.item ?? ''),
                Number(tx.amountBase ?? tx.amount ?? 0),
                Number(tx.quantity ?? 1),
                Number(tx.unitPriceBase ?? tx.unitPrice ?? 0),
                String(tx.pricingMode ?? 'unit'),
                String(tx.date ?? ''),
                tx.isCredit ? 1 : 0,
                String(tx.clientName ?? ''),
                Number(tx.paidAmountBase ?? tx.paidAmount ?? 0),
                tx.isFullyPaid ? 1 : 0,
                String(tx.currency ?? ''),
                Number(tx.createdAt ?? Date.now()),
                String(tx.dueDate ?? ''),
                tx.reminderId ? String(tx.reminderId) : null,
                tx.isInstallmentPlan ? 1 : 0,
                installmentsJson,
                0,
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
      } else if (type === 'SET_MOCK_DATA') {
        const enabled = !!payload?.enabled;
        const today = new Date();
        const todayStr = today.toISOString().slice(0, 10);
        const future = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
        const dueDateStr = future.toISOString().slice(0, 10);

        if (!enabled) {
          // Cancel any reminders for mock transactions (best effort)
          try {
            const reminderRows = db.getAllSync("SELECT reminderId FROM transactions WHERE isMock = 1 AND reminderId IS NOT NULL AND reminderId != ''");
            for (const r of reminderRows || []) {
              const rid = r?.reminderId;
              if (!rid) continue;
              try { await Notifications.cancelScheduledNotificationAsync(String(rid)); } catch { }
            }
          } catch { }

          db.execSync('BEGIN');
          try {
            db.runSync('DELETE FROM transactions WHERE isMock = 1');
            db.runSync('DELETE FROM partners WHERE isMock = 1');
            db.execSync('COMMIT');
            result = { success: true, enabled: false };
          } catch (err) {
            try { db.execSync('ROLLBACK'); } catch { }
            result = { success: false, error: String(err?.message || err) };
          }
        } else {
          const now = Date.now();
          db.execSync('BEGIN');
          try {
            // Partners (use negative IDs to avoid collisions)
            db.runSync(
              'INSERT OR REPLACE INTO partners (id, name, percent, createdAt, isMock) VALUES (?, ?, ?, ?, ?)',
              [-1, 'Mock Partner A', 60, now, 1]
            );
            db.runSync(
              'INSERT OR REPLACE INTO partners (id, name, percent, createdAt, isMock) VALUES (?, ?, ?, ?, ?)',
              [-2, 'Mock Partner B', 40, now, 1]
            );

            // Transactions
            db.runSync(
              'INSERT OR REPLACE INTO transactions (id, type, item, amount, quantity, unitPrice, date, isCredit, clientName, paidAmount, isFullyPaid, currency, createdAt, dueDate, reminderId, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              ['mock_tx_1', 'sale', 'Mock Sale', 250, 1, 250, todayStr, 0, '', 250, 1, 'MAD', now - 3600_000, '', null, 1]
            );
            db.runSync(
              'INSERT OR REPLACE INTO transactions (id, type, item, amount, quantity, unitPrice, date, isCredit, clientName, paidAmount, isFullyPaid, currency, createdAt, dueDate, reminderId, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              ['mock_tx_2', 'purchase', 'Mock Purchase', 120, 2, 60, todayStr, 0, '', 120, 1, 'MAD', now - 2 * 3600_000, '', null, 1]
            );
            db.runSync(
              'INSERT OR REPLACE INTO transactions (id, type, item, amount, quantity, unitPrice, date, isCredit, clientName, paidAmount, isFullyPaid, currency, createdAt, dueDate, reminderId, isMock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              ['mock_tx_3', 'sale', 'Mock Credit', 500, 1, 500, todayStr, 1, 'Ahmed', 200, 0, 'MAD', now - 3 * 3600_000, dueDateStr, null, 1]
            );

            db.execSync('COMMIT');
            result = { success: true, enabled: true };
          } catch (err) {
            try { db.execSync('ROLLBACK'); } catch { }
            result = { success: false, error: String(err?.message || err) };
          }
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
        const responsePayload = JSON.stringify({ id, result })
          // Prevent rare JS parse failures when payload contains Unicode line separators.
          // These can appear in imported text and break injected JavaScript.
          .replace(/\u2028/g, '\\u2028')
          .replace(/\u2029/g, '\\u2029');

        const responseJS = `window.postMessage(${responsePayload}); true;`;
        webViewRef.current.injectJavaScript(responseJS);
      }
    }
  };

  const LockScreen = () => {
    if (!locked) return null;
    return (
      <View style={[styles.lockWrap, { backgroundColor: isDark ? '#070b16' : '#f7f7fb' }]}
        pointerEvents="auto">
        <View style={[styles.lockCard, { backgroundColor: isDark ? '#0b1326' : '#ffffff', borderColor: isDark ? '#1b2a4a' : '#e2e8f0' }]}>
          <Text style={[styles.lockTitle, { color: isDark ? '#e5e7eb' : '#0f172a' }]}>Locked</Text>
          <Text style={[styles.lockSub, { color: isDark ? '#9aa4b2' : '#64748b' }]}>Enter your PIN to continue</Text>

          {(biometricEnabled && biometricsAvailable) ? (
            <Pressable style={[styles.lockBtn, { backgroundColor: '#0f766e' }]} onPress={tryBiometricUnlock}>
              <Text style={styles.lockBtnText}>Use fingerprint</Text>
            </Pressable>
          ) : null}

          <TextInput
            value={pinInput}
            onChangeText={(v) => { setPinInput(v); setLockError(''); }}
            placeholder="PIN"
            placeholderTextColor={isDark ? '#9aa4b2' : '#94a3b8'}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={12}
            style={[styles.lockInput, { color: isDark ? '#e5e7eb' : '#0f172a', borderColor: isDark ? '#1b2a4a' : '#e2e8f0', backgroundColor: isDark ? '#0f1b36' : '#f1f5f9' }]}
            onSubmitEditing={unlockWithPin}
            returnKeyType="done"
          />

          {lockError ? <Text style={styles.lockError}>{lockError}</Text> : null}

          <Pressable style={[styles.lockBtn, { backgroundColor: '#14b8a6' }]} onPress={unlockWithPin}>
            <Text style={styles.lockBtnText}>Unlock</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const initialJS = `
    window.isNativeApp = true;
    window.systemTheme = '${colorScheme}';
    if ('${colorScheme}' === 'dark') document.documentElement.classList.add('dark');

    // Optional hosted backend for AI (so preview/production builds work without a local server).
    window.__TIJARATI_AI_SERVER_URL__ = ${JSON.stringify(aiServerUrl)};

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
      <SafeAreaView style={[styles.container, { backgroundColor: themeColor }]} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style={isDark ? "light" : "light"} backgroundColor={themeColor} />
        <View style={{ flex: 1 }}>
          <WebView
            ref={webViewRef}
            source={htmlSource}
            style={[styles.webview, { backgroundColor: isDark ? '#111827' : '#F3F4F6' }]}
            javaScriptEnabled={true}
            onMessage={handleMessage}
            injectedJavaScriptBeforeContentLoaded={initialJS}
            onError={(e) => console.warn('WebView Error', e.nativeEvent)}
          />
          <LockScreen />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  lockWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  lockCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
  },
  lockTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
  },
  lockSub: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 14,
  },
  lockInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 10,
  },
  lockBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  lockBtnText: {
    color: 'white',
    fontWeight: '800',
  },
  lockError: {
    color: '#ef4444',
    fontWeight: '800',
    marginTop: 8,
    fontSize: 12,
  },
});
