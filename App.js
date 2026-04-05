// ═══════════════════════════════════════════════════════
// YAN BROWSER · v3.0
// React Native / Expo · All screens in one file
// Open Source · yanshine.id
// ═══════════════════════════════════════════════════════
//
// Install before running:
// npx create-expo-app YanBrowser --template blank
// cd YanBrowser
// npx expo install expo-web-view expo-file-system expo-updates expo-device
// npm install @react-navigation/native @react-navigation/stack @react-navigation/bottom-tabs
// npx expo install react-native-screens react-native-safe-area-context react-native-gesture-handler
//
// Server manifest structure:
//   your-domain.com/sites/manifest.json
//   your-domain.com/sites/site-name/index.html
//   your-domain.com/sites/site-name/style.css
//
// manifest.json format:
//   { "sites": [ { "name": "my-site", "files": ["index.html", "style.css"] } ] }
//
// Copy this file as App.js
// ═══════════════════════════════════════════════════════

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StatusBar, SafeAreaView, useWindowDimensions,
  FlatList, ActivityIndicator, Alert, Switch,
  KeyboardAvoidingView, Platform, BackHandler,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
// expo-updates removed — causes crash in release build

// ─── SIMPLE STORAGE (FileSystem JSON — no native modules needed) ──
const STORAGE_DIR = FileSystem.documentDirectory + 'YanBrowser/data/';
const FILES = {
  sites:    STORAGE_DIR + 'sites.json',
  history:  STORAGE_DIR + 'history.json',
  settings: STORAGE_DIR + 'settings.json',
  index:    STORAGE_DIR + 'index.json',
};

async function ensureStorageDir() {
  const info = await FileSystem.getInfoAsync(STORAGE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(STORAGE_DIR, { intermediates: true });
}

async function fsGet(key) {
  try {
    const info = await FileSystem.getInfoAsync(FILES[key]);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(FILES[key]);
    return JSON.parse(raw);
  } catch { return null; }
}

async function fsSet(key, val) {
  try {
    await ensureStorageDir();
    await FileSystem.writeAsStringAsync(FILES[key], JSON.stringify(val));
  } catch(e) { console.log('fsSet error:', e.message); }
}

// ─── DB LAYER (FileSystem-backed) ────────────────────────────────
let _sites = null;
let _history = null;
let _settings = null;
let _index = null;

async function loadAll() {
  _sites    = await fsGet('sites')    || [];
  _history  = await fsGet('history')  || [];
  _settings = await fsGet('settings') || {};
  // Always default to dark if not explicitly set
  if (!_settings.theme) _settings.theme = 'dark';
  if (!_settings.ai_enabled) _settings.ai_enabled = '0';
  if (!_settings.gemini_key) _settings.gemini_key = '';
  if (!_settings.history_days) _settings.history_days = '30';
  if (!_settings.servers) _settings.servers = [];
  if (!_settings.clock_enabled) _settings.clock_enabled = '1';
  if (!_settings.clock_seconds) _settings.clock_seconds = '0';
  if (!_settings.timezone) _settings.timezone = 'Asia/Jakarta';
  _index    = await fsGet('index')    || {};
  // Apply saved theme immediately
  if (_settings.theme) {
    _theme = _settings.theme;
    themeListeners.forEach(fn => fn(_settings.theme));
  }
}

function saveAll() {
  fsSet('sites',    _sites);
  fsSet('history',  _history);
  fsSet('settings', _settings);
  fsSet('index',    _index);
}

function initDB() { loadAll(); }

function getSetting(key, callback) {
  if (_settings) { callback(_settings[key] ?? null); return; }
  loadAll().then(() => callback(_settings[key] ?? null));
}

function setSetting(key, value) {
  if (!_settings) _settings = {};
  _settings[key] = value;
  fsSet('settings', _settings);
}

function getAllSites(callback) {
  if (_sites) { callback([..._sites].reverse()); return; }
  loadAll().then(() => callback([..._sites].reverse()));
}

function addSite(name, path, url, callback) {
  if (!_sites) _sites = [];
  const id = Date.now();
  _sites.push({ id, name, path: path||null, url: url||null, visit_count:0, last_visited:null });
  fsSet('sites', _sites);
  callback && callback(id);
}

function deleteSite(id) {
  _sites = (_sites||[]).filter(s => s.id !== id);
  if (_index) delete _index[id];
  saveAll();
}

function recordVisit(site) {
  const s = (_sites||[]).find(s => s.id === site.id);
  if (s) { s.visit_count = (s.visit_count||0)+1; s.last_visited = new Date().toISOString(); fsSet('sites', _sites); }
  if (!_history) _history = [];
  _history.unshift({ id: Date.now(), site_id: site.id, name: site.name, path: site.path, url: site.url, visited_at: new Date().toISOString() });
  if (_history.length > 1000) _history = _history.slice(0, 1000);
  fsSet('history', _history);
}

function getHistory(callback) {
  if (_history) { callback(_history); return; }
  loadAll().then(() => callback(_history));
}

function clearHistory() { _history = []; fsSet('history', []); }


// ─── MULTI-SERVER HELPERS ────────────────────────────────────────
function getServers() {
  if (!_settings) return [];
  const servers = _settings.servers || [];
  // Always ensure yanshine.id is in the list
  const hasDefault = servers.some(s => s.url && s.url.includes('yanshine.id'));
  if (!hasDefault) {
    return [
      { name: 'yanshine.id', url: 'https://yanshine.id/sites/manifest.json', enabled: true },
      ...servers,
    ];
  }
  return servers;
}

function addServer(url, callback) {
  if (!_settings) _settings = {};
  if (!_settings.servers) _settings.servers = [];
  const already = _settings.servers.some(s => s.url === url);
  if (already) { callback && callback(false); return; }
  const name = url.replace(/https?:\/\//, '').split('/')[0];
  _settings.servers.push({ name, url, enabled: true });
  fsSet('settings', _settings);
  callback && callback(true);
}

function removeServer(url) {
  if (!_settings || !_settings.servers) return;
  _settings.servers = _settings.servers.filter(s => s.url !== url);
  fsSet('settings', _settings);
}

function getSiteBaseFromManifest(manifestUrl) {
  // Convert manifest URL to base URL for site files
  // e.g. https://yanshine.id/sites/manifest.json → https://yanshine.id/sites/
  return manifestUrl.replace(/manifest\.json$/, '');
}

// ─── SEARCH INDEX ─────────────────────────────────────────────────
async function indexSite(siteId, path) {
  try {
    const html = await FileSystem.readAsStringAsync(path);
    const text = html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
    const tokens = tokenize(text);
    if (!_index) _index = {};
    _index[siteId] = tokens;
    fsSet('index', _index);
  } catch(e) { console.log('Index error:', e.message); }
}

function searchSites(query, callback) {
  if (!query.trim()) { callback([]); return; }
  const terms = queryToTerms(query);
  if (!_sites || !_index) { loadAll().then(() => doSearch(terms, callback)); return; }
  doSearch(terms, callback);
}

function doSearch(terms, callback) {
  const scores = {};
  (_sites||[]).forEach(site => {
    const siteTokens = _index[site.id] || {};
    let score = 0;
    terms.forEach(t => { score += siteTokens[t] || 0; });
    if (score > 0) scores[site.id] = score;
  });
  const results = (_sites||[])
    .filter(s => scores[s.id])
    .map(s => ({ ...s, score: scores[s.id] }))
    .sort((a,b) => b.score - a.score)
    .slice(0, 50);
  callback(results);
}

function searchByName(query, callback) {
  const q = query.toLowerCase();
  if (!_sites) { loadAll().then(() => callback((_sites||[]).filter(s => s.name?.toLowerCase().includes(q) || s.url?.toLowerCase().includes(q)))); return; }
  callback((_sites||[]).filter(s => s.name?.toLowerCase().includes(q) || s.url?.toLowerCase().includes(q)));
}

async function searchRawContent(query, callback) {
  const q = query.toLowerCase();
  const hits = [];
  for (const site of (_sites||[])) {
    if (!site.path) continue;
    try {
      const html = await FileSystem.readAsStringAsync(site.path);
      if (html.toLowerCase().includes(q)) hits.push({ ...site, score:1, rawMatch:true });
    } catch {}
  }
  callback(hits);
}

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();

// ─── GEMINI AI ────────────────────────────────────────────────────
async function askGemini(query, sites) {
  try {
    let apiKey = '';
    await new Promise(res => getSetting('gemini_key', v => { apiKey = v || ''; res(); }));
    if (!apiKey) return null;

    const siteNames = sites.map(s => s.name).join(', ');
    const prompt = `The user searched for: "${query}" in their local browser.
Available local sites: ${siteNames || 'none'}.
Give a very short answer (1-2 sentences max) about what they might find, or suggest what to search.
Be direct and helpful. No markdown.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 80, temperature: 0.3 },
        }),
      }
    );
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (e) {
    return null;
  }
}

// ─── PAGE CACHE ───────────────────────────────────────────────────
// In-memory cache: site.id → { html, loadedAt }
// Stored in RAM only — cleared on app restart (exactly what was asked)
const PAGE_CACHE = new Map();
const CACHE_MAX = 40;     // max pages cached
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCachedPage(site) {
  if (!site.path) return null; // Only cache local files, not URLs
  const entry = PAGE_CACHE.get(site.id);
  if (entry && Date.now() - entry.loadedAt < CACHE_TTL) {
    return entry.html;
  }
  try {
    const html = await FileSystem.readAsStringAsync(site.path);
    // Evict oldest if cache full
    if (PAGE_CACHE.size >= CACHE_MAX) {
      const oldest = [...PAGE_CACHE.entries()].sort((a, b) => a[1].loadedAt - b[1].loadedAt)[0];
      if (oldest) PAGE_CACHE.delete(oldest[0]);
    }
    PAGE_CACHE.set(site.id, { html, loadedAt: Date.now() });
    return html;
  } catch (e) {
    return null;
  }
}

function getCacheStats() {
  return { count: PAGE_CACHE.size, max: CACHE_MAX };
}

// ─── THEME ───────────────────────────────────────────────────────
const DARK = {
  bg: '#07070f', surface: '#0d0d1a', surface2: '#11111f',
  border: '#1c1c2e', border2: '#252538',
  text: '#e8e8f5', muted: '#6b6b8a', muted2: '#3a3a52',
  pink: '#e8799a', purple: '#b8a8e8', gold: '#d4a867',
  blue: '#6ec9c4', green: '#7dd3a8', red: '#e88080',
};
const LIGHT = {
  bg: '#f7f7fe', surface: '#ffffff', surface2: '#f0f0fa',
  border: '#e4e4f0', border2: '#d4d4e8',
  text: '#1a1a2e', muted: '#555570', muted2: '#9090b0',
  pink: '#c05878', purple: '#6040c0', gold: '#906010',
  blue: '#2a7a78', green: '#2a7a58', red: '#b04040',
};

// ─── GLOBAL STATE ────────────────────────────────────────────────
let _theme = 'dark';
const themeListeners = new Set();

function getTheme() { return _theme === 'dark' ? DARK : LIGHT; }
function setTheme(t) {
  _theme = t;
  themeListeners.forEach(fn => fn(t));
}

function useTheme() {
  const [t, setT] = useState(_theme);
  useEffect(() => {
    themeListeners.add(setT);
    return () => themeListeners.delete(setT);
  }, []);
  return _theme === 'dark' ? DARK : LIGHT;
}

// ─── SEARCH ENGINE ────────────────────────────────────────────────
// ─── MULTILINGUAL TOKENIZER ───────────────────────────────────────
// Supports: English, Indonesian, Chinese, Korean
function tokenize(text) {
  const tokens = {};

  // Latin / Indonesian / English — split by whitespace + punctuation
  const latinWords = text.split(/[\s,.!?;:()\[\]{}"'\/\\+\-=<>@#$%^&*|~`]+/);
  latinWords.forEach(w => {
    const clean = w.trim().toLowerCase();
    if (clean.length > 1 && clean.length < 40) {
      tokens[clean] = (tokens[clean] || 0) + 1;
    }
  });

  // CJK — Chinese (汉字) + Korean (한글) + Japanese kana
  // Strategy: individual chars + bigrams (pairs) — no word boundaries in CJK
  const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\uac00-\ud7af\u3040-\u309f\u30a0-\u30ff]/g;
  const cjkMatches = [...(text.matchAll(cjkRegex))].map(m => m[0]);

  cjkMatches.forEach(c => {
    tokens[c] = (tokens[c] || 0) + 1;
  });
  // Bigrams
  for (let i = 0; i < cjkMatches.length - 1; i++) {
    const bi = cjkMatches[i] + cjkMatches[i + 1];
    tokens[bi] = (tokens[bi] || 0) + 1;
  }
  // Trigrams for Korean (common 3-syllable words)
  for (let i = 0; i < cjkMatches.length - 2; i++) {
    const tri = cjkMatches[i] + cjkMatches[i+1] + cjkMatches[i+2];
    tokens[tri] = (tokens[tri] || 0) + 1;
  }

  return tokens;
}

