/**
 * DataStore - Core Data Facade.
 * Coordinates between IndexedDbManager, SyncEngine, HierarchyBuilder, and ExportService.
 * Maintains full backwards compatibility with all existing window.dataStore consumers.
 */
class DataStore {
  constructor() {
    this.rawRecords = [];
    this.treeData = [];
    this.selectedKeys = new Set();
    this.maximalSelectedNodes = [];
    this.treeNodeMap = new Map();
    this.lastSelectedKey = null;
    this.searchQuery = '';
    this.searchTarget = 'all'; // 'all' | 'refDes' | 'serialNo' | 'defectDescription' | 'process' | 'failureComments' | 'comments' | 'parts'
    this.fixFilter = 'all'; // 'all' | 'Yes' | 'No' | 'Pending'
    this.datePreset = 'all'; // 'all' | '7d' | '30d' | '90d' | 'custom'
    this.startDate = '';
    this.endDate = '';
    this.currentFilename = 'DefectDetails.xls';

    let savedTreeMetric = 'records';
    try {
      savedTreeMetric = localStorage.getItem('DEFECT_APP_TREE_METRIC') || 'records';
    } catch (e) {}
    this.treeMetric = savedTreeMetric === 'uniqueSN' ? 'uniqueSN' : 'records';

    this.annotationsMap = {};
    this.listeners = [];
    this.pendingNotify = false;
    this._datasetLoadPromise = null;
    this.lastDatasetFingerprint = '';

    // Delegate modules
    this.idbManager = window.DefectApp && window.DefectApp.IndexedDbManager 
      ? new window.DefectApp.IndexedDbManager() 
      : new IndexedDbManager();

    this.syncEngine = window.DefectApp && window.DefectApp.SyncEngine
      ? new window.DefectApp.SyncEngine(this)
      : new SyncEngine(this);

    // Initialize annotations
    this.initInitialAnnotations();
    this.updateSyncBadgeOnly();
    this.loadInitialDatasetAsync();
  }

  // Sync status getters & setters delegating to SyncEngine
  get syncStatus() { return this.syncEngine ? this.syncEngine.syncStatus : 'connecting'; }
  set syncStatus(val) { if (this.syncEngine) this.syncEngine.syncStatus = val; }
  get lastSyncTime() { return this.syncEngine ? this.syncEngine.lastSyncTime : null; }
  set lastSyncTime(val) { if (this.syncEngine) this.syncEngine.lastSyncTime = val; }
  get activeServerUrl() { return this.syncEngine ? this.syncEngine.activeServerUrl : null; }
  set activeServerUrl(val) { if (this.syncEngine) this.syncEngine.activeServerUrl = val; }
  get offlineOutbox() { return this.syncEngine ? this.syncEngine.offlineOutbox : []; }
  set offlineOutbox(val) { if (this.syncEngine) this.syncEngine.offlineOutbox = val; }
  get sharedFileHandle() { return this.syncEngine ? this.syncEngine.sharedFileHandle : null; }
  set sharedFileHandle(val) { if (this.syncEngine) this.syncEngine.sharedFileHandle = val; }
  get syncChannel() { return this.syncEngine ? this.syncEngine.syncChannel : null; }

  // IndexedDB cache delegation
  async _openIndexedDB() { return this.idbManager.openDB(); }
  async _getIDBCache() { return this.idbManager.getCache('latest_records'); }
  async _setIDBCache(records, updatedAt) { return this.idbManager.setCache(records, updatedAt, 'latest_records'); }

