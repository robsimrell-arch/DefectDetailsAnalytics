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

  // 1. Ensure dataset is loading through dataStore (handles IndexedDB cache + fast gzip fetch)
  if (window.dataStore && typeof window.dataStore.loadInitialDatasetAsync === 'function') {
    window.dataStore.loadInitialDatasetAsync();
  }

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
  var treeSearchDebounceTimer = null;

  if (treeSearchInput) {
    treeSearchInput.addEventListener('input', function(e) {
      var val = e.target.value;
      clearTimeout(treeSearchDebounceTimer);
      treeSearchDebounceTimer = setTimeout(function() {
        window.dataStore.setSearchQuery(val);
      }, 150);
    });

    treeSearchInput.addEventListener('paste', function(e) {
      clearTimeout(treeSearchDebounceTimer);
      setTimeout(function() {
        window.dataStore.setSearchQuery(treeSearchInput.value);
      }, 10);
    });

    treeSearchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        clearTimeout(treeSearchDebounceTimer);
        treeSearchInput.value = '';
        window.dataStore.setSearchQuery('');
        treeSearchInput.focus();
      } else if (e.key === 'Enter') {
        clearTimeout(treeSearchDebounceTimer);
        window.dataStore.setSearchQuery(e.target.value);
      }
    });
  }

  if (treeSearchClear) {
    treeSearchClear.addEventListener('click', function() {
      if (treeSearchInput) {
        clearTimeout(treeSearchDebounceTimer);
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

  // Setup Theme Toggle with localStorage persistence
  try {
    var savedTheme = localStorage.getItem('DEFECT_APP_THEME');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  } catch (eTheme) {}

  var themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', function() {
      var currentTheme = document.documentElement.getAttribute('data-theme');
      var newTheme = currentTheme === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', newTheme);
      try {
        localStorage.setItem('DEFECT_APP_THEME', newTheme);
      } catch (eThemeSave) {}
      if (window.mainPanel && window.mainPanel.activeTab === 'chart') {
        window.mainPanel.renderChart();
      }
      if (window.dataStore) {
        window.dataStore.updateSyncBadgeOnly();
      }
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

async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Clear input value so selecting the same file again triggers change event
  e.target.value = '';

  if (window.mainPanel && typeof window.mainPanel.showToast === 'function') {
    window.mainPanel.showToast(`⏳ Reading and merging ${file.name}...`);
  }

  const reader = new FileReader();

  if (file.name.toLowerCase().endsWith('.json')) {
    reader.onload = async (event) => {
      try {
        const records = JSON.parse(event.target.result);
        if (!Array.isArray(records) || records.length === 0) {
          alert('No valid records found in JSON file.');
          return;
        }

        const result = await window.dataStore.mergeRecords(records, file.name);
        
        let syncMsg = result.published 
          ? '⚡ Published to central server! All connected machines will update within 2 seconds.'
          : 'ℹ️ Saved to local browser state. To sync across all network PCs, click the "Publish Updates" button in the top navigation bar.';

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
        if (!rawRows || rawRows.length === 0) {
          alert('The uploaded spreadsheet is empty.');
          return;
        }
        
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
          const rowStr = (rawRows[i] || []).join(' ').toLowerCase();
          if (rowStr.includes('parent part no') || rowStr.includes('parentpartno') || rowStr.includes('serial no') || rowStr.includes('part number')) {
            headerRowIndex = i;
            break;
          }
        }

        const headers = (rawRows[headerRowIndex] || []).map(h => String(h || '').trim());
        const records = [];

        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.length === 0) continue;

          const rec = {};
          headers.forEach((h, colIdx) => {
            if (h) rec[h] = row[colIdx];
          });

          // Check if row has any meaningful content
          const hasContent = Object.values(rec).some(v => v !== undefined && v !== null && String(v).trim() !== '');
          if (hasContent) {
            records.push(rec);
          }
        }

        if (records.length > 0) {
          const result = await window.dataStore.mergeRecords(records, file.name);
          
          let syncMsg = result.published 
            ? '⚡ Published to central server! All connected machines will update within 2 seconds.'
            : 'ℹ️ Saved to local browser state. To sync across all network PCs, click the "Publish Updates" button in the top navigation bar.';

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

window.handleFileUpload = handleFileUpload;