// Build search terms from a query (handles CJK gracefully)
function queryToTerms(query) {
  const raw = query.trim();
  if (!raw) return [];
  const tokens = tokenize(raw);
  // Also keep the full query as a term (for exact phrase)
  if (raw.length > 1) tokens[raw.toLowerCase()] = 10;
  return Object.keys(tokens).filter(t => t.length > 0).slice(0, 20);
}

// ─── FILE SYSTEM ─────────────────────────────────────────────────
const SITES_DIR  = FileSystem.documentDirectory + 'YanBrowser/sites/';
const EXAMPLE_MANIFEST = 'https://yanshine.id/sites/manifest.json';

async function ensureSitesDir() {
  const info = await FileSystem.getInfoAsync(SITES_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(SITES_DIR, { intermediates: true });
  }
}

// ── MANIFEST-BASED DOWNLOADER ─────────────────────────────────────

// getManifestUrl and getSitesBaseUrl replaced by multi-server helpers above

async function downloadFromServer(manifestUrl, onProgress, onStatus, offset = 0, totalOverall = 0) {
  const manifestRes = await fetch(manifestUrl);
  if (!manifestRes.ok) throw new Error(`${manifestUrl} — ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  const sites = manifest.sites || [];
  if (!sites.length) return 0;

  const baseUrl = getSiteBaseFromManifest(manifestUrl);
  let totalFiles = sites.reduce((n, s) => n + (s.files?.length || 1), 0);
  let downloaded = 0;

  for (const site of sites) {
    const siteDir = SITES_DIR + site.name + '/';
    const siteInfo = await FileSystem.getInfoAsync(siteDir);
    if (!siteInfo.exists) await FileSystem.makeDirectoryAsync(siteDir, { intermediates: true });

    const files = site.files || ['index.html'];
    for (const file of files) {
      const fileUrl = baseUrl + site.name + '/' + file;
      const localPath = siteDir + file;

      const parts = file.split('/');
      if (parts.length > 1) {
        const subDir = siteDir + parts.slice(0, -1).join('/') + '/';
        const subInfo = await FileSystem.getInfoAsync(subDir);
        if (!subInfo.exists) await FileSystem.makeDirectoryAsync(subDir, { intermediates: true });
      }

      onStatus(`Downloading ${site.name}/${file}...`);
      await FileSystem.downloadAsync(fileUrl, localPath);

      downloaded++;
      const pct = totalOverall > 0
        ? Math.round((offset + downloaded) / totalOverall * 100)
        : Math.round(downloaded / totalFiles * 100);
      onProgress({ percent: pct, downloaded: offset + downloaded, total: totalOverall || totalFiles });
    }
  }
  return sites.length;
}

async function downloadAndExtractSites(onProgress, onStatus) {
  try {
    await ensureSitesDir();
    const servers = getServers().filter(s => s.enabled && s.url);
    if (!servers.length) throw new Error('No servers configured. Add a server in Sites.');

    // Count total files across all servers first
    onStatus('Connecting to servers...');
    let allManifests = [];
    for (const srv of servers) {
      try {
        const res = await fetch(srv.url);
        if (!res.ok) { onStatus(`Warning: ${srv.name} unreachable (${res.status})`); continue; }
        const manifest = await res.json();
        allManifests.push({ srv, manifest });
      } catch (e) {
        onStatus(`Warning: ${srv.name} — ${e.message.slice(0, 40)}`);
      }
    }

    if (!allManifests.length) throw new Error('Could not reach any server.');

    const totalFiles = allManifests.reduce((n, { manifest }) =>
      n + (manifest.sites || []).reduce((m, s) => m + (s.files?.length || 1), 0), 0);

    let downloadedTotal = 0;
    let siteCount = 0;

    for (const { srv, manifest } of allManifests) {
      onStatus(`Syncing from ${srv.name}...`);
      const baseUrl = getSiteBaseFromManifest(srv.url);
      const sites = manifest.sites || [];

      for (const site of sites) {
        const siteDir = SITES_DIR + site.name + '/';
        const siteInfo = await FileSystem.getInfoAsync(siteDir);
        if (!siteInfo.exists) await FileSystem.makeDirectoryAsync(siteDir, { intermediates: true });

        const files = site.files || ['index.html'];
        for (const file of files) {
          const fileUrl = baseUrl + site.name + '/' + file;
          const localPath = siteDir + file;

          const parts = file.split('/');
          if (parts.length > 1) {
            const subDir = siteDir + parts.slice(0, -1).join('/') + '/';
            const subInfo = await FileSystem.getInfoAsync(subDir);
            if (!subInfo.exists) await FileSystem.makeDirectoryAsync(subDir, { intermediates: true });
          }

          onStatus(`${srv.name} · ${site.name}/${file}`);
          await FileSystem.downloadAsync(fileUrl, localPath);
          downloadedTotal++;
          onProgress({ percent: Math.round(downloadedTotal / totalFiles * 100), downloaded: downloadedTotal, total: totalFiles });
        }
        siteCount++;
      }
    }

    // Save last sync time
    setSetting('last_sync', new Date().toISOString());

    onStatus('Registering sites...');
    const count = await scanAndRegisterSites();
    onStatus(`Done. ${count} site${count !== 1 ? 's' : ''} ready.`);
    return count;

  } catch (e) {
    const msg = e.message || 'Unknown error';
    onStatus('Error: ' + msg.slice(0, 80));
    throw e;
  }
}

// Scan SITES_DIR for folders containing index.html → register
async function scanAndRegisterSites() {
  await ensureSitesDir();
  const entries = await FileSystem.readDirectoryAsync(SITES_DIR);
  let count = 0;

  for (const entry of entries) {
    const entryPath = SITES_DIR + entry;
    const info = await FileSystem.getInfoAsync(entryPath);

    if (info.isDirectory) {
      const indexPath = entryPath + '/index.html';
      const indexInfo = await FileSystem.getInfoAsync(indexPath);
      if (indexInfo.exists) {
        const existing = (_sites || []).find(s => s.path === indexPath);
        if (!existing) {
          const id = Date.now() + count;
          if (!_sites) _sites = [];
          _sites.push({ id, name: entry, path: indexPath, url: null, visit_count: 0, last_visited: null });
          count++;
          indexSite(id, indexPath);
        } else {
          indexSite(existing.id, indexPath);
        }
      }
    } else if (entry.endsWith('.html')) {
      const siteName = entry.replace(/\.html?$/i, '');
      const existing = (_sites || []).find(s => s.path === entryPath);
      if (!existing) {
        const id = Date.now() + count;
        if (!_sites) _sites = [];
        _sites.push({ id, name: siteName, path: entryPath, url: null, visit_count: 0, last_visited: null });
        count++;
        indexSite(id, entryPath);
      }
    }
  }

  if (count > 0) fsSet('sites', _sites);
  return count;
}

// Delete all sites + their files from internal storage
async function deleteAllSites(callback) {
  try {
    await FileSystem.deleteAsync(SITES_DIR, { idempotent: true });
    await ensureSitesDir();
    _sites = [];
    _index = {};
    PAGE_CACHE.clear();
    saveAll();
    callback && callback();
  } catch (e) {
    Alert.alert('Error', e.message);
  }
}

// ─── COMPONENTS ──────────────────────────────────────────────────
function Logo({ C, size = 48 }) {
  const { top } = useSafeAreaInsets();
  return (
    <View style={{ alignItems: 'center', paddingTop: top + 8 }}>
      {/* Stars decoration */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <Text style={{ fontSize: 10, color: C.pink, opacity: 0.4 }}>✦</Text>
        <Text style={{ fontSize: 8, color: C.muted2, letterSpacing: 4 }}>YAN MING 颜明</Text>
        <Text style={{ fontSize: 10, color: C.pink, opacity: 0.4 }}>✦</Text>
      </View>
      {/* Main logo */}
      <Text style={{
        fontSize: size + 4,
        color: C.pink,
        letterSpacing: 6,
        fontWeight: '200',
        lineHeight: size + 16,
      }}>Yan</Text>
      {/* Divider line */}
      <View style={{
        width: 40, height: 1,
        backgroundColor: C.pink,
        opacity: 0.3,
        marginVertical: 8,
      }} />
      <Text style={{
        fontSize: 7, color: C.muted,
        letterSpacing: 6,
      }}>YOUR BROWSER</Text>
    </View>
  );
}

function SectionLabel({ label, C }) {
  return (
    <Text style={{
      fontSize: 8, color: C.muted2,
      letterSpacing: 3, marginBottom: 10,
      marginTop: 8,
    }}>{label}</Text>
  );
}

function BottomTabs({ state, navigation, C }) {
  const { bottom } = useSafeAreaInsets();
  const tabs = [
    { name: 'HomeTab',    icon: '△', label: 'Home' },
    { name: 'SitesTab',   icon: '▣', label: 'Sites' },
    { name: 'HistoryTab', icon: '○', label: 'History' },
    { name: 'SettingsTab',icon: '⚙', label: 'Settings' },
  ];
  return (
    <View style={{
      flexDirection: 'row', backgroundColor: C.bg,
      borderTopWidth: 1, borderTopColor: C.border,
      paddingTop: 10, paddingBottom: Math.max(bottom, 12),
    }}>
      {tabs.map((tab, i) => {
        const focused = state.index === i;
        return (
          <TouchableOpacity
            key={tab.name}
            style={{ flex: 1, alignItems: 'center', gap: 3 }}
            onPress={() => navigation.navigate(tab.name)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.2, color: C.text }}>
              {tab.icon}
            </Text>
            <Text style={{
              fontSize: 8, letterSpacing: 0.5,
              color: focused ? C.pink : C.muted2,
            }}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN 1 — HOME
// ═══════════════════════════════════════════════════════
function useClockTick(tz) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function ClockBlock({ C }) {
  const [tz, setTz] = useState('Asia/Jakarta');
  const [showSeconds, setShowSeconds] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const now = useClockTick(tz);

  useEffect(() => {
    getSetting('timezone', v => v && setTz(v));
    getSetting('clock_seconds', v => setShowSeconds(v === '1'));
    getSetting('clock_enabled', v => setEnabled(v !== '0'));
  }, []);

  if (!enabled) return null;

  const fmt = (key) => now.toLocaleString('en-GB', { timeZone: tz, [key]: '2-digit' });
  const hh = fmt('hour');
  const mm = fmt('minute');
  const ss = fmt('second');
  const weekday = now.toLocaleString('en-GB', { timeZone: tz, weekday: 'long' }).toUpperCase();
  const day = now.toLocaleString('en-GB', { timeZone: tz, day: '2-digit' });
  const month = now.toLocaleString('en-GB', { timeZone: tz, month: 'long' }).toUpperCase();
  const year = now.toLocaleString('en-GB', { timeZone: tz, year: 'numeric' });

  // Shorten tz label
  const tzLabel = tz.split('/').pop().replace(/_/g, ' ').toUpperCase();

  return (
    <View style={{ alignItems: 'center', paddingVertical: 10 }}>
      <Text style={{
        fontSize: 62, fontWeight: '200',
        color: C.text, letterSpacing: -2, lineHeight: 70,
      }}>
        {hh}<Text style={{ opacity: 0.4 }}>:</Text>{mm}
        {showSeconds && <Text style={{ fontSize: 38, opacity: 0.5 }}><Text style={{ opacity: 0.4 }}>:</Text>{ss}</Text>}
      </Text>
      <Text style={{ fontSize: 10, color: C.muted, letterSpacing: 3, marginTop: 6 }}>
        {weekday} · {day} {month} {year}
      </Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 5,
        marginTop: 8, backgroundColor: C.surface,
        borderWidth: 1, borderColor: C.border,
        borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3,
      }}>
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.blue }} />
        <Text style={{ fontSize: 9, color: C.muted2, letterSpacing: 1.5, fontVariant: ['tabular-nums'] }}>
          {tzLabel}
        </Text>
      </View>
    </View>
  );
}

function HomeScreen({ navigation }) {
  const C = useTheme();
  const { width } = useWindowDimensions();
  const [recentSites, setRecentSites] = useState([]);
  const [quickSites, setQuickSites] = useState([]);
  const [todayActivity, setTodayActivity] = useState([]);
  const [showAllRecent, setShowAllRecent] = useState(false);

  useEffect(() => {
    loadSites();
    const unsubscribe = navigation.addListener('focus', loadSites);
    return unsubscribe;
  }, [navigation]);

  function loadSites() {
    getAllSites(sites => {
      setQuickSites(sites.slice(0, 4));
      setRecentSites(sites);
    });
    const today = new Date().toDateString();
    getHistory(hist => {
      const todayItems = hist.filter(h => new Date(h.visited_at).toDateString() === today).slice(0, 10);
      setTodayActivity(todayItems);
    });
  }

  function openSite(site) {
    recordVisit(site);
    navigation.navigate('Viewer', { site });
  }

  const ICONS = ['◈', '◉', '◎', '▸', '◆', '▣'];
  const visibleRecent = showAllRecent ? recentSites : recentSites.slice(0, 6);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle={_theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingBottom: 8 }}>

        {/* Logo */}
        <View style={{ alignItems: 'center', paddingTop: 24, paddingBottom: 8 }}>
          <Logo C={C} size={44} />
        </View>

        {/* Clock */}
        <ClockBlock C={C} />

        {/* Thin divider */}
        <View style={{ height: 1, backgroundColor: C.border, opacity: 0.5, marginVertical: 16 }} />

        {/* Search bar */}
        <TouchableOpacity
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border2,
            borderRadius: 28, paddingHorizontal: 18, paddingVertical: 13,
            marginBottom: 28,
            shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
          }}
          onPress={() => navigation.navigate('Search')}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 16, opacity: 0.3, color: C.text }}>◎</Text>
          <Text style={{ flex: 1, fontSize: 12, color: C.muted2, letterSpacing: 0.5 }}>
            Search your sites...
          </Text>
          <Text style={{ fontSize: 10, color: C.pink, opacity: 0.6 }}>⌘</Text>
        </TouchableOpacity>

        {/* Quick Access */}
        <SectionLabel label="QUICK ACCESS" C={C} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 }}>
          {[...quickSites.slice(0, 3), { _add: true }].map((site, i) => {
            const iconSize = (width - 40 - 36) / 4; // width from useWindowDimensions
            if (site._add) {
              return (
                <TouchableOpacity
                  key="add"
                  style={{ alignItems: 'center', gap: 6, width: iconSize }}
                  onPress={() => navigation.navigate('SitesTab')}
                  activeOpacity={0.7}
                >
                  <View style={{
                    width: iconSize * 0.82, height: iconSize * 0.82, borderRadius: 14,
                    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border2,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 22, color: C.muted2 }}>＋</Text>
                  </View>
                  <Text style={{ fontSize: 8, color: C.muted2, textAlign: 'center' }}>Add Site</Text>
                </TouchableOpacity>
              );
            }
            return (
              <TouchableOpacity
                key={site.id}
                style={{ alignItems: 'center', gap: 6, width: iconSize }}
                onPress={() => openSite(site)}
                activeOpacity={0.7}
              >
                <View style={{
                  width: iconSize * 0.82, height: iconSize * 0.82, borderRadius: 14,
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 22 }}>{ICONS[i % ICONS.length]}</Text>
                </View>
                <Text style={{ fontSize: 8, color: C.muted, textAlign: 'center' }} numberOfLines={1}>
                  {site.name}
                </Text>
              </TouchableOpacity>
            );
          })}
          {/* Fill empty slots */}
          {quickSites.length === 0 && [0,1,2].map(i => (
            <View key={i} style={{ width: (width - 40 - 36) / 4 }} />
          ))}

        </View>

        {/* Recently opened */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 8 }}>
          <SectionLabel label="RECENTLY OPENED" C={C} style={{ marginBottom: 0, marginTop: 0 }} />
          {recentSites.length > 6 && (
            <TouchableOpacity onPress={() => setShowAllRecent(v => !v)} activeOpacity={0.7}>
              <Text style={{ fontSize: 9, color: C.pink, letterSpacing: 0.5 }}>
                {showAllRecent ? 'Show less' : `See all (${recentSites.length})`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {recentSites.length === 0 ? (
          <View style={{
            backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
            borderRadius: 12, padding: 20, alignItems: 'center',
          }}>
            <Text style={{ fontSize: 11, color: C.muted2, textAlign: 'center', letterSpacing: 0.5 }}>
              No sites yet.{'\n'}Go to Sites to add your first one.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 6, marginBottom: 20 }}>
            {visibleRecent.map((site, i) => {
              const dotColors = [C.pink, C.purple, C.gold, C.blue, C.green, C.red];
              const visited = site.last_visited
                ? new Date(site.last_visited).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                : '—';
              return (
                <TouchableOpacity
                  key={site.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
                  }}
                  onPress={() => openSite(site)}
                  activeOpacity={0.7}
                >
                  <View style={{
                    width: 6, height: 6, borderRadius: 3,
                    backgroundColor: dotColors[i % dotColors.length] + '90',
                  }} />
                  <Text style={{ flex: 1, fontSize: 12, color: C.muted }} numberOfLines={1}>
                    {site.name}
                  </Text>
                  <Text style={{ fontSize: 9, color: C.muted2 }}>{visited}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Today's activity */}
        {todayActivity.length > 0 && (
          <>
            <SectionLabel label="TODAY" C={C} />
            <View style={{
              backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
              borderRadius: 12, marginBottom: 20, overflow: 'hidden',
            }}>
              {todayActivity.map((item, i) => {
                const time = new Date(item.visited_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                return (
                  <View key={i} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingHorizontal: 14, paddingVertical: 9,
                    borderBottomWidth: i < todayActivity.length - 1 ? 1 : 0,
                    borderBottomColor: C.border,
                  }}>
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: C.pink + '60' }} />
                    <Text style={{ flex: 1, fontSize: 10, color: C.muted }} numberOfLines={1}>
                      {item.name || item.site_name}
                    </Text>
                    <Text style={{ fontSize: 8, color: C.muted2 }}>{time}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN 2 — SEARCH
// ═══════════════════════════════════════════════════════
function SearchScreen({ navigation }) {
  const C = useTheme();
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [statusHint, setStatusHint] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); setAiAnswer(''); return; }
    const timer = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  function runSearch(q) {
    setLoading(true);
    setSearched(true);
    setAiAnswer('');
    let combined = [];
    let done = 0;
    const TOTAL = 2;

    function merge(results) {
      results.forEach(r => {
        if (!combined.find(c => c.id === r.id)) combined.push(r);
      });
      done++;
      if (done === TOTAL) finish();
    }

    searchSites(q, merge);
    searchByName(q, merge);

    function finish() {
      const seen = new Set();
      const unique = combined.filter(r => {
        if (seen.has(r.id)) return false;
        seen.add(r.id); return true;
      });

      if (unique.length === 0) {
        // Fallback: raw substring search in files (handles rare CJK phrases)
        setStatusHint('Searching file content...');
        searchRawContent(q, rawResults => {
          setStatusHint('');
          setResults(rawResults);
          setLoading(false);
          triggerAI(q, rawResults);
        });
      } else {
        setResults(unique);
        setLoading(false);
        triggerAI(q, unique);
      }
    }
  }

  function triggerAI(q, results) {
    getSetting('ai_enabled', val => {
      if (val === '1') {
        setAiLoading(true);
        askGemini(q, results).then(answer => {
          setAiAnswer(answer || '');
          setAiLoading(false);
        });
      }
    });
  }

  function openSite(site) {
    recordVisit(site);
    navigation.navigate('Viewer', { site });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle={_theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>

        {/* Top bar */}
        <View style={{
          padding: 14, paddingBottom: 10,
          backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
              <Text style={{ fontSize: 20, color: C.muted, paddingHorizontal: 4 }}>←</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 9, color: C.muted2, letterSpacing: 2 }}>YAN SEARCH</Text>
          </View>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            backgroundColor: C.bg, borderWidth: 1, borderColor: C.pink + '50',
            borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10,
          }}>
            <Text style={{ fontSize: 14, color: C.pink }}>◎</Text>
            <TextInput
              ref={inputRef}
              style={{ flex: 1, fontSize: 13, color: C.text, letterSpacing: 0.3 }}
              placeholder="Search..."
              placeholderTextColor={C.muted2}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              onSubmitEditing={() => {
                const q = query.trim();
                if (!q) return;
                if (q.startsWith('http') || (q.includes('.') && !q.includes(' '))) {
                  const url = q.startsWith('http') ? q : 'https://' + q;
                  navigation.navigate('Viewer', { site: { id: Date.now(), name: url, path: null, url } });
                } else {
                  runSearch(q);
                }
              }}
              selectionColor={C.pink}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')}>
                <Text style={{ fontSize: 12, color: C.muted2 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Results */}
        <FlatList
          data={results}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ padding: 14 }}
          ListHeaderComponent={
            <>
              {/* AI Answer Bar */}
              {(aiLoading || aiAnswer) ? (
                <View style={{
                  flexDirection: 'row', gap: 10, alignItems: 'flex-start',
                  backgroundColor: C.surface2, borderWidth: 1,
                  borderColor: C.gold + '30', borderRadius: 12,
                  padding: 12, marginBottom: 12,
                }}>
                  <View style={{
                    width: 7, height: 7, borderRadius: 4,
                    backgroundColor: C.gold, marginTop: 4, flexShrink: 0,
                    shadowColor: C.gold, shadowOpacity: 0.6, shadowRadius: 4, elevation: 2,
                  }} />
                  {aiLoading
                    ? <ActivityIndicator size="small" color={C.gold} />
                    : <Text style={{ flex: 1, fontSize: 11, color: C.muted, lineHeight: 17 }}>
                        {aiAnswer}
                      </Text>
                  }
                </View>
              ) : null}

              {/* Results label */}
              {!loading && searched ? (
                <Text style={{ fontSize: 8, color: C.muted2, letterSpacing: 2, marginBottom: 10 }}>
                  {results.length > 0
                    ? `${results.length} SITE${results.length !== 1 ? 'S' : ''} FOUND`
                    : 'NO RESULTS'}
                </Text>
              ) : loading ? (
                <ActivityIndicator color={C.pink} style={{ marginVertical: 20 }} />
              ) : null}
            </>
          }
          ListEmptyComponent={
            !loading && !searched ? (
              <View style={{ alignItems: 'center', marginTop: 60, gap: 10 }}>
                <Text style={{ fontSize: 40, opacity: 0.1 }}>◎</Text>
                <Text style={{ fontSize: 11, color: C.muted2, letterSpacing: 1 }}>
                  Start typing to search
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{
                backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                borderRadius: 12, padding: 14, marginBottom: 8,
              }}
              onPress={() => openSite(item)}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Text style={{ fontSize: 12 }}>◈</Text>
                <Text style={{ fontSize: 9, color: C.muted2, letterSpacing: 1 }}>
                  {item.path ? 'local' : 'web'}
                </Text>
              </View>
              <Text style={{ fontSize: 13, color: C.text, fontWeight: '700', marginBottom: 4 }}>
                {item.name}
              </Text>
              {item.url ? (
                <Text style={{ fontSize: 10, color: C.muted2 }} numberOfLines={1}>{item.url}</Text>
              ) : (
                <Text style={{ fontSize: 10, color: C.muted2 }} numberOfLines={1}>
                  {item.path?.split('/').pop() || '—'}
                </Text>
              )}
              {item.score > 0 && (
                <Text style={{ fontSize: 8, color: C.muted2, marginTop: 4, letterSpacing: 1 }}>
                  {Math.round(item.score)} matches
                </Text>
              )}
            </TouchableOpacity>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN 3 — VIEWER (WebView)
// ═══════════════════════════════════════════════════════
function ViewerScreen({ route, navigation }) {
  const C = useTheme();
  const { top, bottom } = useSafeAreaInsets();
  const { site } = route.params;
  const webRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [title, setTitle] = useState(site.name);
  const [source, setSource] = useState(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    loadSource();
  }, []);

  async function loadSource() {
    if (site.path) {
      // Try page cache first
      const cached = await getCachedPage(site);
      if (cached) {
        // Load from cache: inject HTML directly into WebView (fastest)
        setSource({ html: cached, baseUrl: 'file://' + site.path.replace(/[^/]+$/, '') });
        setFromCache(true);
      } else {
        setSource({ uri: 'file://' + site.path });
      }
    } else {
      setSource({ uri: site.url });
    }
  }

  // Android back button
  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) { webRef.current?.goBack(); return true; }
      return false;
    });
    return () => handler.remove();
  }, [canGoBack]);

  const injectedJS = `
    (function() {
      window.YAN_BROWSER = true;
      window.YAN_BROWSER_V2 = true;
      window.YAN_THEME = '${_theme}';

      // ── FILE UPLOAD INTERCEPTION ──
      // Intercept all file inputs — convert to base64 and send to native
      function interceptFileInputs() {
        document.querySelectorAll('input[type="file"]').forEach(inp => {
          if (inp._yanPatched) return;
          inp._yanPatched = true;
          inp.addEventListener('change', function() {
            const file = this.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
              const base64 = e.target.result; // data:image/...;base64,...
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'FILE_UPLOAD',
                name: file.name,
                mime: file.type,
                data: base64,
                inputId: inp.id || inp.name || ('file_' + Date.now()),
              }));
            };
            reader.readAsDataURL(file);
          });
        });
      }

      // Handle saved file path coming back from native
      window.addEventListener('message', function(e) {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'FILE_SAVED') {
            // Find the input that triggered this and store the local URI
            const inp = document.querySelector('[data-yan-upload="' + msg.inputId + '"]')
                     || document.getElementById(msg.inputId);
            // Dispatch custom event so the site can react
            document.dispatchEvent(new CustomEvent('yanFileSaved', {
              detail: { name: msg.name, localUri: msg.localUri, inputId: msg.inputId }
            }));
            // Also update any img/preview with same id
            const preview = document.getElementById(msg.inputId + '_preview');
            if (preview && preview.tagName === 'IMG') preview.src = msg.localUri;
          }
        } catch {}
      });

      // Run now + on DOM changes
      interceptFileInputs();
      const obs = new MutationObserver(interceptFileInputs);
      obs.observe(document.body, { childList: true, subtree: true });
    })();
    true;
  `;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: top, paddingBottom: bottom }}>
      <StatusBar barStyle={_theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.surface} />

      {/* Browser chrome */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        paddingHorizontal: 12, paddingVertical: 10,
        backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border,
      }}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={{ fontSize: 18, color: C.muted, paddingHorizontal: 4 }}>←</Text>
        </TouchableOpacity>

        <View style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: C.bg, borderWidth: 1, borderColor: C.border2,
          borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
        }}>
          <Text style={{ fontSize: 10 }}>{site.path ? '◈' : '◉'}</Text>
          <Text style={{ flex: 1, fontSize: 11, color: C.muted }} numberOfLines={1}>
            {title || site.name}
          </Text>
          {loading && <ActivityIndicator size="small" color={C.pink} />}
          {fromCache && !loading && (
            <Text style={{ fontSize: 8, color: C.green, opacity: 0.6 }}>▸</Text>
          )}
        </View>

        <TouchableOpacity onPress={() => canGoBack && webRef.current?.goBack()} activeOpacity={0.7}>
          <Text style={{ fontSize: 16, color: canGoBack ? C.muted : C.muted2 }}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => canGoForward && webRef.current?.goForward()} activeOpacity={0.7}>
          <Text style={{ fontSize: 16, color: canGoForward ? C.muted : C.muted2 }}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => webRef.current?.reload()} activeOpacity={0.7}>
          <Text style={{ fontSize: 14, color: C.muted }}>↺</Text>
        </TouchableOpacity>
      </View>

      {source && (
        <WebView
          ref={webRef}
          source={source}
          style={{ flex: 1, backgroundColor: C.bg }}
          injectedJavaScript={injectedJS}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onNavigationStateChange={state => {
            setCanGoBack(state.canGoBack);
            setCanGoForward(state.canGoForward);
            if (state.title) setTitle(state.title);
          }}
          onMessage={async (event) => {
            try {
              const msg = JSON.parse(event.nativeEvent.data);
              if (msg.type === 'FILE_UPLOAD' && site.path) {
                // Save file into site's folder
                const siteFolder = site.path.replace(/\/[^/]+$/, '');
                const destPath = siteFolder + '/' + msg.name;
                // base64 data: strip the prefix
                const base64 = msg.data.replace(/^data:[^;]+;base64,/, '');
                await FileSystem.writeAsStringAsync(destPath, base64, {
                  encoding: FileSystem.EncodingType.Base64,
                });
                // Send back the local URI
                const localUri = 'file://' + destPath;
                webRef.current?.injectJavaScript(`
                  window.dispatchEvent(new MessageEvent('message', {
                    data: JSON.stringify({
                      type: 'FILE_SAVED',
                      name: '${msg.name}',
                      localUri: '${localUri}',
                      inputId: '${msg.inputId}'
                    })
                  }));
                  true;
                `);
                // Invalidate cache so next load picks up new file
                PAGE_CACHE.delete(site.id);
              }
            } catch (e) {
              console.log('onMessage error:', e.message);
            }
          }}
          onError={e => Alert.alert('Load error', e.nativeEvent.description)}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          originWhitelist={['*']}
          mixedContentMode="always"
          cacheEnabled={true}
          cacheMode="LOAD_CACHE_ELSE_NETWORK"
        />
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN 4 — SITES
// ═══════════════════════════════════════════════════════
function SitesScreen({ navigation }) {
  const C = useTheme();
  const { width } = useWindowDimensions();
  const [sites, setSites] = useState([]);
  const [servers, setServers] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [serverInput, setServerInput] = useState('');
  const [showServerInput, setShowServerInput] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [tab, setTab] = useState('sites'); // 'sites' | 'servers'

  useEffect(() => {
    loadAll_();
    ensureSitesDir();
    const unsub = navigation.addListener('focus', loadAll_);
    return unsub;
  }, [navigation]);

  function loadAll_() {
    getAllSites(s => setSites(s));
    setServers(getServers());
    getSetting('last_sync', v => setLastSync(v));
  }

  async function handleDownload() {
    setDownloading(true);
    setProgress(0);
    setStatusMsg('');
    try {
      await downloadAndExtractSites(
        ({ percent }) => setProgress(percent),
        msg => setStatusMsg(msg)
      );
      loadAll_();
    } catch (e) {
      Alert.alert('Sync failed', e.message);
    }
    setDownloading(false);
  }

  function handleAddServer() {
    if (!serverInput.trim()) return;
    let url = serverInput.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    addServer(url, ok => {
      if (!ok) { Alert.alert('Already added', 'This server is already in your list.'); return; }
      setServers(getServers());
      setServerInput('');
      setShowServerInput(false);
    });
  }

  function handleRemoveServer(url) {
    Alert.alert('Remove server', 'Remove this server from your list?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        removeServer(url);
        setServers(getServers());
      }}
    ]);
  }

  const syncLabel = lastSync
    ? 'Last sync: ' + new Date(lastSync).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
    : 'Never synced';

  function handleDelete(site) {
    Alert.alert('Remove', `Remove "${site.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          // If local site, delete the folder too
          if (site.path) {
            const folder = site.path.replace(/\/[^/]+$/, '');
            await FileSystem.deleteAsync(folder, { idempotent: true }).catch(() => {});
            PAGE_CACHE.delete(site.id);
          }
          deleteSite(site.id);
          loadAll_();
        }
      },
    ]);
  }

  function handleDeleteAll() {
    Alert.alert('Remove all local sites', 'This deletes all downloaded sites from the device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete all', style: 'destructive', onPress: () => deleteAllSites(loadAll_) },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle={_theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />
      <View style={{ flex: 1 }}>

        {/* Header */}
        <View style={{
          paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
          borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 14, color: C.text, fontWeight: '700', letterSpacing: 1 }}>SITES</Text>
            <TouchableOpacity
              style={{
                backgroundColor: downloading ? C.surface2 : C.green + '20',
                borderWidth: 1, borderColor: C.green + '40',
                borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
                opacity: downloading ? 0.6 : 1,
              }}
              onPress={handleDownload}
              disabled={downloading}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 10, color: C.green }}>
                {downloading ? '↓ ' + progress + '%' : '↓ Sync all'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Sync status */}
          <Text style={{ fontSize: 9, color: C.muted2, letterSpacing: 0.5 }}>{syncLabel}</Text>

          {/* Tab switcher */}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
            {['sites', 'servers'].map(t => (
              <TouchableOpacity key={t}
                style={{
                  paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20,
                  backgroundColor: tab === t ? C.pink + '20' : C.surface2,
                  borderWidth: 1, borderColor: tab === t ? C.pink + '50' : C.border2,
                }}
                onPress={() => setTab(t)} activeOpacity={0.7}
              >
                <Text style={{ fontSize: 10, color: tab === t ? C.pink : C.muted }}>
                  {t === 'sites' ? `Sites (${sites.length})` : `Servers (${servers.length})`}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Download progress */}
        {downloading && (
          <View style={{ padding: 12, backgroundColor: C.surface2, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <View style={{ height: 2, backgroundColor: C.border2, borderRadius: 1, overflow: 'hidden', marginBottom: 6 }}>
              <View style={{ height: '100%', width: progress + '%', backgroundColor: C.green, borderRadius: 1 }} />
            </View>
            <Text style={{ fontSize: 9, color: C.muted, letterSpacing: 0.5 }}>{statusMsg}</Text>
          </View>
        )}

        {/* SITES TAB */}
        {tab === 'sites' && (
          <FlatList
            data={sites}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={{ padding: 14 }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', marginTop: 60, gap: 12 }}>
                <Text style={{ fontSize: 40, opacity: 0.1 }}>▣</Text>
                <Text style={{ fontSize: 11, color: C.muted2, textAlign: 'center', letterSpacing: 0.5, lineHeight: 18 }}>
                  No sites yet.{'\n'}Add a server and tap Sync.
                </Text>
              </View>
            }
            ListFooterComponent={
              sites.filter(s => s.path).length > 0 ? (
                <TouchableOpacity onPress={handleDeleteAll} style={{ alignItems: 'center', padding: 16 }}>
                  <Text style={{ fontSize: 10, color: C.red + '80', letterSpacing: 0.5 }}>Remove all local sites</Text>
                </TouchableOpacity>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                borderRadius: 12, paddingLeft: 14, paddingRight: 8, paddingVertical: 12, marginBottom: 8,
              }}>
                <Text style={{ fontSize: 16, marginRight: 10 }}>{item.path ? '◈' : '◉'}</Text>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() => { recordVisit(item); navigation.navigate('Viewer', { site: item }); }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 13, color: C.text, fontWeight: '700' }} numberOfLines={1}>{item.name}</Text>
                  <Text style={{ fontSize: 9, color: C.muted2, marginTop: 2 }} numberOfLines={1}>
                    {item.path ? 'local · ' + item.visit_count + ' visits' : item.url}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item)} style={{ padding: 8 }} activeOpacity={0.7}>
                  <Text style={{ fontSize: 14, color: C.muted2 }}>✕</Text>
                </TouchableOpacity>
              </View>
            )}
          />
        )}

        {/* SERVERS TAB */}
        {tab === 'servers' && (
          <ScrollView contentContainerStyle={{ padding: 14 }}>
            {/* Add server input */}
            {showServerInput ? (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <TextInput
                  style={{
                    flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border2,
                    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
                    fontSize: 12, color: C.text,
                  }}
                  placeholder={EXAMPLE_MANIFEST}
                  placeholderTextColor={C.muted2}
                  value={serverInput}
                  onChangeText={setServerInput}
                  autoCapitalize="none"
                  keyboardType="url"
                  returnKeyType="done"
                  onSubmitEditing={handleAddServer}
                  selectionColor={C.pink}
                  autoFocus
                />
                <TouchableOpacity
                  style={{
                    backgroundColor: C.pink + '20', borderWidth: 1, borderColor: C.pink + '40',
                    borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center',
                  }}
                  onPress={handleAddServer} activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 11, color: C.pink }}>Add</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border2,
                  borderRadius: 12, padding: 14, marginBottom: 14,
                }}
                onPress={() => setShowServerInput(true)} activeOpacity={0.7}
              >
                <Text style={{ fontSize: 18, color: C.muted2 }}>+</Text>
                <Text style={{ fontSize: 12, color: C.muted2 }}>Add manifest server...</Text>
              </TouchableOpacity>
            )}

            {servers.length === 0 ? (
              <View style={{ alignItems: 'center', marginTop: 40, gap: 10 }}>
                <Text style={{ fontSize: 11, color: C.muted2, textAlign: 'center', lineHeight: 18 }}>
                  No servers yet. Add a manifest.json URL to get started.
                </Text>
                <Text style={{ fontSize: 9, color: C.muted2, fontFamily: 'monospace' }}>{EXAMPLE_MANIFEST}</Text>
              </View>
            ) : servers.map((srv, i) => (
              <View key={i} style={{
                backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                borderRadius: 12, padding: 14, marginBottom: 8,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.green, marginRight: 8 }} />
                  <Text style={{ flex: 1, fontSize: 13, color: C.text, fontWeight: '700' }}>{srv.name}</Text>
                  <TouchableOpacity onPress={() => handleRemoveServer(srv.url)} style={{ padding: 4 }} activeOpacity={0.7}>
                    <Text style={{ fontSize: 12, color: C.muted2 }}>✕</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ fontSize: 9, color: C.muted2 }} numberOfLines={1}>{srv.url}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
      </View>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN 5 — HISTORY
// ═══════════════════════════════════════════════════════
function HistoryScreen({ navigation }) {
  const C = useTheme();
  const [history, setHistory] = useState([]);

  useEffect(() => {
    loadHistory();
    const unsub = navigation.addListener('focus', loadHistory);
    return unsub;
  }, [navigation]);

  function loadHistory() {
    getHistory(h => setHistory(h));
  }

  function handleClear() {
    Alert.alert('Clear History', 'Delete all history?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { clearHistory(); loadHistory(); } },
    ]);
  }

  function groupByDate(items) {
    const groups = {};
    items.forEach(item => {
      const d = new Date(item.visited_at);
      const key = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return Object.entries(groups);
  }

  const grouped = groupByDate(history);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle={_theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />

      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
      }}>
        <Text style={{ fontSize: 14, color: C.text, fontWeight: '700', letterSpacing: 1 }}>HISTORY</Text>
        {history.length > 0 && (
          <TouchableOpacity onPress={handleClear} activeOpacity={0.7}>
            <Text style={{ fontSize: 10, color: C.red }}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={{ padding: 14 }}>
        {history.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 60, gap: 10 }}>
            <Text style={{ fontSize: 40, opacity: 0.1 }}>○</Text>
            <Text style={{ fontSize: 11, color: C.muted2, letterSpacing: 0.5 }}>No history yet</Text>
          </View>
        ) : grouped.map(([date, items]) => (
          <View key={date} style={{ marginBottom: 20 }}>
            <Text style={{ fontSize: 8, color: C.muted2, letterSpacing: 2, marginBottom: 8 }}>
              {date.toUpperCase()}
            </Text>
            {items.map(item => {
              const time = new Date(item.visited_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
              return (
                <TouchableOpacity
                  key={item.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border,
                  }}
                  onPress={() => item.site_id && navigation.navigate('Viewer', {
                    site: { id: item.site_id, name: item.name, path: item.path, url: item.url }
                  })}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 13 }}>{item.path ? '◈' : '◉'}</Text>
                  <Text style={{ flex: 1, fontSize: 12, color: C.muted }} numberOfLines={1}>
                    {item.name || item.site_name}
                  </Text>
                  <Text style={{ fontSize: 9, color: C.muted2 }}>{time}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════
// SCREEN 6 — SETTINGS
// ═══════════════════════════════════════════════════════
function SettingsScreen({ navigation }) {
  const C = useTheme();
  const [isDark, setIsDark] = useState(_theme === 'dark');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [historyDays, setHistoryDays] = useState('30');
  const [dbSize, setDbSize] = useState('—');
  const [lastSync, setLastSync] = useState('—');
  const [serverCount, setServerCount] = useState(0);

  useEffect(() => {
    getSetting('ai_enabled', v => setAiEnabled(v === '1'));
    getSetting('gemini_key', v => setGeminiKey(v || ''));
    getSetting('history_days', v => setHistoryDays(v || '30'));
    getSetting('last_sync', v => setLastSync(v
      ? new Date(v).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
      : 'Never'));
    setServerCount(getServers().length);
    getHistory(h => setDbSize(h.length + ' entries'));
  }, []);

  function toggleTheme(val) {
    setIsDark(val);
    setTheme(val ? 'dark' : 'light');
    setSetting('theme', val ? 'dark' : 'light');
  }

  const [clockEnabled, setClockEnabled] = useState(true);
  const [clockSeconds, setClockSeconds] = useState(false);
  const [timezone, setTimezone] = useState('Asia/Jakarta');

  const TIMEZONES = [
    { label: 'WIB · UTC+7', value: 'Asia/Jakarta' },
    { label: 'WITA · UTC+8', value: 'Asia/Makassar' },
    { label: 'WIT · UTC+9', value: 'Asia/Jayapura' },
    { label: 'SGT · UTC+8', value: 'Asia/Singapore' },
    { label: 'IST · UTC+5:30', value: 'Asia/Kolkata' },
    { label: 'CET · UTC+1', value: 'Europe/Paris' },
    { label: 'GMT · UTC+0', value: 'Europe/London' },
    { label: 'EST · UTC-5', value: 'America/New_York' },
    { label: 'PST · UTC-8', value: 'America/Los_Angeles' },
  ];

  useEffect(() => {
    getSetting('clock_enabled', v => setClockEnabled(v !== '0'));
    getSetting('clock_seconds', v => setClockSeconds(v === '1'));
    getSetting('timezone', v => v && setTimezone(v));
  }, []);

  function SettingRow({ label, sub, right }) {
    return (
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border,
        paddingHorizontal: 16,
      }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ fontSize: 13, color: C.text }}>{label}</Text>
          {sub && <Text style={{ fontSize: 10, color: C.muted2, marginTop: 2 }}>{sub}</Text>}
        </View>
        {right}
      </View>
    );
  }

  function SectionHeader({ title }) {
    return (
      <Text style={{
        fontSize: 8, color: C.muted2, letterSpacing: 3,
        paddingHorizontal: 16, paddingTop: 20, paddingBottom: 4,
      }}>{title}</Text>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle={_theme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={C.bg} />
      <View style={{
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
      }}>
        <Text style={{ fontSize: 14, color: C.text, fontWeight: '700', letterSpacing: 1 }}>SETTINGS</Text>
      </View>

      <ScrollView>

        {/* APPEARANCE */}
        <SectionHeader title="APPEARANCE" />
        <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
          <SettingRow
            label="Dark Mode"
            sub="Dark background, light text"
            right={
              <Switch
                value={isDark}
                onValueChange={toggleTheme}
                trackColor={{ false: C.border2, true: C.pink + '60' }}
                thumbColor={isDark ? C.pink : C.muted}
              />
            }
          />
        </View>

        {/* CLOCK & TIMEZONE */}
        <SectionHeader title="CLOCK & TIMEZONE" />
        <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
          <SettingRow
            label="Show Clock"
            sub="Display clock on home screen"
            right={
              <Switch
                value={clockEnabled}
                onValueChange={val => { setClockEnabled(val); setSetting('clock_enabled', val ? '1' : '0'); }}
                trackColor={{ false: C.border2, true: C.blue + '80' }}
                thumbColor={clockEnabled ? C.blue : C.muted}
              />
            }
          />
          <SettingRow
            label="Show Seconds"
            sub="Display HH:MM:SS format"
            right={
              <Switch
                value={clockSeconds}
                onValueChange={val => { setClockSeconds(val); setSetting('clock_seconds', val ? '1' : '0'); }}
                trackColor={{ false: C.border2, true: C.blue + '80' }}
                thumbColor={clockSeconds ? C.blue : C.muted}
              />
            }
          />
          <SettingRow
            label="Timezone"
            sub={TIMEZONES.find(t => t.value === timezone)?.label || timezone}
            right={null}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingBottom: 12 }}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 6, flexDirection: 'row' }}>
            {TIMEZONES.map(tz => (
              <TouchableOpacity
                key={tz.value}
                style={{
                  paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
                  backgroundColor: timezone === tz.value ? C.blue + '20' : C.surface2,
                  borderWidth: 1,
                  borderColor: timezone === tz.value ? C.blue + '60' : C.border2,
                  marginBottom: 12,
                }}
                onPress={() => { setTimezone(tz.value); setSetting('timezone', tz.value); }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 10, color: timezone === tz.value ? C.blue : C.muted }}>
                  {tz.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* SEARCH */}
        <SectionHeader title="SEARCH & AI" />
        <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
          <SettingRow
            label="Gemini AI"
            sub="AI answer bar in search results"
            right={
              <Switch
                value={aiEnabled}
                onValueChange={val => { setAiEnabled(val); setSetting('ai_enabled', val ? '1' : '0'); }}
                trackColor={{ false: C.border2, true: C.gold + '60' }}
                thumbColor={aiEnabled ? C.gold : C.muted}
              />
            }
          />
          {aiEnabled && (
            <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border }}>
              <Text style={{ fontSize: 9, color: C.muted2, letterSpacing: 1, marginBottom: 6 }}>GEMINI API KEY</Text>
              <TextInput
                style={{
                  backgroundColor: C.bg, borderWidth: 1, borderColor: C.border2,
                  borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8,
                  fontSize: 11, color: C.text,
                }}
                placeholder="AIza..."
                placeholderTextColor={C.muted2}
                value={geminiKey}
                onChangeText={v => { setGeminiKey(v); setSetting('gemini_key', v); }}
                autoCapitalize="none"
                secureTextEntry={true}
                selectionColor={C.gold}
              />
            </View>
          )}
        </View>

        {/* HISTORY */}
        <SectionHeader title="HISTORY" />
        <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
          <SettingRow
            label="Keep history for"
            sub={historyDays + ' days'}
            right={
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {['7', '30', '90'].map(d => (
                  <TouchableOpacity
                    key={d}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5,
                      backgroundColor: historyDays === d ? C.pink + '20' : C.surface2,
                      borderWidth: 1,
                      borderColor: historyDays === d ? C.pink + '50' : C.border2,
                    }}
                    onPress={() => { setHistoryDays(d); setSetting('history_days', d); }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 10, color: historyDays === d ? C.pink : C.muted }}>{d}d</Text>
                  </TouchableOpacity>
                ))}
              </View>
            }
          />
          <SettingRow
            label="Clear History"
            sub="Delete all browsing history"
            right={
              <TouchableOpacity
                onPress={() => Alert.alert('Clear History', 'Delete all?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Clear', style: 'destructive', onPress: clearHistory },
                ])}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 11, color: C.red }}>Clear</Text>
              </TouchableOpacity>
            }
          />
        </View>

        {/* STORAGE */}
        <SectionHeader title="STORAGE" />
        <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
          <SettingRow
            label="Sites directory"
            sub={SITES_DIR.replace(FileSystem.documentDirectory, '~/')}
            right={null}
          />
          <SettingRow
            label="Database size"
            sub="Search index + history"
            right={<Text style={{ fontSize: 11, color: C.muted }}>{dbSize}</Text>}
          />
          <SettingRow
            label="Page cache"
            sub={`${getCacheStats().count} / ${getCacheStats().max} pages in RAM · clears on restart`}
            right={
              <TouchableOpacity
                onPress={() => { PAGE_CACHE.clear(); Alert.alert('✓', 'Cache cleared'); }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 11, color: C.muted2 }}>Clear</Text>
              </TouchableOpacity>
            }
          />
          <SettingRow
            label="Rebuild Search Index"
            sub="Re-index all local sites"
            right={
              <TouchableOpacity
                onPress={() => {
                  getAllSites(sites => {
                    sites.filter(s => s.path).forEach(s => indexSite(s.id, s.path));
                    Alert.alert('✓', 'Indexing started in background');
                  });
                }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 11, color: C.blue }}>Rebuild</Text>
              </TouchableOpacity>
            }
          />
        </View>

        {/* ABOUT */}
        <SectionHeader title="ABOUT" />
        <View style={{ backgroundColor: C.surface, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
          <SettingRow label="Version" right={<Text style={{ fontSize: 11, color: C.muted }}>3.0.0</Text>} />
          <SettingRow label="Supports" sub="HTML · CSS · JS · SQLite · File system" right={null} />
          <SettingRow
            label="Fonts"
            sub="13 Google Fonts embedded locally"
            right={null}
          />
        </View>

        <View style={{ alignItems: 'center', padding: 30 }}>
          <Logo C={C} size={28} />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════
// ERROR BOUNDARY
// ═══════════════════════════════════════════════════════
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex:1, backgroundColor:'#07070f', alignItems:'center', justifyContent:'center', padding:30 }}>
          <Text style={{ color:'#e8799a', fontSize:14, marginBottom:12 }}>Error</Text>
          <Text style={{ color:'#6b6b8a', fontSize:11, textAlign:'center' }}>
            {this.state.error.toString()}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════
// NAVIGATION STRUCTURE
// ═══════════════════════════════════════════════════════
function TabNavigator() {
  const C = useTheme();
  return (
    <Tab.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={props => <BottomTabs {...props} C={C} />}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} />
      <Tab.Screen name="SitesTab" component={SitesScreen} />
      <Tab.Screen name="HistoryTab" component={HistoryScreen} />
      <Tab.Screen name="SettingsTab" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

// ═══════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════
// OTA update removed temporarily

export default function App() {
  useEffect(() => {
    initDB();
    ensureSitesDir();

  }, []);

  const C = useTheme();

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={() => (
            <ErrorBoundary><TabNavigator /></ErrorBoundary>
          )} />
          <Stack.Screen name="Search" component={SearchScreen} options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="Viewer" component={ViewerScreen} options={{ animation: 'slide_from_right' }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