  async loadInitialDatasetAsync() {
    if (this._datasetLoadPromise) return this._datasetLoadPromise;

    this._datasetLoadPromise = (async () => {
      const statusEl = document.getElementById('loader-status-text');
      const progressContainer = document.getElementById('loader-progress-bar');
      const progressFill = document.getElementById('loader-progress-fill');

      const updateProgress = (text, percent) => {
        if (statusEl) statusEl.textContent = text;
        if (progressContainer && percent !== null) {
          progressContainer.style.display = 'block';
          if (progressFill) progressFill.style.width = Math.min(100, Math.max(0, percent)) + '%';
        }
      };

      // 1. Instant Cache Load from IndexedDB (<0.15s)
      let cachedEntry = null;
      try {
        cachedEntry = await this.idbManager.getCache('latest_records');
        if (cachedEntry && Array.isArray(cachedEntry.records) && cachedEntry.records.length > 0) {
          updateProgress('Instant start from local cache...', 100);
          this.setRecords(cachedEntry.records, 'DefectDetails.xls', false);
          if (cachedEntry.updatedAt) {
            this.lastDatasetFingerprint = cachedEntry.updatedAt;
          }
          this.lastSyncTime = new Date();
          this.syncStatus = 'connected';
          this.updateSyncBadgeOnly();
          const loader = document.getElementById('app-startup-loader');
          if (loader) loader.classList.add('hidden');
        }
      } catch (eCache) {}

      // Trigger parallel immediate fetch of live annotations at launch (<0.1s)
      if (window.location.protocol !== 'file:') {
        this.loadServerAnnotations();
      }

      // 2. Fetch from server if in HTTP mode
      if (window.location.protocol !== 'file:') {
        try {
          let needsFullFetch = true;
          let serverMtime = "";
          try {
            const statRes = await fetch('/api/status?t=' + Date.now(), { cache: 'no-store' });
            if (statRes.ok) {
              const statData = await statRes.json();
              serverMtime = statData.dataset_updated_at || "";
              this.lastSyncTime = new Date();
              this.syncStatus = 'connected';
              this.updateSyncBadgeOnly();
              if (cachedEntry && cachedEntry.updatedAt && serverMtime === cachedEntry.updatedAt && this.rawRecords.length > 0) {
                needsFullFetch = false;
                this.lastDatasetFingerprint = serverMtime;
              }
            }
          } catch (eStat) {}

          if (needsFullFetch) {
            updateProgress('Connecting to data engine...', 20);
            const res = await fetch('/api/dataset');
            if (res.ok) {
              updateProgress('Downloading & parsing defect records...', 60);
              const data = await res.json();

              if (Array.isArray(data) && data.length > 0) {
                updateProgress(`Indexing ${data.length.toLocaleString()} defect records...`, 98);
                const lastModified = serverMtime || res.headers.get('Last-Modified') || String(Date.now());
                this.lastDatasetFingerprint = lastModified;
                this.idbManager.setCache(data, lastModified, 'latest_records');
                this.lastSyncTime = new Date();
                this.syncStatus = 'connected';
                this.updateSyncBadgeOnly();
                setTimeout(() => {
                  this.setRecords(data, 'DefectDetails.xls', true);
                  this.lastSyncTime = new Date();
                  this.syncStatus = 'connected';
                  this.updateSyncBadgeOnly();
                  const loader = document.getElementById('app-startup-loader');
                  if (loader) loader.classList.add('hidden');
                }, 10);
                return;
              }
            }
          }
        } catch (e) {
          console.warn('[DataStore] loadInitialDatasetAsync failed:', e);
        }
      }

      // Fallback check
      if (this.rawRecords.length === 0 && window.SHARED_DEFECT_DATA && window.SHARED_DEFECT_DATA.length > 0) {
        this.setRecords(window.SHARED_DEFECT_DATA, 'DefectDetails.xls', true);
      }
    })();

    return this._datasetLoadPromise;
  }

