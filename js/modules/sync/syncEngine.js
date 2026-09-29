/**
 * SyncEngine - Manages central server REST API communication, live polling, offline outbox, and BroadcastChannel.
 */
class SyncEngine {
  constructor(dataStore) {
    this.ds = dataStore;
    this.syncIntervalId = null;
    this.activeServerUrl = null;
    this.isSyncing = false;
    this.syncStatus = 'connecting'; // 'connecting' | 'connected' | 'shared_file' | 'disconnected'
    this.lastSyncTime = null;
    this.sharedFileHandle = null;
    this.sharedJsFileHandle = null;
    this.offlineOutbox = [];

    try {
      const savedOutbox = localStorage.getItem('DEFECT_APP_OFFLINE_OUTBOX');
      if (savedOutbox) {
        this.offlineOutbox = JSON.parse(savedOutbox);
      }
    } catch (e) {}

    try {
      this.syncChannel = new BroadcastChannel('defect_app_sync_channel');
      this.syncChannel.onmessage = (event) => {
        if (event.data === 'annotation_updated' || event.data === 'dataset_updated') {
          this.loadServerAnnotations();
        }
      };
    } catch (e) {}
  }

  startAutoSync(intervalMs = 5000) {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }
    this.syncIntervalId = setInterval(async () => {
      // Auto-recovery: If rawRecords is empty in HTTP mode, fetch active dataset from server
      if (this.ds.rawRecords.length === 0 && window.location.protocol !== 'file:') {
        try {
          const res = await fetch('/api/dataset');
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              this.ds.setRecords(data, 'DefectDetails.xls', true);
            }
          }
        } catch (e) {}
      }
      if (window.location.protocol === 'file:') {
        this.reloadSharedFixAnnotationsScript();
      }
      this.loadServerAnnotations();
    }, intervalMs);
  }

  stopAutoSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  reloadSharedFixAnnotationsScript() {
    if (window.location.protocol !== 'file:') return;
    try {
      const oldScript = document.getElementById('fix-annotations-script');
      if (oldScript) {
        const newScript = document.createElement('script');
        newScript.id = 'fix-annotations-script';
        newScript.src = 'data/fix_annotations.js?t=' + Date.now();
        newScript.onload = () => {
          if (window.SHARED_FIX_ANNOTATIONS && typeof window.SHARED_FIX_ANNOTATIONS === 'object') {
            this.ds.mergeAnnotations(window.SHARED_FIX_ANNOTATIONS);
            const changed = this.ds.applyAnnotationsToRecords();
            if (changed > 0) {
              this.ds.buildTree();
              this.ds.notify();
            }
          }
        };
        newScript.onerror = () => {};
        oldScript.parentNode.replaceChild(newScript, oldScript);
      }
    } catch (e) {}
  }

  async getActiveServerUrl() {
    if (window.location.protocol.startsWith('http')) {
      this.activeServerUrl = window.location.origin.replace(/\/$/, '');
      return this.activeServerUrl;
    }

    const candidateSet = new Set();
    try {
      const saved = localStorage.getItem('DEFECT_APP_SERVER_URL');
      if (saved) candidateSet.add(saved.trim().replace(/\/$/, ''));
    } catch (e) {}

    if (window.CENTRAL_SERVER_CONFIG && Array.isArray(window.CENTRAL_SERVER_CONFIG.serverUrls)) {
      window.CENTRAL_SERVER_CONFIG.serverUrls.forEach(url => {
        if (url) candidateSet.add(url.trim().replace(/\/$/, ''));
      });
    }

    const ports = [7500, 7700, 9999, 9000, 8080];
    const hosts = ['localhost', '127.0.0.1'];
    if (window.location.hostname && !hosts.includes(window.location.hostname)) {
      hosts.push(window.location.hostname);
    }
    hosts.forEach(h => {
      ports.forEach(p => candidateSet.add(`http://${h}:${p}`));
    });

    const candidates = Array.from(candidateSet);
    if (candidates.length === 0) return null;

    const probe = (url) => new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('Timeout'));
      }, 1200);

      fetch(`${url}/api/annotations`, { signal: controller.signal, cache: 'no-store' })
        .then(res => {
          clearTimeout(timeoutId);
          if (res.ok) resolve(url);
          else reject(new Error('HTTP Error'));
        })
        .catch(err => {
          clearTimeout(timeoutId);
          reject(err);
        });
    });

    try {
      const activeUrl = await Promise.any(candidates.map(url => probe(url)));
      if (activeUrl) {
        this.activeServerUrl = activeUrl;
        try {
          localStorage.setItem('DEFECT_APP_SERVER_URL', activeUrl);
        } catch (e) {}
        return activeUrl;
      }
    } catch (eAllFailed) {
      this.activeServerUrl = null;
    }

    return null;
  }

  setServerUrl(url) {
    if (url) {
      this.activeServerUrl = url.trim().replace(/\/$/, '');
      localStorage.setItem('DEFECT_APP_SERVER_URL', this.activeServerUrl);
      this.loadServerAnnotations();
    }
  }

  async loadServerAnnotations() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      if (window.mainPanel && typeof window.mainPanel.updateKpiSyncState === 'function') {
        window.mainPanel.updateKpiSyncState('syncing');
      }

      let dataChanged = false;
      const baseUrl = await this.getActiveServerUrl();

      if (baseUrl) {
        try {
          if (this.offlineOutbox.length > 0) {
            await this.flushOfflineOutbox(baseUrl);
          }

          let remoteMtime = "";
          try {
            const resStatus = await fetch(`${baseUrl}/api/status?t=` + Date.now(), { cache: 'no-store' });
            if (resStatus.ok) {
              const statusData = await resStatus.json();
              remoteMtime = statusData.dataset_updated_at || "";
              this.lastSyncTime = new Date();
              this.syncStatus = 'connected';
            }
          } catch (eStatus) {}

          const resAnn = await fetch(`${baseUrl}/api/annotations?t=` + Date.now(), { cache: 'no-store' });
          if (resAnn.ok) {
            const dataAnn = await resAnn.json();
            if (dataAnn && typeof dataAnn === 'object') {
              let hasChange = false;
              for (const [k, v] of Object.entries(dataAnn)) {
                if (!v || typeof v !== 'object') continue;
                const old = this.ds.annotationsMap[k];
                if (!old) {
                  this.ds.annotationsMap[k] = v;
                  hasChange = true;
                } else {
                  const newFix = v.confirmedFix;
                  const oldFix = old.confirmedFix;
                  if (newFix && newFix !== oldFix) {
                    old.confirmedFix = newFix;
                    hasChange = true;
                  }
                  if (v.fixComment !== undefined && v.fixComment !== old.fixComment) {
                    old.fixComment = v.fixComment;
                    hasChange = true;
                  }
                  if (v.solutionMemo !== undefined && v.solutionMemo !== old.solutionMemo) {
                    old.solutionMemo = v.solutionMemo;
                    hasChange = true;
                  }
                }
              }
              if (hasChange) {
                try {
                  localStorage.setItem('DEFECT_APP_FIX_ANNOTATIONS', JSON.stringify(this.ds.annotationsMap));
                } catch (eSave) {}
                this.ds.applyAnnotationsToRecords();
                this.ds.buildTree();
                this.ds.pendingNotify = true;
                dataChanged = true;
              }
            }
            this.lastSyncTime = new Date();
            this.syncStatus = 'connected';
            if (window.mainPanel && typeof window.mainPanel.updateKpiSyncState === 'function') {
              window.mainPanel.updateKpiSyncState('synced');
            }
          }

          const shouldFetchDataset = (this.ds.rawRecords.length === 0) || (remoteMtime && this.ds.lastDatasetFingerprint !== remoteMtime);

          if (shouldFetchDataset) {
            const resDs = await fetch(`${baseUrl}/api/dataset?t=` + Date.now(), { cache: 'no-store' });
            if (resDs.ok) {
              const remoteRecords = await resDs.json();
              if (Array.isArray(remoteRecords) && remoteRecords.length > 0) {
                this.ds.lastDatasetFingerprint = remoteMtime || (remoteRecords.length + '_' + (remoteRecords[0] ? (remoteRecords[0].serialNo || remoteRecords[0].id) : ''));
                if (this.ds.idbManager) {
                  this.ds.idbManager.setCache(remoteRecords, this.ds.lastDatasetFingerprint);
                }
                this.ds.setRecords(remoteRecords, 'DefectDetails.xls', true);
                dataChanged = true;
              }
            }
          }

          const changedCount = this.ds.applyAnnotationsToRecords();
          if (changedCount > 0) dataChanged = true;

          if (dataChanged) {
            this.ds.buildTree();
            this.ds.notify();
          } else {
            this.updateSyncBadgeOnly();
          }
          return;
        } catch (eServer) {}
      }

      // Fallbacks
      const isFileProtocol = (window.location.protocol === 'file:');
      if (isFileProtocol) {
        if (window.SHARED_FIX_ANNOTATIONS) {
          const prevCount = Object.keys(this.ds.annotationsMap).length;
          this.ds.mergeAnnotations(window.SHARED_FIX_ANNOTATIONS);
          if (Object.keys(this.ds.annotationsMap).length !== prevCount) dataChanged = true;
          this.lastSyncTime = new Date();
          this.syncStatus = 'shared_file';
        }

        const fileSource = window.SHARED_DEFECT_DATA || window.INITIAL_DEFECT_DATA;
        if (fileSource && Array.isArray(fileSource) && fileSource.length > 0) {
          if (this.ds.rawRecords.length === 0 || fileSource.length > this.ds.rawRecords.length) {
            this.ds.setRecords(fileSource, 'DefectDetails.xls', true);
            dataChanged = true;
          }
        }

        const changedCount = this.ds.applyAnnotationsToRecords();
        if (changedCount > 0 || dataChanged) {
          this.ds.buildTree();
          this.ds.notify();
        } else {
          this.updateSyncBadgeOnly();
        }
        return;
      }

      let sharedData = null;
      try {
        const resJson = await fetch('data/fix_annotations.json?t=' + Date.now(), { cache: 'no-store' });
        if (resJson.ok) {
          sharedData = await resJson.json();
        }
      } catch (errJson) {}

      if (!sharedData && window.SHARED_FIX_ANNOTATIONS) {
        sharedData = window.SHARED_FIX_ANNOTATIONS;
      }

      if (sharedData) {
        const prevCount = Object.keys(this.ds.annotationsMap).length;
        this.ds.mergeAnnotations(sharedData);
        if (Object.keys(this.ds.annotationsMap).length !== prevCount) dataChanged = true;
        this.lastSyncTime = new Date();
        this.syncStatus = 'shared_file';
      }

      try {
        const resDsFile = await fetch('data/defect_details.json?t=' + Date.now(), { cache: 'no-store' });
        if (resDsFile.ok) {
          const sharedRecords = await resDsFile.json();
          if (Array.isArray(sharedRecords) && sharedRecords.length > 0) {
            if (this.ds.rawRecords.length === 0 || sharedRecords.length > this.ds.rawRecords.length) {
              this.ds.setRecords(sharedRecords, 'DefectDetails.xls', true);
              dataChanged = true;
            }
          }
        }
      } catch (eDs) {}

      if (this.ds.rawRecords.length === 0) {
        const fallbackSource = window.SHARED_DEFECT_DATA || window.INITIAL_DEFECT_DATA;
        if (fallbackSource && Array.isArray(fallbackSource) && fallbackSource.length > 0) {
          this.ds.setRecords(fallbackSource, 'DefectDetails.xls', false);
          dataChanged = true;
        }
      }

      const changedCount = this.ds.applyAnnotationsToRecords();
      if (changedCount > 0 || dataChanged) {
        this.ds.buildTree();
        this.ds.notify();
      } else {
        this.updateSyncBadgeOnly();
      }
    } catch (e) {
      console.warn('[SyncEngine] loadServerAnnotations error:', e);
    } finally {
      this.isSyncing = false;
    }
  }

  triggerStartServer() {
    if (window.mainPanel) {
      window.mainPanel.showToast('📡 Launching background server...');
    }
    try {
      window.location.href = 'defect-app://start';
    } catch (e) {}

    let checks = 0;
    const interval = setInterval(async () => {
      checks++;
      const url = await this.getActiveServerUrl();
      if (url) {
        clearInterval(interval);
        if (window.mainPanel) {
          window.mainPanel.showToast('✅ Backend server connected!');
        }
        this.loadServerAnnotations();
      } else if (checks > 20) {
        clearInterval(interval);
      }
    }, 400);
  }

  async restartServer() {
    if (window.mainPanel) {
      window.mainPanel.showToast('🔄 Restarting background server...');
    }
    const baseUrl = await this.getActiveServerUrl();
    if (baseUrl) {
      try {
        await fetch(`${baseUrl}/api/restart`, { method: 'POST' });
      } catch (e) {}
    }
    setTimeout(() => this.triggerStartServer(), 600);
  }

  updateSyncBadgeOnly() {
    const badge = document.getElementById('live-sync-badge');
    if (!badge) return;

    const timeStr = this.lastSyncTime ? this.lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const isFileProtocol = (window.location.protocol === 'file:');
    const countStr = this.ds.rawRecords.length > 0 ? ` | ${this.ds.rawRecords.length.toLocaleString()} records` : ' | Loading...';

    if (this.offlineOutbox.length > 0 && !isFileProtocol) {
      badge.className = 'sync-status-badge warning';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      badge.style.color = 'var(--accent-amber)';
      badge.innerHTML = `<span class="sync-dot" style="background: var(--accent-amber);"></span> ⚠️ Server Offline (${this.offlineOutbox.length} edit${this.offlineOutbox.length > 1 ? 's' : ''} queued)${countStr}`;
    } else if (this.syncStatus === 'shared_file' || isFileProtocol) {
      badge.className = 'sync-status-badge shared';
      badge.style.borderColor = 'rgba(59, 130, 246, 0.3)';
      badge.style.color = 'var(--accent-blue)';
      badge.innerHTML = `<span class="sync-dot" style="background: var(--accent-blue);"></span> ⚡ Shared Drive Active${countStr}`;
    } else if (this.syncStatus === 'connecting') {
      badge.className = 'sync-status-badge connecting';
      badge.style.borderColor = 'rgba(56, 189, 248, 0.4)';
      badge.style.color = 'var(--accent-blue)';
      badge.innerHTML = `<span class="sync-dot" style="background: var(--accent-blue); animation: pulse-blue 1.2s infinite;"></span> 🔄 Connecting to Server...${countStr}`;
    } else if (this.syncStatus === 'connected') {
      badge.className = 'sync-status-badge connected';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      badge.style.color = 'var(--accent-emerald)';
      badge.innerHTML = `<span class="sync-dot" style="background: var(--accent-emerald);"></span> ⚡ Server Active (${timeStr})${countStr}`;
    } else {
      badge.className = 'sync-status-badge warning';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      badge.style.color = 'var(--accent-amber)';
      badge.innerHTML = `<span class="sync-dot" style="background: var(--accent-amber);"></span> ⚠️ Server Offline${countStr}`;
    }

    if (window.lucide) window.lucide.createIcons();
  }

  enqueueOfflinePayload(payload) {
    const key = payload.key || `${payload.serialNo}_${payload.faDate}`;
    const idx = this.offlineOutbox.findIndex(item => (item.key || `${item.serialNo}_${item.faDate}`) === key);
    if (idx >= 0) {
      this.offlineOutbox[idx] = payload;
    } else {
      this.offlineOutbox.push(payload);
    }
    try {
      localStorage.setItem('DEFECT_APP_OFFLINE_OUTBOX', JSON.stringify(this.offlineOutbox));
    } catch (e) {}
    this.syncStatus = 'offline_queued';
    this.updateSyncBadgeOnly();
    if (window.mainPanel) {
      window.mainPanel.showToast(`⚠️ Server offline. Edit saved locally and queued for auto-sync.`);
    }
  }

  async flushOfflineOutbox(baseUrl) {
    if (!baseUrl || this.offlineOutbox.length === 0) return;
    const itemsToFlush = [...this.offlineOutbox];
    let flushedCount = 0;

    for (const item of itemsToFlush) {
      try {
        const res = await fetch(`${baseUrl}/api/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
        if (res.ok) {
          flushedCount++;
        }
      } catch (e) {
        break;
      }
    }

    if (flushedCount > 0) {
      this.offlineOutbox = this.offlineOutbox.slice(flushedCount);
      try {
        if (this.offlineOutbox.length > 0) {
          localStorage.setItem('DEFECT_APP_OFFLINE_OUTBOX', JSON.stringify(this.offlineOutbox));
        } else {
          localStorage.removeItem('DEFECT_APP_OFFLINE_OUTBOX');
        }
      } catch (e) {}

      if (window.mainPanel) {
        window.mainPanel.showToast(`⚡ Server reconnected! Synced ${flushedCount} offline edit(s).`);
      }
    }
  }
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.SyncEngine = SyncEngine;
