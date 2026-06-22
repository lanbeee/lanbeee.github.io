// ─────────────────────────────────────────────────────────────────────────
// storage.js — Persistence adapter.
//
// The single place that knows about the browser localStorage backend. Every
// other module talks to this `Storage` object, not to localStorage directly.
// When the app is ported to React Native this file becomes a 5-line MMKV
// wrapper and every consumer keeps working unchanged.
//
// RN port target: src/data/storage.ts
//   import { MMKV } from 'react-native-mmkv'
//   const kv = new MMKV()
//   export const Storage = {
//     read: (key) => { const v = kv.getString(key); return v ? JSON.parse(v) : null },
//     write: (key, value) => kv.set(key, JSON.stringify(value)),
//   }
//
// IMPORTANT: loaded before data.js. See index.html script order.
// ─────────────────────────────────────────────────────────────────────────

const Storage = {
  /**
   * Read and JSON-parse a key. Returns null if the key is missing or invalid.
   * @param {string} key
   * @returns {any}
   */
  read(key){
    try { return JSON.parse(localStorage.getItem(key) ?? 'null'); }
    catch { return null; }
  },
  /**
   * Serialize and write a value. Callers that need to measure byte size
   * before writing (see data.js save()) should call writeRaw instead.
   * @param {string} key
   * @param {any} value
   */
  write(key, value){
    localStorage.setItem(key, JSON.stringify(value));
  },
  /**
   * Write an already-stringified value. Used by data.js save() which
   * pre-measures the JSON to enforce the storage quota.
   * @param {string} key
   * @param {string} json
   */
  writeRaw(key, json){
    localStorage.setItem(key, json);
  },
};