  initInitialAnnotations() {
    this.annotationsMap = {};
    if (window.SHARED_FIX_ANNOTATIONS && typeof window.SHARED_FIX_ANNOTATIONS === 'object') {
      this.annotationsMap = JSON.parse(JSON.stringify(window.SHARED_FIX_ANNOTATIONS));
    }
    try {
      const localCached = localStorage.getItem('DEFECT_APP_FIX_ANNOTATIONS');
      if (localCached) {
        const parsed = JSON.parse(localCached);
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (v && typeof v === 'object' && !this.annotationsMap[k]) {
              this.annotationsMap[k] = v;
            }
          }
        }
      }
    } catch (e) {}
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
      let yes = 0, no = 0, falseFail = 0, possibleFalseFail = 0;
      for (let i = 0; i < this.rawRecords.length; i++) {
        const fix = this.rawRecords[i].confirmedFix;
        if (fix === 'Yes') yes++;
        else if (fix === 'No') no++;
        else if (fix === 'False Fail') falseFail++;
        else if (fix === 'Possible False Fail') possibleFalseFail++;
      }
      return { yes, no, falseFail, possibleFalseFail };
    }

    const uniqueYes = new Set();
    const uniqueNo = new Set();
    const uniqueFalseFail = new Set();
    const uniquePossibleFalseFail = new Set();
    const map = this.annotationsMap || {};
    Object.values(map).forEach(ann => {
      if (!ann || typeof ann !== 'object') return;
      const fix = ann.confirmedFix;
      if (fix !== 'Yes' && fix !== 'No' && fix !== 'False Fail' && fix !== 'Possible False Fail') return;
      const key = ann.key || (ann.serialNo && ann.faDate ? `${ann.serialNo}_${ann.faDate}` : '');
      if (!key) return;
      if (fix === 'Yes') {
        uniqueYes.add(key);
        uniqueNo.delete(key);
        uniqueFalseFail.delete(key);
        uniquePossibleFalseFail.delete(key);
      } else if (fix === 'No') {
        uniqueNo.add(key);
        uniqueYes.delete(key);
        uniqueFalseFail.delete(key);
        uniquePossibleFalseFail.delete(key);
      } else if (fix === 'False Fail') {
        uniqueFalseFail.add(key);
        uniqueYes.delete(key);
        uniqueNo.delete(key);
        uniquePossibleFalseFail.delete(key);
      } else if (fix === 'Possible False Fail') {
        uniquePossibleFalseFail.add(key);
        uniqueYes.delete(key);
        uniqueNo.delete(key);
        uniqueFalseFail.delete(key);
      }
    });

    return {
      yes: uniqueYes.size,
      no: uniqueNo.size,
      falseFail: uniqueFalseFail.size,
      possibleFalseFail: uniquePossibleFalseFail.size
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
    if (this.syncEngine) this.syncEngine.isSyncing = false;
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

  // Hierarchy helper delegators
  parseDate(dateStr) { return HierarchyBuilder.parseDate(dateStr); }
  normalizeDateKey(dateStr) { return HierarchyBuilder.normalizeDateKey(dateStr); }
  deriveCustomer(r, parentPart, serialNo) { return HierarchyBuilder.deriveCustomer(r, parentPart, serialNo); }
  normalizeRecord(r, idx) { return HierarchyBuilder.normalizeRecord(r, idx); }
  buildSearchStr(rec) { return HierarchyBuilder.buildSearchStr(rec); }
  isValidSerialNo(sn) { return HierarchyBuilder.isValidSerialNo(sn); }
  parseSearchTokens(query) { return HierarchyBuilder.parseSearchTokens(query); }
  matchesSearchTokens(rec, target, tokens) { return HierarchyBuilder.matchesSearchTokens(rec, target, tokens); }

  // SyncEngine delegation
  startAutoSync(intervalMs = 5000) { this.syncEngine.startAutoSync(intervalMs); }
  reloadSharedFixAnnotationsScript() { this.syncEngine.reloadSharedFixAnnotationsScript(); }
  async getActiveServerUrl() { return this.syncEngine.getActiveServerUrl(); }
  setServerUrl(url) { this.syncEngine.setServerUrl(url); }
  async loadServerAnnotations() { return this.syncEngine.loadServerAnnotations(); }
  triggerStartServer() { this.syncEngine.triggerStartServer(); }
  async restartServer() { return this.syncEngine.restartServer(); }
  updateSyncBadgeOnly() { this.syncEngine.updateSyncBadgeOnly(); }
  enqueueOfflinePayload(payload) { this.syncEngine.enqueueOfflinePayload(payload); }
  async flushOfflineOutbox(baseUrl) { return this.syncEngine.flushOfflineOutbox(baseUrl); }

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
      const newConfirmedAt = bestAnn ? (bestAnn.updatedAt || bestAnn.confirmedAt || null) : null;
      const newConfirmedTimestamp = newConfirmedAt ? this.parseDate(newConfirmedAt) : 0;

      if (rec.confirmedFix !== newFix || rec.fixComment !== newComment || rec.confirmedAt !== newConfirmedAt) {
        rec.confirmedFix = newFix;
        rec.fixComment = newComment;
        rec.confirmedAt = newConfirmedAt;
        rec._confirmedTimestamp = newConfirmedTimestamp;
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
      this.enqueueOfflinePayload(payload);
    }

    this.buildTree();
    this.notify(true);
  }

  setFixFilter(filter) {
    this.fixFilter = filter || 'all';
    this.buildTree();
    this.notify();
  }

  setTreeMetric(metric) {
    this.treeMetric = metric === 'uniqueSN' ? 'uniqueSN' : 'records';
    try {
      localStorage.setItem('DEFECT_APP_TREE_METRIC', this.treeMetric);
    } catch (e) {}
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
    this.rawRecords.sort((a, b) => this.parseDate(b.faDate) - this.parseDate(a.faDate));

    const { minDateStr, maxDateStr, maxTime } = this.getMinMaxDates();

    if (this.datePreset && this.datePreset !== 'all' && this.datePreset !== 'custom' && maxTime && maxTime > 0) {
      const maxD = new Date(maxTime);
      const pad = num => String(num).padStart(2, '0');
      this.endDate = `${maxD.getFullYear()}-${pad(maxD.getMonth() + 1)}-${pad(maxD.getDate())}`;

      let days = 30;
      if (this.datePreset === '7d') days = 7;
      if (this.datePreset === '90d') days = 90;

      const startD = new Date(maxTime - (days * 24 * 60 * 60 * 1000));
      this.startDate = `${startD.getFullYear()}-${pad(startD.getMonth() + 1)}-${pad(startD.getDate())}`;
    } else if (this.datePreset === 'all' || !this.startDate || !this.endDate) {
      this.startDate = minDateStr;
      this.endDate = maxDateStr;
    }

    this.buildTree();

    if (this.selectedKeys && this.selectedKeys.size > 0 && this.treeNodeMap) {
      for (const k of Array.from(this.selectedKeys)) {
        if (!this.treeNodeMap.has(k)) {
          this.selectedKeys.delete(k);
        }
      }
      this.recomputeMaximalSelectedNodes();
    }

    this.notify();

    const loader = document.getElementById('app-startup-loader');
    if (loader) {
      setTimeout(() => loader.classList.add('hidden'), 100);
    }
  }

  async mergeRecords(newRecords, filename) {
    this.currentFilename = filename;
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

      let existing = existingMap.get(exactKey);
      if (!existing && normDt) {
        existing = normalizedMap.get(normKey);
      }

      if (existing) {
        let changed = false;
        if (rec.processRecorded && rec.processRecorded !== 'UNSPECIFIED PROCESS' && (!existing.processRecorded || existing.processRecorded === 'UNSPECIFIED PROCESS')) {
          existing.processRecorded = rec.processRecorded;
          changed = true;
        }
        if (rec.defectCode && !existing.defectCode) {
          existing.defectCode = rec.defectCode;
          changed = true;
        }
        if (rec.failureCode && !existing.failureCode) {
          existing.failureCode = rec.failureCode;
          changed = true;
        }
        if (rec.debugTech && !existing.debugTech) {
          existing.debugTech = rec.debugTech;
          changed = true;
        }
        if (rec.repairTech && !existing.repairTech) {
          existing.repairTech = rec.repairTech;
          changed = true;
        }
        if (changed) {
          existing._searchStr = this.buildSearchStr(existing);
          updatedCount++;
        }
      } else {
        this.rawRecords.push(rec);
        existingMap.set(exactKey, rec);
        if (normDt) normalizedMap.set(normKey, rec);
        addedCount++;
      }
    });

    this.rawRecords.sort((a, b) => this.parseDate(b.faDate) - this.parseDate(a.faDate));
    this.applyAnnotationsToRecords();

    const { minDateStr, maxDateStr } = this.getMinMaxDates();
    if (this.datePreset === 'all' || !this.startDate || !this.endDate) {
      this.startDate = minDateStr;
      this.endDate = maxDateStr;
    }

    const published = await this.publishDatasetToServer();
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
      const timeoutId = setTimeout(() => controller.abort(), 300000);

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
        this.idbManager.setCache(this.rawRecords, String(Date.now()), 'latest_records');
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

      await this.loadServerAnnotations();
      await this.publishDatasetToServer();

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

      await this.loadServerAnnotations();
      if (window.mainPanel) {
        window.mainPanel.renderStats(this.getActiveRecords());
        window.mainPanel.showToast(`✅ Full 2-way sync complete (${sentCount} solution memos synced)!`);
      }
      return;
    }

    await this.exportDatasetFile();
  }

  async exportDatasetFile() {
    return ExportService.exportDatasetFile(this.rawRecords, 'defect_details.json');
  }

  setSelectedNode(node) {
    this.selectedNode = node;
    this.notify();
  }

  toggleNodeChecked(key, shouldCheck, shouldNotify = true) {
    if (!this.treeNodeMap) return;
    const node = this.treeNodeMap.get(key);
    if (!node) return;

    if (shouldCheck) {
      this.selectedKeys.add(key);
      if (node.allDescendantKeys) {
        for (let i = 0; i < node.allDescendantKeys.length; i++) {
          this.selectedKeys.add(node.allDescendantKeys[i]);
        }
      }
    } else {
      this.selectedKeys.delete(key);
      if (node.allDescendantKeys) {
        for (let i = 0; i < node.allDescendantKeys.length; i++) {
          this.selectedKeys.delete(node.allDescendantKeys[i]);
        }
      }
    }

    let currKey = node.parentKey;
    while (currKey) {
      const pNode = this.treeNodeMap.get(currKey);
      if (!pNode) break;
      const allChecked = pNode.childKeys && pNode.childKeys.length > 0 && pNode.childKeys.every(ck => this.selectedKeys.has(ck));
      if (allChecked) {
        this.selectedKeys.add(currKey);
      } else {
        this.selectedKeys.delete(currKey);
      }
      currKey = pNode.parentKey;
    }

    this.lastSelectedKey = key;
    this.recomputeMaximalSelectedNodes();

    if (shouldNotify) {
      this.notify();
    }
  }

  selectNodeKeysRange(keysList, shouldCheck, shouldNotify = true) {
    if (!Array.isArray(keysList) || keysList.length === 0) return;
    for (const k of keysList) {
      const node = this.treeNodeMap.get(k);
      if (!node) continue;
      if (shouldCheck) {
        this.selectedKeys.add(k);
        if (node.allDescendantKeys) {
          for (let i = 0; i < node.allDescendantKeys.length; i++) {
            this.selectedKeys.add(node.allDescendantKeys[i]);
          }
        }
      } else {
        this.selectedKeys.delete(k);
        if (node.allDescendantKeys) {
          for (let i = 0; i < node.allDescendantKeys.length; i++) {
            this.selectedKeys.delete(node.allDescendantKeys[i]);
          }
        }
      }
    }

    const visitedParents = new Set();
    for (const k of keysList) {
      let p = this.treeNodeMap.get(k)?.parentKey;
      while (p && !visitedParents.has(p)) {
        visitedParents.add(p);
        const pNode = this.treeNodeMap.get(p);
        if (!pNode) break;
        const allChecked = pNode.childKeys && pNode.childKeys.length > 0 && pNode.childKeys.every(ck => this.selectedKeys.has(ck));
        if (allChecked) {
          this.selectedKeys.add(p);
        } else {
          this.selectedKeys.delete(p);
        }
        p = pNode.parentKey;
      }
    }

    this.recomputeMaximalSelectedNodes();
    if (shouldNotify) {
      this.notify();
    }
  }

  recomputeMaximalSelectedNodes() {
    const maximal = [];
    if (this.selectedKeys && this.selectedKeys.size > 0 && this.treeNodeMap) {
      for (const key of this.selectedKeys) {
        const node = this.treeNodeMap.get(key);
        if (!node) continue;
        if (!node.parentKey || !this.selectedKeys.has(node.parentKey)) {
          maximal.push(node);
        }
      }
      maximal.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      });
    }
    this.maximalSelectedNodes = maximal;
  }

  clearTreeSelection(shouldNotify = true) {
    this.selectedKeys.clear();
    this.maximalSelectedNodes = [];
    this.lastSelectedKey = null;
    if (shouldNotify) {
      this.notify();
    }
  }

  isNodeIndeterminate(key) {
    if (this.selectedKeys.has(key)) return false;
    const node = this.treeNodeMap.get(key);
    if (!node || !node.allDescendantKeys || node.allDescendantKeys.length === 0) return false;
    return node.allDescendantKeys.some(dk => this.selectedKeys.has(dk));
  }

  buildTreeNodeMap(tree) {
    this.treeNodeMap = HierarchyBuilder.buildTreeNodeMap(tree);
  }

  setSearchQuery(query) {
    this.searchQuery = (query || '').toLowerCase().trim();

    const inputEl = document.getElementById('tree-search-input');
    if (inputEl && inputEl.value !== (query || '')) {
      inputEl.value = query || '';
    }

    this.buildTree();
    this.notify();
  }

  setSearchTarget(target) {
    this.searchTarget = target || 'all';
    this.buildTree();
    this.notify();
  }

  clearAllFilters() {
    this.searchQuery = '';
    this.searchTarget = 'all';
    this.fixFilter = 'all';
    this.clearTreeSelection(false);
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
    this.buildTree();
    this.notify();
  }

  buildTree() {
    this.treeData = HierarchyBuilder.buildTree(
      this.rawRecords,
      this.treeMetric,
      (dateStr) => this.isDateInFilter(dateStr),
      this.fixFilter,
      this.searchQuery,
      this.searchTarget
    );

    this.buildTreeNodeMap(this.treeData);

    if (this.selectedKeys && this.selectedKeys.size > 0) {
      this.recomputeMaximalSelectedNodes();
    }
    this.updateDateInputsUI();
    this.updateSyncBadgeOnly();
  }

  getBaseFilteredRecords() {
    let matched = this.rawRecords || [];
    matched = matched.filter(r => this.isDateInFilter(r.faDate));

    if (this.maximalSelectedNodes && this.maximalSelectedNodes.length > 0) {
      const custSet = new Set();
      const partSet = new Set();
      const procSet = new Set();
      const descSet = new Set();
      const refSet = new Set();

      let hasCust = false, hasPart = false, hasProc = false, hasDesc = false, hasRef = false;

      for (let i = 0; i < this.maximalSelectedNodes.length; i++) {
        const n = this.maximalSelectedNodes[i];
        if (n.level === 1) {
          custSet.add(n.customer);
          hasCust = true;
        } else if (n.level === 2) {
          partSet.add(`${n.customer}|||${n.parentPartNo}`);
          hasPart = true;
        } else if (n.level === 3) {
          procSet.add(`${n.customer}|||${n.parentPartNo}|||${n.processRecorded}`);
          hasProc = true;
        } else if (n.level === 4) {
          descSet.add(`${n.customer}|||${n.parentPartNo}|||${n.processRecorded}|||${n.defectDescription}`);
          hasDesc = true;
        } else if (n.level === 5) {
          refSet.add(`${n.customer}|||${n.parentPartNo}|||${n.processRecorded}|||${n.defectDescription}|||${n.refDes}`);
          hasRef = true;
        }
      }

      matched = matched.filter(rec => {
        if (hasCust && custSet.has(rec.customer)) return true;
        if (hasPart && partSet.has(`${rec.customer}|||${rec.parentPartNo}`)) return true;
        const proc = rec.processRecorded || 'UNSPECIFIED PROCESS';
        if (hasProc && procSet.has(`${rec.customer}|||${rec.parentPartNo}|||${proc}`)) return true;
        if (hasDesc && descSet.has(`${rec.customer}|||${rec.parentPartNo}|||${proc}|||${rec.defectDescription}`)) return true;
        if (hasRef && refSet.has(`${rec.customer}|||${rec.parentPartNo}|||${proc}|||${rec.defectDescription}|||${rec.refDes}`)) return true;
        return false;
      });
    }

    if (this.searchQuery) {
      const target = this.searchTarget;
      const tokens = this.parseSearchTokens(this.searchQuery);

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
      return matched.sort((a, b) => {
        const diff = (b._confirmedTimestamp || 0) - (a._confirmedTimestamp || 0);
        if (diff !== 0) return diff;
        return (b._timestamp || 0) - (a._timestamp || 0);
      });
    }

    return matched.sort((a, b) => (b._timestamp || 0) - (a._timestamp || 0));
  }
}

window.dataStore = new DataStore();

(function() {
  var initialSource = window.SHARED_DEFECT_DATA || window.INITIAL_DEFECT_DATA;
  if (initialSource && Array.isArray(initialSource) && initialSource.length > 0) {
    window.dataStore.setRecords(initialSource, 'DefectDetails.xls', true);
  }
})();
