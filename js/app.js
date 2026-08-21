/**
 * App Main Controller - Initializes dataset, handles persistent storage, file upload, live polling, and server connection
 */
function initApp() {
  console.log('[APP] Initializing App Controller...');

  // Safety check
  if (!window.dataStore) {
    console.error('[APP] FATAL: window.dataStore is undefined! dataStore.js failed to load.');
    return;
  }

  console.log('[APP] dataStore exists, rawRecords=' + window.dataStore.rawRecords.length);

  // 1. Load central shared dataset data/defect_details.json (works on http://, may CORS-fail on file://)
  loadDefaultDatasetAsync().then(function() {
    // On file:// protocol, fetch fails. Check if deferred <script> has populated the globals:
    var globalSource = window.SHARED_DEFECT_DATA;
    if (globalSource && Array.isArray(globalSource) && globalSource.length > 0) {
      if (window.dataStore.rawRecords.length === 0) {
        window.dataStore.setRecords(globalSource, 'DefectDetails.xls', true);
      }
    }
  });

  // 2. Start automatic background sync (polling for shared fixes and shared dataset updates)
  window.dataStore.startAutoSync(5000);

  // Setup Date Range Selection Listeners
  var datePresetSelect = document.getElementById('tree-date-preset');
  if (datePresetSelect) {
    datePresetSelect.addEventListener('change', function(e) {
      window.dataStore.applyDatePreset(e.target.value);
    });
  }

  var startDateInput = document.getElementById('tree-date-start');
  if (startDateInput) {
    startDateInput.addEventListener('change', function(e) {
      window.dataStore.setDateRange('custom', e.target.value, window.dataStore.endDate);
    });
  }

  var endDateInput = document.getElementById('tree-date-end');
  if (endDateInput) {
    endDateInput.addEventListener('change', function(e) {
      window.dataStore.setDateRange('custom', window.dataStore.startDate, e.target.value);
    });
  }

  // Setup Tree Search Input & Target Scope Listeners
  var treeSearchInput = document.getElementById('tree-search-input');
  var treeSearchClear = document.getElementById('tree-search-clear');

  if (treeSearchInput) {
    var triggerInstantSearch = function(e) {
      window.dataStore.setSearchQuery(e.target.value);
    };

    treeSearchInput.addEventListener('input', triggerInstantSearch);
    treeSearchInput.addEventListener('keyup', triggerInstantSearch);
    treeSearchInput.addEventListener('change', triggerInstantSearch);

    treeSearchInput.addEventListener('paste', function(e) {
      setTimeout(function() {
        window.dataStore.setSearchQuery(e.target.value);
      }, 10);
    });

    treeSearchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        treeSearchInput.value = '';
        window.dataStore.setSearchQuery('');
        treeSearchInput.focus();
      } else if (e.key === 'Enter') {
        window.dataStore.setSearchQuery(e.target.value);
      }
    });
  }

  if (treeSearchClear) {
    treeSearchClear.addEventListener('click', function() {
      if (treeSearchInput) {
        treeSearchInput.value = '';
        window.dataStore.setSearchQuery('');
        treeSearchInput.focus();
      }
    });
  }

  var searchTargetSelect = document.getElementById('tree-search-target');
  if (searchTargetSelect) {
    searchTargetSelect.addEventListener('change', function(e) {
      window.dataStore.setSearchTarget(e.target.value);
    });
  }

  // Setup Theme Toggle
  var themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', function() {
      var currentTheme = document.documentElement.getAttribute('data-theme');
      var newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
    });
  }

  // Setup File Upload Handler (XLS / XLSX / CSV / JSON)
  var fileInput = document.getElementById('file-upload-input');
  if (fileInput) {
    fileInput.addEventListener('change', handleFileUpload);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

async function loadDefaultDatasetAsync() {
  var isFileProtocol = (window.location.protocol === 'file:');

  // === HTTP mode: fetch directly from /api/dataset endpoint ===
  if (!isFileProtocol) {
    try {
      var resApi = await fetch('/api/dataset?t=' + Date.now(), { cache: 'no-store' });
      if (resApi.ok) {
        var recordsApi = await resApi.json();
        if (Array.isArray(recordsApi) && recordsApi.length > 0) {
          console.log('[APP] /api/dataset loaded ' + recordsApi.length + ' records');
          window.dataStore.setRecords(recordsApi, 'DefectDetails.xls', true);
          return;
        }
      }
    } catch (errApi) {
      console.warn('[APP] /api/dataset fetch failed:', errApi.message);
    }

    try {
      var resStatic = await fetch('data/defect_details.json?t=' + Date.now(), { cache: 'no-store' });
      if (resStatic.ok) {
        var recordsStatic = await resStatic.json();
        if (Array.isArray(recordsStatic) && recordsStatic.length > 0) {
          console.log('[APP] Static JSON fetch loaded ' + recordsStatic.length + ' records');
          window.dataStore.setRecords(recordsStatic, 'DefectDetails.xls', true);
          return;
        }
      }
    } catch (errStatic) {}
  }

  // === Polling check for global dataset scripts (handles network share SMB loading delay) ===
  for (var attempt = 0; attempt < 25; attempt++) {
    var globalSource = window.SHARED_DEFECT_DATA;
    if (globalSource && Array.isArray(globalSource) && globalSource.length > 0) {
      console.log('[APP] Loaded global dataset on attempt ' + attempt + ': ' + globalSource.length + ' records');
      window.dataStore.setRecords(globalSource, 'DefectDetails.xls', true);
      return;
    }
    await new Promise(function(resolve) { setTimeout(resolve, 200); });
  }

  // === Fallback file:// mode: dynamically inject <script> to load data ===
  console.log('[APP] Loading data/defect_details.js via dynamic script injection...');
  return new Promise(function(resolve) {
    var script = document.createElement('script');
    script.src = 'data/defect_details.js';
    script.onload = function() {
      var source = window.SHARED_DEFECT_DATA || window.INITIAL_DEFECT_DATA;
      if (source && Array.isArray(source) && source.length > 0) {
        console.log('[APP] Dynamic script loaded ' + source.length + ' records');
        window.dataStore.setRecords(source, 'DefectDetails.xls', true);
      }
      resolve();
    };
    script.onerror = function() {
      console.warn('[APP] Dynamic script load failed');
      resolve();
    };
    document.body.appendChild(script);
  });
}

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  if (file.name.endsWith('.json')) {
    reader.onload = async (event) => {
      try {
        const records = JSON.parse(event.target.result);
        const result = await window.dataStore.mergeRecords(records, file.name);
        
        let syncMsg = result.published 
          ? '⚡ Published to central server! All connected machines will update within 2 seconds.'
          : 'ℹ️ Saved to local browser state. To sync across all network PCs without server.py, click "Publish Dataset to Shared Drive" in Server Sync settings.';

        alert(
          `✅ Dataset Merge & Deduplication Complete!\n\n` +
          `📥 File: ${file.name}\n` +
          `➕ New Records Added: ${result.addedCount.toLocaleString()}\n` +
          `🔄 Existing Records Updated: ${result.updatedCount.toLocaleString()}\n` +
          `📊 Total Records in Database: ${result.totalCount.toLocaleString()}\n\n` +
          syncMsg
        );
      } catch (err) {
        alert('Error parsing JSON file: ' + err.message);
      }
    };
    reader.readAsText(file);
  } else {
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(rawRows.length, 15); i++) {
          const rowStr = (rawRows[i] || []).join(' ');
          if (rowStr.includes('Parent Part No')) {
            headerRowIndex = i;
            break;
          }
        }

        const headers = rawRows[headerRowIndex].map(h => String(h).trim());
        const records = [];

        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.length === 0) continue;

          const rec = {};
          headers.forEach((h, colIdx) => {
            rec[h] = row[colIdx];
          });

          if (rec['Parent Part No.']) {
            records.push(rec);
          }
        }

        if (records.length > 0) {
          const result = await window.dataStore.mergeRecords(records, file.name);
          
          let syncMsg = result.published 
            ? '⚡ Published to central server! All connected machines will update within 2 seconds.'
            : 'ℹ️ Saved to local browser state. To sync across all network PCs without server.py, click "Publish Dataset to Shared Drive" in Server Sync settings.';

          alert(
            `✅ Dataset Merge & Deduplication Complete!\n\n` +
            `📥 File: ${file.name}\n` +
            `➕ New Records Added: ${result.addedCount.toLocaleString()}\n` +
            `🔄 Existing Records Updated: ${result.updatedCount.toLocaleString()}\n` +
            `📊 Total Records in Database: ${result.totalCount.toLocaleString()}\n\n` +
            syncMsg
          );
        } else {
          alert('Could not find valid defect records in the selected file.');
        }

      } catch (err) {
        alert('Error parsing Excel file: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }
}
