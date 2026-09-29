/**
 * IndexedDbManager - Client-side IndexedDB cache for instant startup (<0.15s) and dataset persistence.
 */
class IndexedDbManager {
  constructor(dbName = 'DefectAnalyticsDB', storeName = 'dataset_cache') {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  async openDB() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      try {
        const req = window.indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  async getCache(key = 'latest_records') {
    try {
      const db = await this.openDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);
        req.onsuccess = (e) => resolve(e.target.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  }

  async setCache(records, updatedAt, key = 'latest_records') {
    try {
      const db = await this.openDB();
      if (!db) return;
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.put({ records, updatedAt }, key);
    } catch (e) {}
  }

  async clearCache() {
    try {
      const db = await this.openDB();
      if (!db) return;
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      store.clear();
    } catch (e) {}
  }
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.IndexedDbManager = IndexedDbManager;
