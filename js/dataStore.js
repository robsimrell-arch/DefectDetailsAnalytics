/**
 * DataStore - Manages raw defect records, 5-level tree hierarchy, deduplication & dataset merging, central server REST API publishing, and Live Polling
 */
class DataStore {
  constructor() {
    this.rawRecords = [];
    this.treeData = [];
    this.selectedNode = null; // { level: 1..5, customer, parentPartNo, processRecorded, defectDescription, refDes }
    this.searchQuery = '';
    this.searchTarget = 'all'; // 'all' | 'refDes' | 'serialNo' | 'failureComments' | 'comments' | 'parts'
    this.fixFilter = 'all'; // 'all' | 'Yes' | 'No' | 'Pending'
    this.datePreset = 'all'; // 'all' | '7d' | '30d' | '90d' | 'custom'
    this.startDate = '';
    this.endDate = '';
    this.currentFilename = 'DefectDetails.xls';
    this.annotationsMap = {}; // key: `${serialNo}_${faDate}` -> { confirmedFix, fixComment, updatedAt }
    this.lastSyncTime = null;
    this.syncStatus = 'connecting'; // 'connecting' | 'connected' | 'shared_file' | 'disconnected'
    this.listeners = [];
    this.sharedFileHandle = null;

    // Default Central Server URL for file:// shared drive shortcuts
    this.defaultServerUrl = 'http://localhost:8080';
    this.activeServerUrl = null;
    this.isSyncing = false;
    this.syncIntervalId = null;
    this.offlineOutbox = [];

    try {
      const savedOutbox = localStorage.getItem('DEFECT_APP_OFFLINE_OUTBOX');
      if (savedOutbox) {
        this.offlineOutbox = JSON.parse(savedOutbox);
      }
    } catch (e) {}

    try {
      // Always purge local storage annotations cache on startup so all workstations read server API
      localStorage.removeItem('DEFECT_APP_FIX_ANNOTATIONS');
      localStorage.removeItem('DEFECT_APP_SAVED_DATA');
      localStorage.removeItem('DEFECT_APP_SAVED_FILENAME');
      localStorage.removeItem('DEFECT_APP_SAVED_TIMESTAMP');
    } catch (e) {}

    try {
      this.syncChannel = new BroadcastChannel('defect_app_sync_channel');
      this.syncChannel.onmessage = (event) => {
        if (event.data === 'annotation_updated' || event.data === 'dataset_updated') {
          this.loadServerAnnotations();
        }
      };
    } catch (e) {}

    window.addEventListener('storage', (e) => {
      if (e.key === 'DEFECT_APP_FIX_ANNOTATIONS' || e.key === 'DEFECT_APP_SAVED_DATA') {
        this.loadServerAnnotations();
      }
    });

    document.addEventListener('focusout', () => {
      if (this.pendingNotify) {
        setTimeout(() => {
          const activeEl = document.activeElement;
          if (!activeEl || (activeEl.tagName !== 'SELECT' && activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA')) {
            this.notify();
          }
        }, 150);
      }
    });

    this.initInitialAnnotations();
    this.updateSyncBadgeOnly();
    this.loadInitialDatasetAsync();
  }

  async loadInitialDatasetAsync() {
    if (window.location.protocol !== 'file:') {
      try {
        const res = await fetch('/api/dataset?t=' + Date.now());
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            console.log('[DataStore] Auto-loaded ' + data.length + ' records from /api/dataset');
            this.setRecords(data, 'DefectDetails.xls', true);
          }
        }
      } catch (e) {
        console.warn('[DataStore] loadInitialDatasetAsync failed:', e);
      }
    }
  }

  initInitialAnnotations() {
    this.annotationsMap = {};
    if (window.SHARED_FIX_ANNOTATIONS && typeof window.SHARED_FIX_ANNOTATIONS === 'object') {
      this.annotationsMap = JSON.parse(JSON.stringify(window.SHARED_FIX_ANNOTATIONS));
    }
  }

  mergeAnnotations(remoteData) {
    if (!remoteData || typeof remoteData !== 'object') return;
    const getMillis = (isoStr) => (isoStr ? new Date(isoStr).getTime() : 0);

    Object.keys(remoteData).forEach(key => {
      const remote = remoteData[key];
      const local = this.annotationsMap[key];

      if (!local) {
        this.annotationsMap[key] = remote;
      } else {
        const tRemote = getMillis(remote ? remote.updatedAt : null);
        const tLocal = getMillis(local ? local.updatedAt : null);
        if (tRemote >= tLocal) {
          this.annotationsMap[key] = remote;
        }
      }
    });
  }

  getAnnotationCounts() {
    if (this.rawRecords && this.rawRecords.length > 0) {
      let yes = 0;
      let no = 0;
      for (let i = 0; i < this.rawRecords.length; i++) {
        const fix = this.rawRecords[i].confirmedFix;
        if (fix === 'Yes') yes++;
        else if (fix === 'No') no++;
      }
      return { yes, no };
    }

    const uniqueYes = new Set();
    const uniqueNo = new Set();
    const map = this.annotationsMap || {};
    Object.values(map).forEach(ann => {
      if (!ann || typeof ann !== 'object') return;
      const fix = ann.confirmedFix;
      if (fix !== 'Yes' && fix !== 'No') return;
      const key = ann.key || (ann.serialNo && ann.faDate ? `${ann.serialNo}_${ann.faDate}` : '');
      if (!key) return;
      if (fix === 'Yes') {
        uniqueYes.add(key);
        uniqueNo.delete(key);
      } else if (fix === 'No') {
        if (!uniqueYes.has(key)) uniqueNo.add(key);
      }
    });

    return {
      yes: uniqueYes.size,
      no: uniqueNo.size
    };
  }

  clearLocalCache() {
    try {
      localStorage.removeItem('DEFECT_APP_FIX_ANNOTATIONS');
      localStorage.removeItem('DEFECT_APP_SAVED_DATA');
      localStorage.removeItem('DEFECT_APP_SAVED_FILENAME');
      localStorage.removeItem('DEFECT_APP_SAVED_TIMESTAMP');
      localStorage.removeItem('DEFECT_APP_OFFLINE_OUTBOX');
    } catch (e) {}
    this.offlineOutbox = [];
    this.annotationsMap = {};
    if (window.SHARED_FIX_ANNOTATIONS && typeof window.SHARED_FIX_ANNOTATIONS === 'object') {
      this.annotationsMap = JSON.parse(JSON.stringify(window.SHARED_FIX_ANNOTATIONS));
    }
    this.forceSyncNow();
  }

  async forceSyncNow() {
    this.activeServerUrl = null;
    this.isSyncing = false;
    if (window.location.protocol === 'file:') {
      this.reloadSharedFixAnnotationsScript();
    }
    await this.loadServerAnnotations();
    if (window.mainPanel) {
      const statusLabel = this.syncStatus === 'connected' 
        ? `Server (${this.activeServerUrl})` 
        : (this.syncStatus === 'shared_file' ? 'Shared Drive File' : 'Local State');
      window.mainPanel.showToast(`⚡ Live sync completed [${statusLabel}]`);
    }
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }

  notify(force = false) {
    const activeEl = document.activeElement;
    if (!force && activeEl && (
      activeEl.classList.contains('fix-comment-textarea') || 
      activeEl.classList.contains('table-inline-input')
    )) {
      this.pendingNotify = true;
      return;
    }
    this.pendingNotify = false;
    this.listeners.forEach(fn => {
      try { fn(); } catch (e) { console.error('Listener error:', e); }
    });
    if (window.treeView) { try { window.treeView.render(); } catch (e) {} }
    if (window.mainPanel) { try { window.mainPanel.render(); } catch (e) {} }
  }

  parseDate(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  normalizeDateKey(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const pad = n => String(n).padStart(2, '0');
      // Format as YYYY-MM-DD HH:mm (ignoring seconds differences)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    // Fallback: clean raw string (strip seconds if pattern matches, e.g. "10:12:58" -> "10:12")
    return String(dateStr).trim().toLowerCase().replace(/:\d{2}(\s*[ap]m)/i, '$1');
  }

  startAutoSync(intervalMs = 5000) {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
    }
    this.syncIntervalId = setInterval(async () => {
      // Auto-recovery: If rawRecords is empty in HTTP mode, fetch active dataset from server
      if (this.rawRecords.length === 0 && window.location.protocol !== 'file:') {
        try {
          const res = await fetch('/api/dataset?t=' + Date.now());
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              this.setRecords(data, 'DefectDetails.xls', true);
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

  reloadSharedFixAnnotationsScript() {
    if (window.location.protocol !== 'file:') return;
    try {
      // Legacy file:// protocol script reloader
      const oldScript = document.getElementById('fix-annotations-script');
      if (oldScript) {
        const newScript = document.createElement('script');
        newScript.id = 'fix-annotations-script';
        newScript.src = 'data/fix_annotations.js?t=' + Date.now();
        newScript.onload = () => {
          if (window.SHARED_FIX_ANNOTATIONS && typeof window.SHARED_FIX_ANNOTATIONS === 'object') {
            this.mergeAnnotations(window.SHARED_FIX_ANNOTATIONS);
            const changed = this.applyAnnotationsToRecords();
            if (changed > 0) {
              this.buildTree();
              this.notify();
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

    if (window.location.protocol.startsWith('http')) {
      candidateSet.add(window.location.origin.replace(/\/$/, ''));
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

    // Fast parallel probe: whichever server responds first wins in sub-second time
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
      let dataChanged = false;
      const baseUrl = await this.getActiveServerUrl();

      if (baseUrl) {
        try {
          if (this.offlineOutbox.length > 0) {
            await this.flushOfflineOutbox(baseUrl);
          }

          // 1. Poll ultra-fast 100-byte status endpoint for dataset timestamp
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

          // 2. Fetch live annotations (tiny 2KB payload)
          const resAnn = await fetch(`${baseUrl}/api/annotations?t=` + Date.now(), { cache: 'no-store' });
          if (resAnn.ok) {
            const dataAnn = await resAnn.json();
            if (dataAnn && typeof dataAnn === 'object') {
              const oldKeys = Object.keys(this.annotationsMap);
              const newKeys = Object.keys(dataAnn);
              let hasChange = (oldKeys.length !== newKeys.length);
              if (!hasChange) {
                for (let k of newKeys) {
                  const oldItem = this.annotationsMap[k];
                  const newItem = dataAnn[k];
                  if (!oldItem || oldItem.confirmedFix !== newItem.confirmedFix || oldItem.fixComment !== newItem.fixComment) {
                    hasChange = true;
                    break;
                  }
                }
              }
              if (hasChange) {
                this.annotationsMap = dataAnn;
                dataChanged = true;
              }
            }
            this.lastSyncTime = new Date();
            this.syncStatus = 'connected';
          }

          // 3. ONLY fetch 27.8MB dataset if rawRecords is empty OR dataset timestamp has changed!
          const shouldFetchDataset = (this.rawRecords.length === 0) || (remoteMtime && this.lastDatasetFingerprint !== remoteMtime);

          if (shouldFetchDataset) {
            const resDs = await fetch(`${baseUrl}/api/dataset?t=` + Date.now(), { cache: 'no-store' });
            if (resDs.ok) {
              const remoteRecords = await resDs.json();
              if (Array.isArray(remoteRecords) && remoteRecords.length > 0) {
                this.lastDatasetFingerprint = remoteMtime || (remoteRecords.length + '_' + (remoteRecords[0] ? (remoteRecords[0].serialNo || remoteRecords[0].id) : ''));
                this.setRecords(remoteRecords, 'DefectDetails.xls', true);
                dataChanged = true;
              }
            }
          }

          const changedCount = this.applyAnnotationsToRecords();
          if (changedCount > 0) dataChanged = true;

          if (dataChanged) {
            this.buildTree();
            this.notify();
          } else {
            this.updateSyncBadgeOnly();
          }
          return;
        } catch (eServer) {}
      }

      // Fallback if local server.exe is not running
      var isFileProtocol = (window.location.protocol === 'file:');
      if (isFileProtocol) {
        if (window.SHARED_FIX_ANNOTATIONS) {
          const prevCount = Object.keys(this.annotationsMap).length;
          this.mergeAnnotations(window.SHARED_FIX_ANNOTATIONS);
          if (Object.keys(this.annotationsMap).length !== prevCount) dataChanged = true;
          this.lastSyncTime = new Date();
          this.syncStatus = 'shared_file';
        }

        var fileSource = window.SHARED_DEFECT_DATA || window.INITIAL_DEFECT_DATA;
        if (fileSource && Array.isArray(fileSource) && fileSource.length > 0) {
          if (this.rawRecords.length === 0 || fileSource.length > this.rawRecords.length) {
            this.setRecords(fileSource, 'DefectDetails.xls', true);
            dataChanged = true;
          }
        }

        const changedCount = this.applyAnnotationsToRecords();
        if (changedCount > 0 || dataChanged) {
          this.buildTree();
          this.notify();
        } else {
          this.updateSyncBadgeOnly();
        }
        return;
      }

      // HTTP static file fallback
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
        const prevCount = Object.keys(this.annotationsMap).length;
        this.mergeAnnotations(sharedData);
        if (Object.keys(this.annotationsMap).length !== prevCount) dataChanged = true;
        this.lastSyncTime = new Date();
        this.syncStatus = 'shared_file';
      }

      try {
        const resDsFile = await fetch('data/defect_details.json?t=' + Date.now(), { cache: 'no-store' });
        if (resDsFile.ok) {
          const sharedRecords = await resDsFile.json();
          if (Array.isArray(sharedRecords) && sharedRecords.length > 0) {
            if (this.rawRecords.length === 0 || sharedRecords.length > this.rawRecords.length) {
              this.setRecords(sharedRecords, 'DefectDetails.xls', true);
              dataChanged = true;
            }
          }
        }
      } catch (eDs) {}

      if (this.rawRecords.length === 0) {
        const fallbackSource = window.SHARED_DEFECT_DATA || window.INITIAL_DEFECT_DATA;
        if (fallbackSource && Array.isArray(fallbackSource) && fallbackSource.length > 0) {
          this.setRecords(fallbackSource, 'DefectDetails.xls', false);
          dataChanged = true;
        }
      }

      const changedCount = this.applyAnnotationsToRecords();
      if (changedCount > 0 || dataChanged) {
        this.buildTree();
        this.notify();
      } else {
        this.updateSyncBadgeOnly();
      }
    } catch (e) {
      console.warn('[DataStore] loadServerAnnotations error:', e);
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
    const countStr = this.rawRecords.length > 0 ? ` | ${this.rawRecords.length.toLocaleString()} records` : ' | Loading...';

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

  async autoSaveSharedFixes() {
    if (this.sharedFileHandle) {
      try {
        // Write the .json file
        const jsonStr = JSON.stringify(this.annotationsMap, null, 2);
        const writable = await this.sharedFileHandle.createWritable();
        await writable.write(jsonStr);
        await writable.close();

        // Also write the .js file so other users on file:// can auto-read via script tag reload
        if (this.sharedJsFileHandle) {
          try {
            const jsStr = `window.SHARED_FIX_ANNOTATIONS = ${jsonStr};\n`;
            const jsWritable = await this.sharedJsFileHandle.createWritable();
            await jsWritable.write(jsStr);
            await jsWritable.close();
          } catch (e) {
            console.warn('Could not write .js companion file:', e);
          }
        }

        this.lastSyncTime = new Date();
        this.syncStatus = 'shared_file';
        this.updateSyncBadgeOnly();
        return true;
      } catch (err) {
        console.warn('Silent background save to shared file handle failed:', err);
        this.sharedFileHandle = null;
      }
    }
    return false;
  }

  async bindSharedFileForAutoSave() {
    try {
      if (window.showOpenFilePicker) {
        const [jsonHandle] = await window.showOpenFilePicker({
          types: [{
            description: 'JSON Fix Annotations File',
            accept: { 'application/json': ['.json'] },
          }],
          multiple: false
        });
        this.sharedFileHandle = jsonHandle;
        this.lastSyncTime = new Date();
        this.syncStatus = 'shared_file';
        this.updateSyncBadgeOnly();
        await this.autoSaveSharedFixes();
        if (window.mainPanel) {
          window.mainPanel.showToast('⚡ Shared drive file connected for auto-save!');
        }
        return;
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('showOpenFilePicker failed, falling back to showSaveFilePicker:', err);
    }

    if (window.showSaveFilePicker) {
      try {
        const jsonHandle = await window.showSaveFilePicker({
          suggestedName: 'fix_annotations.json',
          types: [{
            description: 'JSON Fix Annotations File',
            accept: { 'application/json': ['.json'] },
          }],
        });
        this.sharedFileHandle = jsonHandle;
        await this.autoSaveSharedFixes();
        if (window.mainPanel) {
          window.mainPanel.showToast('⚡ Shared drive file connected for auto-save!');
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
  }

  async exportFixAnnotations() {
    const jsonStr = JSON.stringify(this.annotationsMap, null, 2);
    const jsStr = `window.SHARED_FIX_ANNOTATIONS = ${jsonStr};\n`;

    // Clear offline queued edits since we are publishing all annotations
    this.offlineOutbox = [];
    try {
      localStorage.removeItem('DEFECT_APP_OFFLINE_OUTBOX');
    } catch (e) {}

    if (window.showSaveFilePicker) {
      try {
        const pickerOptions = {
          id: 'defect_dashboard_shared_drive_folder',
          suggestedName: 'fix_annotations.js',
          types: [{
            description: 'JavaScript Fix Annotations File',
            accept: { 'application/javascript': ['.js'] },
          }],
        };

        if (this.sharedFileHandle) {
          pickerOptions.startIn = this.sharedFileHandle;
        }

        const handle = await window.showSaveFilePicker(pickerOptions);
        this.sharedFileHandle = handle;
        const writable = await handle.createWritable();
        await writable.write(jsStr);
        await writable.close();

        this.lastSyncTime = new Date();
        this.syncStatus = 'shared_file';
        this.updateSyncBadgeOnly();
        if (window.mainPanel) {
          window.mainPanel.showToast('✅ Published fix updates to shared drive! Other stations will sync within 3 seconds.');
        } else {
          alert('✅ Published fix updates to shared drive! Other stations will sync within 3 seconds.');
        }
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    const blob = new Blob([jsStr], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fix_annotations.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.lastSyncTime = new Date();
    this.syncStatus = 'shared_file';
    this.updateSyncBadgeOnly();

    alert(
      '📥 Generated updated fix_annotations.js file!\n\n' +
      'Please save/overwrite fix_annotations.js inside the data/ folder on your shared drive so all team members see your fix updates.'
    );
  }

  applyAnnotationsToRecords() {
    const getMillis = (isoStr) => (isoStr ? new Date(isoStr).getTime() : 0);
    let changedCount = 0;

    this.rawRecords.forEach(rec => {
      const sn = (rec.serialNo || '').trim();
      const dt = (rec.faDate || '').trim();
      const ref = (rec.refDes || '').trim();
      const desc = (rec.defectDescription || '').trim();

      const normDt = this.normalizeDateKey(dt);
      const key4 = `${sn}_${dt}_${ref}_${desc}`;
      const rawKey4 = `${rec.serialNo}_${rec.faDate}_${rec.refDes}_${rec.defectDescription}`;
      const normKey4 = normDt ? `${sn}_${normDt}_${ref}_${desc}` : null;
      const key2 = `${sn}_${dt}`;
      const rawKey2 = `${rec.serialNo}_${rec.faDate}`;
      const normKey2 = normDt ? `${sn}_${normDt}` : null;

      const specificKeys = [key4, rawKey4, normKey4, key2, rawKey2, normKey2].filter(Boolean);

      let bestAnn = null;
      let maxTime = -1;

      specificKeys.forEach(k => {
        const ann = this.annotationsMap[k];
        if (ann) {
          const t = getMillis(ann.updatedAt);
          if (t >= maxTime) {
            maxTime = t;
            bestAnn = ann;
          }
        }
      });

      if (!bestAnn && sn && this.annotationsMap[sn]) {
        bestAnn = this.annotationsMap[sn];
      }

      const newFix = bestAnn ? (bestAnn.confirmedFix || 'Pending') : 'Pending';
      const newComment = bestAnn ? (bestAnn.fixComment || '') : '';

      if (rec.confirmedFix !== newFix || rec.fixComment !== newComment) {
        rec.confirmedFix = newFix;
        rec.fixComment = newComment;
        rec._searchStr = this.buildSearchStr(rec);
        changedCount++;
      }
    });

    return changedCount;
  }

  async updateFixAnnotation(serialNo, faDate, confirmedFix, fixComment, refDes = '', defectDescription = '') {
    const sn = (serialNo || '').trim();
    const dt = (faDate || '').trim();
    const ref = (refDes || '').trim();
    const desc = (defectDescription || '').trim();

    const nowIso = new Date().toISOString();
    const key4 = `${sn}_${dt}_${ref}_${desc}`;
    const key2 = `${sn}_${dt}`;

    const payload = {
      key: key4,
      serialNo: sn,
      faDate: dt,
      refDes: ref,
      defectDescription: desc,
      confirmedFix: confirmedFix || 'Pending',
      fixComment: (fixComment || '').trim(),
      updatedAt: nowIso
    };

    this.annotationsMap[key4] = payload;
    if (key2 && key2 !== key4) {
      this.annotationsMap[key2] = {
        ...payload,
        key: key2
      };
    }

    this.applyAnnotationsToRecords();

    try {
      localStorage.setItem('DEFECT_APP_FIX_ANNOTATIONS', JSON.stringify(this.annotationsMap));
      if (this.syncChannel) {
        this.syncChannel.postMessage('annotation_updated');
      }
    } catch (e) {}

    let sentSuccess = false;

    // 0. Save directly to SharePoint List
    try {
      const spOk = await this.saveSharePointAnnotation(payload);
      if (spOk) {
        sentSuccess = true;
        this.lastSyncTime = new Date();
        this.syncStatus = 'sharepoint';
        this.updateSyncBadgeOnly();
      }
    } catch (eSP) {
      console.warn('SharePoint direct save warning:', eSP);
    }

    // 1. Native Desktop API save (pywebview bridge)
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_annotation) {
      try {
        await window.pywebview.api.save_annotation(JSON.stringify(payload));
        sentSuccess = true;
        this.lastSyncTime = new Date();
        this.syncStatus = 'shared_file';
        this.updateSyncBadgeOnly();
      } catch (e) {
        console.warn('Native pywebview API save error:', e);
      }
    }

    const baseUrl = await this.getActiveServerUrl();

    if (baseUrl) {
      try {
        const res1 = await fetch(`${baseUrl}/api/annotations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (key2 && key2 !== key4) {
          const payload2 = { ...payload, key: key2 };
          await fetch(`${baseUrl}/api/annotations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload2)
          });
        }
        if (res1.ok) {
          sentSuccess = true;
          this.lastSyncTime = new Date();
          this.syncStatus = 'connected';
          this.updateSyncBadgeOnly();
        }
      } catch (e) {
        console.warn('Could not post annotation update to server:', e);
      }
    }

    if (!sentSuccess) {
      if (this.sharedFileHandle) {
        await this.autoSaveSharedFixes();
      } else {
        this.enqueueOfflinePayload(payload);
      }
    }

    this.buildTree();
    this.notify(true);
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

  setFixFilter(filter) {
    this.fixFilter = filter || 'all';
    this.buildTree();
    this.notify();
  }

  saveToLocalStorage(records, filename = 'Imported Dataset') {
    try {
      localStorage.setItem('DEFECT_APP_SAVED_DATA', JSON.stringify(records));
      localStorage.setItem('DEFECT_APP_SAVED_FILENAME', filename);
      localStorage.setItem('DEFECT_APP_SAVED_TIMESTAMP', new Date().toLocaleString());
    } catch (e) {
      console.warn('LocalStorage quota exceeded or unavailable:', e);
    }
  }

  loadFromLocalStorage() {
    try {
      const dataStr = localStorage.getItem('DEFECT_APP_SAVED_DATA');
      if (dataStr) {
        const records = JSON.parse(dataStr);
        const filename = localStorage.getItem('DEFECT_APP_SAVED_FILENAME') || 'Saved Dataset';
        const timestamp = localStorage.getItem('DEFECT_APP_SAVED_TIMESTAMP') || '';
        return { records, filename, timestamp };
      }
    } catch (e) {
      console.warn('Failed to load dataset from LocalStorage:', e);
    }
    return null;
  }

  clearSavedData() {
    localStorage.removeItem('DEFECT_APP_SAVED_DATA');
    localStorage.removeItem('DEFECT_APP_SAVED_FILENAME');
    localStorage.removeItem('DEFECT_APP_SAVED_TIMESTAMP');
  }

  deriveCustomer(r, parentPart, serialNo) {
    let c = (r.customer || r['Customer'] || r['Customer Name'] || r['Customer Code'] || '').toString().trim().toUpperCase();
    if (c && c !== 'UNK' && c !== 'UNKNOWN') {
      return c.substring(0, 3);
    }

    const p = (parentPart || '').toString().trim().toUpperCase();
    const s = (serialNo || '').toString().trim().toUpperCase();

    const cleanP = p.replace(/[^A-Z]/g, '');
    if (cleanP.length >= 3) {
      return cleanP.substring(0, 3);
    }

    const matchS = s.match(/[0-9]{2,4}([A-Z]{3})[0-9]/);
    if (matchS) {
      return matchS[1].substring(0, 3);
    }

    if (p.length >= 3) {
      return p.substring(0, 3);
    }

    return 'UNK';
  }

  normalizeRecord(r, idx) {
    const parentPart = (r.parentPartNo || r['Parent Part No.'] || 'UNKNOWN').toString().trim();
    const refDesRaw = (r.refDes || r['Ref Des'] || '').toString().trim();
    const serialNo = (r.serialNo || r['Serial No.'] || '').toString().trim();
    const faDate = (r.faDate || r['F.A. Date'] || '').toString().trim();
    const processRecorded = (r.processRecorded || r['Process Recorded'] || 'UNSPECIFIED PROCESS').toString().trim();
    const customer = this.deriveCustomer(r, parentPart, serialNo);

    const rec = {
      id: r.id || (idx + 1),
      customer: customer,
      parentPartNo: parentPart,
      processRecorded: processRecorded ? processRecorded : 'UNSPECIFIED PROCESS',
      serialNo: serialNo,
      faDate: faDate,
      whoFailed: (r.whoFailed || r['Who Failed'] || '').toString().trim(),
      failureCode: (r.failureCode || r['Failure Code'] || '').toString().trim(),
      failureDescription: (r.failureDescription || r['Failure Description'] || '').toString().trim(),
      failureComment: (r.failureComment || r['Failure Comment'] || '').toString().trim(),
      defectCode: (r.defectCode || r['Defect Code'] || '').toString().trim(),
      defectDescription: (r.defectDescription || r['Defect Description'] || 'UNSPECIFIED DEFECT').toString().trim(),
      debugTech: (r.debugTech || r['Debug Tech'] || '').toString().trim(),
      defectComment: (r.defectComment || r['Defect Comment'] || '').toString().trim(),
      defectQuantity: parseInt(r.defectQuantity || r['Defect Quantity'] || 1, 10) || 1,
      refDes: refDesRaw ? refDesRaw : '[Unassigned Ref Des]',
      repairCode: (r.repairCode || r['Repair Code'] || '').toString().trim(),
      repairDescription: (r.repairDescription || r['Repair Description'] || '').toString().trim(),
      repairTech: (r.repairTech || r['Repair Tech'] || '').toString().trim(),
      repairComment: (r.repairComment || r['Repair Comment'] || '').toString().trim(),
      confirmedFix: r.confirmedFix || 'Pending',
      fixComment: r.fixComment || ''
    };

    rec._timestamp = this.parseDate(rec.faDate);
    rec._searchStr = this.buildSearchStr(rec);

    return rec;
  }

  buildSearchStr(rec) {
    const fixTerms = rec.confirmedFix === 'Yes' 
      ? 'yes confirmed solution fix' 
      : (rec.confirmedFix === 'No' ? 'no failed fix' : 'pending');
    return `${rec.customer} ${rec.parentPartNo} ${rec.processRecorded} ${rec.defectDescription} ${rec.refDes} ${rec.serialNo} ${rec.defectComment} ${rec.failureComment} ${rec.failureDescription} ${rec.repairComment} ${rec.repairDescription} ${rec.fixComment} ${rec.whoFailed} ${rec.debugTech} ${rec.repairTech} ${rec.failureCode} ${rec.defectCode} ${rec.repairCode} ${fixTerms}`.toLowerCase();
  }

  getMinMaxDates() {
    let minTime = Infinity;
    let maxTime = -Infinity;

    this.rawRecords.forEach(r => {
      const t = this.parseDate(r.faDate);
      if (t > 0) {
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;
      }
    });

    let minDateStr = '';
    let maxDateStr = '';

    if (minTime !== Infinity && maxTime !== -Infinity) {
      const minD = new Date(minTime);
      const maxD = new Date(maxTime);
      const pad = num => String(num).padStart(2, '0');
      minDateStr = `${minD.getFullYear()}-${pad(minD.getMonth() + 1)}-${pad(minD.getDate())}`;
      maxDateStr = `${maxD.getFullYear()}-${pad(maxD.getMonth() + 1)}-${pad(maxD.getDate())}`;
    }

    return { minDateStr, maxDateStr, minTime, maxTime };
  }

  isDateInFilter(dateStr) {
    if (this.datePreset === 'all') return true;
    if (!this.startDate && !this.endDate) return true;

    const time = this.parseDate(dateStr);
    if (!time) return true;

    if (this.startDate) {
      const parts = this.startDate.split('-');
      if (parts.length === 3) {
        const startTime = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0, 0).getTime();
        if (!isNaN(startTime) && time < startTime) return false;
      }
    }

    if (this.endDate) {
      const parts = this.endDate.split('-');
      if (parts.length === 3) {
        const endTime = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 23, 59, 59, 999).getTime();
        if (!isNaN(endTime) && time > endTime) return false;
      }
    }

    return true;
  }

  setDateRange(preset = 'custom', startDate = '', endDate = '') {
    this.datePreset = preset;
    this.startDate = startDate;
    this.endDate = endDate;
    this.buildTree();
    this.notify();
  }

  applyDatePreset(preset) {
    this.datePreset = preset;
    const { minDateStr, maxDateStr, maxTime } = this.getMinMaxDates();

    if (preset === 'all' || !maxTime || maxTime <= 0) {
      this.startDate = minDateStr;
      this.endDate = maxDateStr;
    } else {
      const maxD = new Date(maxTime);
      const pad = num => String(num).padStart(2, '0');
      this.endDate = `${maxD.getFullYear()}-${pad(maxD.getMonth() + 1)}-${pad(maxD.getDate())}`;

      let days = 30;
      if (preset === '7d') days = 7;
      if (preset === '90d') days = 90;

      const startD = new Date(maxTime - (days * 24 * 60 * 60 * 1000));
      this.startDate = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-${pad(startD.getDate())}`;
    }

    this.buildTree();
    this.notify();
  }

  updateDateInputsUI() {
    const presetSelect = document.getElementById('tree-date-preset');
    const startInput = document.getElementById('tree-date-start');
    const endInput = document.getElementById('tree-date-end');
    const { minDateStr, maxDateStr } = this.getMinMaxDates();

    if (presetSelect && presetSelect.value !== this.datePreset) {
      presetSelect.value = this.datePreset;
    }
    if (startInput) {
      startInput.min = minDateStr || '';
      startInput.max = maxDateStr || '';
      if (startInput.value !== this.startDate) {
        startInput.value = this.startDate || '';
      }
    }
    if (endInput) {
      endInput.min = minDateStr || '';
      endInput.max = maxDateStr || '';
      if (endInput.value !== this.endDate) {
        endInput.value = this.endDate || '';
      }
    }
  }

  setRecords(records, filename = 'DefectDetails.xls', shouldSaveToStorage = true) {
    if (!records || records.length === 0) {
      if (window.INITIAL_DEFECT_DATA && window.INITIAL_DEFECT_DATA.length > 0) {
        records = window.INITIAL_DEFECT_DATA;
      } else {
        records = [];
      }
    }

    this.currentFilename = filename;
    this.rawRecords = records.map((r, idx) => this.normalizeRecord(r, idx));

    this.applyAnnotationsToRecords();

    // Raw records loaded successfully

    this.rawRecords.sort((a, b) => this.parseDate(b.faDate) - this.parseDate(a.faDate));

    const { minDateStr, maxDateStr } = this.getMinMaxDates();
    if (this.datePreset === 'all' || !this.startDate || !this.endDate) {
      this.startDate = minDateStr;
      this.endDate = maxDateStr;
    }

    this.buildTree();

    if (this.treeData.length === 0 && this.rawRecords.length > 0) {
      this.searchQuery = '';
      this.searchTarget = 'all';
      this.fixFilter = 'all';
      this.datePreset = 'all';
      this.startDate = minDateStr;
      this.endDate = maxDateStr;
      this.buildTree();
    }
    
    this.selectedNode = null;
    this.notify();

    const loader = document.getElementById('app-startup-loader');
    if (loader) {
      setTimeout(() => loader.classList.add('hidden'), 100);
    }
  }

  /**
   * Merge imported dataset into existing records with deduplication
   * Composite Key: Serial No. + F.A. Date + Ref Des + Defect Description
   */
  async mergeRecords(newRecords, filename) {
    this.currentFilename = filename;
    
    // Build map of existing records by exact composite key and normalized date key
    const existingMap = new Map();
    const normalizedMap = new Map();

    this.rawRecords.forEach(r => {
      const sn = (r.serialNo || '').trim();
      const dt = (r.faDate || '').trim();
      const normDt = this.normalizeDateKey(dt);
      const ref = (r.refDes || '').trim();
      const desc = (r.defectDescription || '').trim();

      const exactKey = `${sn}_${dt}_${ref}_${desc}`;
      const normKey = `${sn}_${normDt}_${ref}_${desc}`;

      existingMap.set(exactKey, r);
      if (normDt) {
        normalizedMap.set(normKey, r);
      }
    });

    let addedCount = 0;
    let updatedCount = 0;

    newRecords.forEach((raw, idx) => {
      const rec = this.normalizeRecord(raw, idx);
      const sn = (rec.serialNo || '').trim();
      const dt = (rec.faDate || '').trim();
      const normDt = this.normalizeDateKey(dt);
      const ref = (rec.refDes || '').trim();
      const desc = (rec.defectDescription || '').trim();

      const exactKey = `${sn}_${dt}_${ref}_${desc}`;
      const normKey = `${sn}_${normDt}_${ref}_${desc}`;

      // Check if record exists via exact key OR normalized timestamp key (seconds-tolerant)
      let existing = existingMap.get(exactKey);
      if (!existing && normDt) {
        existing = normalizedMap.get(normKey);
      }

      if (existing) {
        // Record exists: update missing or newer non-empty fields
        let wasUpdated = false;

        const updateFields = [
          'failureComment', 'defectComment', 'debugTech', 'whoFailed',
          'repairComment', 'repairTech', 'repairDescription', 'failureCode',
          'defectCode', 'processRecorded'
        ];

        updateFields.forEach(field => {
          if (rec[field] && rec[field] !== existing[field]) {
            existing[field] = rec[field];
            wasUpdated = true;
          }
        });

        // If the new record has a more detailed timestamp (e.g. includes seconds), upgrade it
        if (dt.length > (existing.faDate || '').length) {
          existing.faDate = dt;
        }

        if (wasUpdated) updatedCount++;
      } else {
        // Record is brand-new: append to dataset
        rec.id = this.rawRecords.length + 1;
        this.rawRecords.push(rec);
        existingMap.set(exactKey, rec);
        if (normDt) {
          normalizedMap.set(normKey, rec);
        }
        addedCount++;
      }
    });

    // Re-sort descending by F.A. Date
    this.rawRecords.sort((a, b) => this.parseDate(b.faDate) - this.parseDate(a.faDate));

    // Re-apply annotations
    this.applyAnnotationsToRecords();

    // Dataset merged successfully

    try {
      if (this.syncChannel) {
        this.syncChannel.postMessage('dataset_updated');
      }
    } catch (e) {}

    // Publish merged dataset to central server
    const published = await this.publishDatasetToServer();

    // Rebuild hierarchy tree & notify UI
    this.buildTree();
    this.notify();

    return {
      addedCount,
      updatedCount,
      totalCount: this.rawRecords.length,
      published: published
    };
  }

  async publishDatasetToServer() {
    const baseUrl = await this.getActiveServerUrl();
    if (!baseUrl) return false;
    try {
      if (window.mainPanel) {
        window.mainPanel.showToast('📡 Publishing updated dataset to network share...');
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const res = await fetch(`${baseUrl}/api/dataset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.rawRecords),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        this.lastSyncTime = new Date();
        this.syncStatus = 'connected';
        if (this.rawRecords.length > 0) {
          this.lastDatasetFingerprint = this.rawRecords.length + '_' + (this.rawRecords[0].serialNo || this.rawRecords[0].id) + '_' + (this.rawRecords[this.rawRecords.length - 1].serialNo || this.rawRecords[this.rawRecords.length - 1].id);
        }
        this.updateSyncBadgeOnly();
        if (window.mainPanel) {
          window.mainPanel.showToast('✅ Dataset successfully published to network share!');
        }
        return true;
      } else {
        const errText = await res.text().catch(() => '');
        console.error('Server dataset publish failed:', res.status, errText);
        if (window.mainPanel) {
          window.mainPanel.showToast(`⚠️ Server upload rejected (${res.status}): ${errText || 'Please restart the desktop app on this machine to apply the latest server update.'}`, 8000);
        }
      }
    } catch (e) {
      console.warn('Could not publish merged dataset to server:', e);
      if (window.mainPanel) {
        window.mainPanel.showToast(`⚠️ Upload failed: ${e.message || e}`, 6000);
      }
    }
    return false;
  }

  async publishAllUpdates() {
    const baseUrl = await this.getActiveServerUrl();
    if (baseUrl) {
      if (window.mainPanel) {
        window.mainPanel.showToast('🔄 Synchronizing with central network share...');
      }

      // 1. Pull latest incoming annotations from central server first
      await this.loadServerAnnotations();

      // 2. Publish dataset if new records were imported
      await this.publishDatasetToServer();

      // 3. Push all solution annotations to central server
      let sentCount = 0;
      for (const key of Object.keys(this.annotationsMap)) {
        const item = this.annotationsMap[key];
        try {
          await fetch(`${baseUrl}/api/annotations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, ...item })
          });
          sentCount++;
        } catch (e) {}
      }

      // 4. Final verification pull and UI refresh
      await this.loadServerAnnotations();
      if (window.mainPanel) {
        window.mainPanel.renderStats(this.getActiveRecords());
        window.mainPanel.showToast(`✅ Full 2-way sync complete (${sentCount} solution memos synced)!`);
      }
      return;
    }

    // Offline / direct file mode
    await this.exportDatasetFile();
  }

  async exportDatasetFile() {
    const jsonStr = JSON.stringify(this.rawRecords, null, 2);

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'defect_details.json',
          types: [{
            description: 'JSON Defect Dataset File',
            accept: { 'application/json': ['.json'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonStr);
        await writable.close();

        if (window.mainPanel) {
          window.mainPanel.showToast('✅ Defect dataset published to shared drive!');
        }
        alert('✅ defect_details.json updated on shared drive!\n\nAll connected team members will receive the updated dataset automatically.');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'defect_details.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('📥 Downloaded defect_details.json!\n\nPlease place/overwrite this file in the data/ folder on your shared drive so all network machines see the new dataset.');
  }

  setSelectedNode(node) {
    this.selectedNode = node;
    this.notify();
  }

  setSearchQuery(query) {
    this.searchQuery = (query || '').toLowerCase().trim();
    this.selectedNode = null;

    const inputEl = document.getElementById('tree-search-input');
    if (inputEl && inputEl.value !== (query || '')) {
      inputEl.value = query || '';
    }

    this.buildTree();
    this.notify();
  }

  setSearchTarget(target) {
    this.searchTarget = target || 'all';
    this.selectedNode = null;
    this.buildTree();
    this.notify();
  }

  clearAllFilters() {
    this.searchQuery = '';
    this.searchTarget = 'all';
    this.fixFilter = 'all';
    this.selectedNode = null;
    this.datePreset = 'all';
    
    const { minDateStr, maxDateStr } = this.getMinMaxDates();
    this.startDate = minDateStr;
    this.endDate = maxDateStr;

    const treeSearch = document.getElementById('tree-search-input');
    if (treeSearch) treeSearch.value = '';

    const targetSelect = document.getElementById('tree-search-target');
    if (targetSelect) targetSelect.value = 'all';

    const fixFilterSelect = document.getElementById('fix-filter-select');
    if (fixFilterSelect) fixFilterSelect.value = 'all';

    const tableSearch = document.getElementById('table-search');
    if (tableSearch) tableSearch.value = '';

    if (window.mainPanel) {
      window.mainPanel.tableFilter = '';
    }

    this.updateDateInputsUI();
    this.selectedNode = null;
    this.buildTree();
    this.notify();
  }

  matchesSearchTokens(rec, target, tokens) {
    if (!tokens || tokens.length === 0) return true;
    if (target === 'all') {
      const str = rec._searchStr || '';
      for (let i = 0; i < tokens.length; i++) {
        if (!str.includes(tokens[i])) return false;
      }
      return true;
    } else if (target === 'refDes') {
      const str = (rec.refDes || '').toLowerCase();
      for (let i = 0; i < tokens.length; i++) {
        if (!str.includes(tokens[i])) return false;
      }
      return true;
    } else if (target === 'serialNo') {
      const str = (rec.serialNo || '').toLowerCase();
      for (let i = 0; i < tokens.length; i++) {
        if (!str.includes(tokens[i])) return false;
      }
      return true;
    } else if (target === 'failureComments') {
      const str = `${rec.failureComment || ''} ${rec.failureDescription || ''}`.toLowerCase();
      for (let i = 0; i < tokens.length; i++) {
        if (!str.includes(tokens[i])) return false;
      }
      return true;
    } else if (target === 'comments') {
      const str = `${rec.defectComment || ''} ${rec.failureComment || ''} ${rec.repairComment || ''} ${rec.fixComment || ''} ${rec.failureDescription || ''} ${rec.repairDescription || ''}`.toLowerCase();
      for (let i = 0; i < tokens.length; i++) {
        if (!str.includes(tokens[i])) return false;
      }
      return true;
    } else if (target === 'parts') {
      const str = `${rec.parentPartNo || ''} ${rec.customer || ''} ${rec.processRecorded || ''}`.toLowerCase();
      for (let i = 0; i < tokens.length; i++) {
        if (!str.includes(tokens[i])) return false;
      }
      return true;
    }
    const str = rec._searchStr || '';
    for (let i = 0; i < tokens.length; i++) {
      if (!str.includes(tokens[i])) return false;
    }
    return true;
  }

  buildTree() {
    let filtered = this.rawRecords;

    filtered = filtered.filter(r => this.isDateInFilter(r.faDate));

    if (this.fixFilter !== 'all') {
      filtered = filtered.filter(r => r.confirmedFix === this.fixFilter);
    }
    
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase().trim();
      const target = this.searchTarget;
      const tokens = q.split(/\s+/).filter(Boolean);

      if (tokens.length > 0) {
        filtered = filtered.filter(r => this.matchesSearchTokens(r, target, tokens));
      }
    }

    const custMap = new Map();

    filtered.forEach(rec => {
      const cust = rec.customer;
      const part = rec.parentPartNo;
      const proc = rec.processRecorded || 'UNSPECIFIED PROCESS';
      const desc = rec.defectDescription;
      const ref = rec.refDes;
      const qty = rec.defectQuantity;

      if (!custMap.has(cust)) {
        custMap.set(cust, { name: cust, recordCount: 0, totalQty: 0, partsMap: new Map() });
      }
      const custNode = custMap.get(cust);
      custNode.recordCount += 1;
      custNode.totalQty += qty;

      if (!custNode.partsMap.has(part)) {
        custNode.partsMap.set(part, { name: part, recordCount: 0, totalQty: 0, procMap: new Map() });
      }
      const partNode = custNode.partsMap.get(part);
      partNode.recordCount += 1;
      partNode.totalQty += qty;

      if (!partNode.procMap.has(proc)) {
        partNode.procMap.set(proc, { name: proc, recordCount: 0, totalQty: 0, descMap: new Map() });
      }
      const procNode = partNode.procMap.get(proc);
      procNode.recordCount += 1;
      procNode.totalQty += qty;

      if (!procNode.descMap.has(desc)) {
        procNode.descMap.set(desc, { name: desc, recordCount: 0, totalQty: 0, refMap: new Map() });
      }
      const descNode = procNode.descMap.get(desc);
      descNode.recordCount += 1;
      descNode.totalQty += qty;

      if (!descNode.refMap.has(ref)) {
        descNode.refMap.set(ref, { name: ref, recordCount: 0, totalQty: 0, records: [] });
      }
      const refNode = descNode.refMap.get(ref);
      refNode.recordCount += 1;
      refNode.totalQty += qty;
      refNode.records.push(rec);
    });

    const alphaSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const countSort = (a, b) => (b.recordCount - a.recordCount) || (b.totalQty - a.totalQty) || alphaSort(a, b);

    const tree = Array.from(custMap.values()).map(cust => {
      const parts = Array.from(cust.partsMap.values()).map(part => {
        
        const procs = Array.from(part.procMap.values()).map(proc => {
          
          const descs = Array.from(proc.descMap.values()).map(desc => {
            
            const refs = Array.from(desc.refMap.values()).map(ref => {
              ref.records.sort((a, b) => (b._timestamp || 0) - (a._timestamp || 0));
              return ref;
            }).sort(countSort); // Level 5: Ref Des Record Count Descending
            
            return {
              name: desc.name,
              recordCount: desc.recordCount,
              totalQty: desc.totalQty,
              children: refs
            };
          }).sort(countSort); // Level 4: Defect Description Record Count Descending

          return {
            name: proc.name,
            recordCount: proc.recordCount,
            totalQty: proc.totalQty,
            children: descs
          };
        }).sort(countSort); // Level 3: Process Recorded Record Count Descending

          return {
            name: part.name,
            recordCount: part.recordCount,
            totalQty: part.totalQty,
            children: procs
          };
      }).sort(alphaSort); // Level 2: Parent Part No Alphanumeric

      return {
        name: cust.name,
        recordCount: cust.recordCount,
        totalQty: cust.totalQty,
        children: parts
      };
    }).sort(countSort); // Level 1: Customer Total Records Descending

    this.treeData = tree;
    this.updateDateInputsUI();
    this.updateSyncBadgeOnly();
  }

  getBaseFilteredRecords() {
    let matched = this.rawRecords || [];
    matched = matched.filter(r => this.isDateInFilter(r.faDate));

    if (this.selectedNode) {
      const { level, customer, parentPartNo, processRecorded, defectDescription, refDes } = this.selectedNode;
      matched = matched.filter(rec => {
        if (level >= 1 && rec.customer !== customer) return false;
        if (level >= 2 && rec.parentPartNo !== parentPartNo) return false;
        if (level >= 3 && rec.processRecorded !== processRecorded) return false;
        if (level >= 4 && rec.defectDescription !== defectDescription) return false;
        if (level >= 5 && rec.refDes !== refDes) return false;
        return true;
      });
    }

    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase().trim();
      const target = this.searchTarget;
      const tokens = q.split(/\s+/).filter(Boolean);

      if (tokens.length > 0) {
        matched = matched.filter(r => this.matchesSearchTokens(r, target, tokens));
      }
    }

    return matched;
  }

  getActiveRecords() {
    let matched = this.getBaseFilteredRecords();

    if (this.fixFilter !== 'all') {
      matched = matched.filter(r => r.confirmedFix === this.fixFilter);
    }

    return matched.sort((a, b) => (b._timestamp || 0) - (a._timestamp || 0));
  }
}

window.dataStore = new DataStore();

// Immediately load data so it's available before DOMContentLoaded fires.
// On file:// protocol, dataset scripts are NOT in <head> (to avoid 50s black screen).
// We load from localStorage for instant first-paint. The fresh dataset will be loaded
// by app.js DOMContentLoaded via dynamic script injection moments later.
(function() {
  console.log('[DataStore] Self-initializing...');
  
  // 1. If dataset globals already exist (http:// mode or scripts loaded), use them
  var initialSource = window.SHARED_DEFECT_DATA || window.INITIAL_DEFECT_DATA;
  if (initialSource && Array.isArray(initialSource) && initialSource.length > 0) {
    console.log('[DataStore] Loaded ' + initialSource.length + ' records from global dataset');
    window.dataStore.setRecords(initialSource, 'DefectDetails.xls', true);
    return;
  }
})();

