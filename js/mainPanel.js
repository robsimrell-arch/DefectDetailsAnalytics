/**
 * MainPanel Component - Renders breadcrumbs, KPI stats, Defect Comments feed, and records data table with Solution Confirmed controls
 */
class MainPanel {
  constructor() {
    this.tableFilter = '';
    this.currentPage = 1;
    this.pageSize = 50;
    this.activeTab = 'comments'; // Default active tab: 'comments' | 'records'
    this.sortColumn = 'faDate'; // Active sorting column
    this.sortDirection = 'desc'; // Active sorting direction: 'asc' | 'desc'
    this.commentDebounceTimer = null;

    // Chart Metric Mode: 'defects' (Defect Quantity) | 'uniqueSN' (Unique Serial Numbers)
    let savedChartMetric = 'defects';
    try {
      savedChartMetric = localStorage.getItem('DEFECT_APP_CHART_METRIC') || 'defects';
    } catch (e) {}
    this.chartMetric = savedChartMetric === 'uniqueSN' ? 'uniqueSN' : 'defects';

    // Chart View Mode: 'timeline' | 'pareto'
    this.chartViewMode = 'timeline';
    // Pareto Grouping Dimension: 'defectDescription' | 'refDes' | 'processRecorded' | 'parentPartNo'
    this.paretoGrouping = 'defectDescription';

    if (window.dataStore) {
      window.dataStore.subscribe(() => this.render());
    }
    setTimeout(() => this.bindEventListeners(), 0);
    this.render();
  }

  safeParam(str) {
    return encodeURIComponent(str || '').replace(/'/g, '%27');
  }

  bindEventListeners() {
    if (this.tableSearchInput) {
      let tableSearchDebounce = null;
      this.tableSearchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        clearTimeout(tableSearchDebounce);
        tableSearchDebounce = setTimeout(() => {
          this.tableFilter = val;
          this.currentPage = 1;
          this.renderTableOnly();
        }, 150);
      });
      this.tableSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          clearTimeout(tableSearchDebounce);
          this.tableSearchInput.value = '';
          this.tableFilter = '';
          this.currentPage = 1;
          this.renderTableOnly();
          this.tableSearchInput.focus();
        }
      });
    }

    if (this.tableSearchClear) {
      this.tableSearchClear.addEventListener('click', () => {
        if (this.tableSearchInput) {
          this.tableSearchInput.value = '';
          this.tableFilter = '';
          this.currentPage = 1;
          this.renderTableOnly();
          this.tableSearchInput.focus();
        }
      });
    }

    // Delegated double-click listener for table rows
    if (this.tableBody) {
      this.tableBody.addEventListener('dblclick', (e) => {
        const interactive = e.target.closest('select, textarea, input, button, a, label');
        if (interactive) return;

        const row = e.target.closest('tr.record-row-clickable');
        if (row && row.dataset.rowIndex !== undefined) {
          const idx = parseInt(row.dataset.rowIndex, 10);
          this.openRecordCommentsModalByIndex(idx);
        }
      });
    }
  }

  get breadcrumbContainer() { return document.getElementById('breadcrumb-bar'); }
  get headerTotalContainer() { return document.getElementById('workspace-records-counter'); }
  get statsContainer() { return document.getElementById('workspace-records-counter'); }
  get commentsContainer() { return document.getElementById('comments-feed'); }
  get commentsTitle() { return document.getElementById('comments-title'); }
  get tableBody() { return document.getElementById('table-body'); }
  get tableSearchInput() { return document.getElementById('table-search'); }
  get tableSearchClear() { return document.getElementById('table-search-clear'); }

  switchTab(tabName) {
    if (tabName !== 'comments' && tabName !== 'records' && tabName !== 'chart') return;
    this.activeTab = tabName;

    const btnComments = document.getElementById('tab-btn-comments');
    const btnRecords = document.getElementById('tab-btn-records');
    const btnChart = document.getElementById('tab-btn-chart');

    const contentComments = document.getElementById('tab-content-comments');
    const contentRecords = document.getElementById('tab-content-records');
    const contentChart = document.getElementById('tab-content-chart');

    if (btnComments) btnComments.classList.toggle('active', tabName === 'comments');
    if (btnRecords) btnRecords.classList.toggle('active', tabName === 'records');
    if (btnChart) btnChart.classList.toggle('active', tabName === 'chart');

    if (contentComments) contentComments.classList.toggle('active', tabName === 'comments');
    if (contentRecords) contentRecords.classList.toggle('active', tabName === 'records');
    if (contentChart) contentChart.classList.toggle('active', tabName === 'chart');

    if (tabName === 'chart') {
      const records = window.dataStore ? window.dataStore.getActiveRecords() : [];
      this.renderChart(records);
    }
    
    if (window.lucide) window.lucide.createIcons();
    this.render();
  }

  handleSort(column) {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortColumn = column;
      this.sortDirection = (column === 'faDate' || column === 'defectQuantity' || column === 'qty') ? 'desc' : 'asc';
    }
    this.currentPage = 1;
    this.renderTableOnly();
  }

  sortData(records) {
    if (!this.sortColumn || !Array.isArray(records)) return records;

    const col = this.sortColumn;
    const dir = this.sortDirection === 'desc' ? -1 : 1;

    return records.sort((a, b) => {
      let valA = a[col];
      let valB = b[col];

      if (col === 'faDate') {
        const timeA = a._timestamp !== undefined ? a._timestamp : this.parseDate(valA);
        const timeB = b._timestamp !== undefined ? b._timestamp : this.parseDate(valB);
        return (timeA - timeB) * dir;
      }

      if (col === 'confirmedAt' || col === 'solutionConfirmedDate') {
        const timeA = a._confirmedTimestamp !== undefined ? a._confirmedTimestamp : this.parseDate(a.confirmedAt || a.updatedAt);
        const timeB = b._confirmedTimestamp !== undefined ? b._confirmedTimestamp : this.parseDate(b.confirmedAt || b.updatedAt);
        if (timeA !== timeB) {
          return (timeA - timeB) * dir;
        }
        const recTimeA = a._timestamp !== undefined ? a._timestamp : this.parseDate(a.faDate);
        const recTimeB = b._timestamp !== undefined ? b._timestamp : this.parseDate(b.faDate);
        return (recTimeA - recTimeB) * dir;
      }

      if (col === 'defectQuantity' || col === 'qty') {
        valA = parseInt(valA || 0, 10);
        valB = parseInt(valB || 0, 10);
        return (valA - valB) * dir;
      }

      if (col === 'confirmedFix') {
        valA = a.confirmedFix || 'Pending';
        valB = b.confirmedFix || 'Pending';
      }

      valA = (valA || '').toString();
      valB = (valB || '').toString();

      return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }

  updateTableHeaderSortUI() {
    const headers = document.querySelectorAll('.sortable-header');
    headers.forEach(th => {
      const colKey = th.getAttribute('data-sort-col');
      if (!colKey) return;

      const iconSpan = th.querySelector('.sort-icon');

      if (colKey === this.sortColumn) {
        th.classList.add('active-sort');
        if (iconSpan) {
          iconSpan.innerHTML = this.sortDirection === 'asc' ? '▲' : '▼';
        }
      } else {
        th.classList.remove('active-sort');
        if (iconSpan) {
          iconSpan.innerHTML = '↕';
        }
      }
    });
  }

  escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  getHighlightRegex(extraQuery) {
    const mainQ = (window.dataStore && window.dataStore.searchQuery) ? window.dataStore.searchQuery.trim() : '';
    const extraQ = (extraQuery !== undefined ? extraQuery : (this.tableFilter || '')).trim();
    const cacheKey = `${mainQ}__@@__${extraQ}`;

    if (this._cachedHighlightKey === cacheKey) {
      return this._cachedHighlightRegex;
    }

    const tokens = new Set();
    const parseTokens = q => {
      if (window.dataStore && typeof window.dataStore.parseSearchTokens === 'function') {
        return window.dataStore.parseSearchTokens(q);
      }
      const t = [];
      const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
      let m;
      while ((m = regex.exec(q)) !== null) {
        const item = (m[1] || m[2] || m[3] || '').trim();
        if (item) t.push(item);
      }
      return t;
    };

    if (mainQ) parseTokens(mainQ).forEach(w => { if (w.length > 0) tokens.add(w); });
    if (extraQ) parseTokens(extraQ).forEach(w => { if (w.length > 0) tokens.add(w); });

    this._cachedHighlightKey = cacheKey;

    if (tokens.size === 0) {
      this._cachedHighlightRegex = null;
      return null;
    }

    // Sort by length descending so longer exact phrases match before sub-words
    const words = Array.from(tokens).sort((a, b) => b.length - a.length);
    const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    this._cachedHighlightRegex = new RegExp(`(${escapedWords.join('|')})`, 'gi');
    return this._cachedHighlightRegex;
  }

  highlightText(str, extraQuery) {
    if (!str && str !== 0) return '';
    const safeStr = this.escapeHtml(str);
    const regex = this.getHighlightRegex(extraQuery);
    if (!regex) return safeStr;

    regex.lastIndex = 0;
    return safeStr.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  escapeJs(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  parseDate(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  render() {
    const selected = window.dataStore.selectedNode;
    const records = window.dataStore.getActiveRecords();

    this.renderBreadcrumbs(selected);
    this.renderStats(records);
    this.renderSolutionPills();

    // If user is actively typing in a memo field, skip comments/table re-render to preserve cursor focus
    const active = document.activeElement;
    if (active && (
      active.classList.contains('fix-comment-textarea') || 
      active.classList.contains('table-inline-input')
    )) {
      return;
    }

    this.renderComments(selected, records);
    this.renderTable(records);
    if (this.activeTab === 'chart') {
      this.renderChart(records);
    }
  }

  showToast(message) {
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = 'sync-toast';
    toast.innerHTML = `<i data-lucide="check-circle-2" style="width:14px; height:14px; color:var(--accent-emerald);"></i> <span>${this.escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 400);
    }, 2000);
  }

  toggleFixFilter(status) {
    if (window.dataStore.fixFilter === status) {
      window.dataStore.setFixFilter('all');
      this.sortColumn = 'faDate';
      this.sortDirection = 'desc';
    } else {
      window.dataStore.setFixFilter(status);
      this.sortColumn = 'confirmedAt';
      this.sortDirection = 'desc';
    }
  }

  getLevelPrefix(level) {
    if (level === 1) return 'CUSTOMER:';
    if (level === 2) return 'PART:';
    if (level === 3) return 'PROCESS:';
    if (level === 4) return 'DEFECT:';
    if (level === 5) return 'REF DES:';
    return 'ITEM:';
  }

  renderBreadcrumbs(selected) {
    if (!this.breadcrumbContainer) return;

    const maximal = window.dataStore ? window.dataStore.maximalSelectedNodes : [];

    if (maximal && maximal.length > 0) {
      let chipsHtml = '';
      maximal.forEach(node => {
        const prefix = this.getLevelPrefix(node.level);
        chipsHtml += `
          <div class="selection-chip" title="Deselect ${this.escapeHtml(node.name)}">
            <span class="chip-label-prefix">${prefix}</span>
            <span class="chip-label-text">${this.escapeHtml(node.name)}</span>
            <button type="button" class="chip-remove-btn" 
                    onclick="event.stopPropagation(); window.dataStore.toggleNodeChecked('${this.safeParam(node.key)}', false)" 
                    title="Deselect ${this.escapeHtml(node.name)}">✕</button>
          </div>
        `;
      });

      this.breadcrumbContainer.innerHTML = `
        <div class="selection-chips-wrapper">
          <div class="selection-chips-header">
            <i data-lucide="check-square" style="width: 15px; height: 15px; color: var(--accent-blue);"></i>
            <span>Selected (${maximal.length}):</span>
          </div>
          <div class="selection-chips-list">
            ${chipsHtml}
            <button type="button" class="selection-clear-all-btn" onclick="window.dataStore.clearTreeSelection()">Clear All ✕</button>
          </div>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ el: this.breadcrumbContainer });
      return;
    }

    let trail = [];
    if (!selected) {
      trail.push('<span class="breadcrumb-item active">All Defect Data</span>');
    } else {
      const { level, customer, parentPartNo, processRecorded, defectDescription, refDes } = selected;

      trail.push(`<span class="breadcrumb-item ${level === 1 ? 'active' : ''}">Customer: ${this.escapeHtml(customer)}</span>`);

      if (level >= 2) {
        trail.push(`<span class="breadcrumb-separator"><i data-lucide="chevron-right"></i></span>`);
        trail.push(`<span class="breadcrumb-item ${level === 2 ? 'active' : ''}">Part: ${this.escapeHtml(parentPartNo)}</span>`);
      }

      if (level >= 3) {
        trail.push(`<span class="breadcrumb-separator"><i data-lucide="chevron-right"></i></span>`);
        trail.push(`<span class="breadcrumb-item ${level === 3 ? 'active' : ''}">Process: ${this.escapeHtml(processRecorded)}</span>`);
      }

      if (level >= 4) {
        trail.push(`<span class="breadcrumb-separator"><i data-lucide="chevron-right"></i></span>`);
        trail.push(`<span class="breadcrumb-item ${level === 4 ? 'active' : ''}">Defect: ${this.escapeHtml(defectDescription)}</span>`);
      }

      if (level >= 5) {
        trail.push(`<span class="breadcrumb-separator"><i data-lucide="chevron-right"></i></span>`);
        trail.push(`<span class="breadcrumb-item ${level === 5 ? 'active' : ''}">Ref Des: ${this.escapeHtml(refDes)}</span>`);
      }
    }

    this.breadcrumbContainer.innerHTML = `<div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">${trail.join('')}</div>`;
    if (window.lucide) window.lucide.createIcons({ el: this.breadcrumbContainer });
  }

  getFixStatusBadgeClass(status) {
    const s = (status || 'Pending').toLowerCase().trim();
    if (s === 'yes') return 'yes';
    if (s === 'no') return 'no';
    if (s === 'false fail') return 'false-fail';
    if (s === 'possible false fail') return 'possible-false-fail';
    return 'pending';
  }

  renderSolutionPillsHtml() {
    const baseRecs = window.dataStore ? window.dataStore.getBaseFilteredRecords() : [];
    let yesCount = 0;
    let noCount = 0;
    let falseFailCount = 0;
    let possibleFalseFailCount = 0;

    for (let i = 0; i < baseRecs.length; i++) {
      const fix = baseRecs[i].confirmedFix;
      if (fix === 'Yes') yesCount++;
      else if (fix === 'No') noCount++;
      else if (fix === 'False Fail') falseFailCount++;
      else if (fix === 'Possible False Fail') possibleFalseFailCount++;
    }

    const activeFix = window.dataStore ? window.dataStore.fixFilter : 'all';
    const isSyncing = this.kpiSyncState === 'syncing';
    const isSynced = this.kpiSyncState === 'synced';
    const syncClass = isSyncing ? 'syncing' : (isSynced ? 'synced' : '');
    const syncTitle = isSyncing ? 'Retrieving latest solution annotations...' : 'Solution annotations up to date';
    const syncIcon = isSyncing ? 'loader-2' : 'check';
    const syncIconClass = isSyncing ? 'kpi-spin' : 'kpi-check';

    return `
      <button type="button" 
              class="filter-pill emerald ${activeFix === 'Yes' ? 'active' : ''}" 
              onclick="window.mainPanel.toggleFixFilter('Yes')" 
              title="${activeFix === 'Yes' ? 'Click to show all records' : 'Filter by Solution Confirmed (Yes)'}">
        <div class="pill-text-stack">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span class="pill-title-main">Solution</span>
            <span class="kpi-sync-indicator ${syncClass}" title="${syncTitle}">
              <i data-lucide="${syncIcon}" class="${syncIconClass}"></i>
            </span>
          </div>
          <span class="pill-title-sub">Confirmed</span>
          <span class="pill-action-hint">${activeFix === 'Yes' ? 'Click to remove filter' : 'Click to filter'}</span>
        </div>
        <span class="pill-count count-emerald">${yesCount.toLocaleString()}</span>
      </button>

      <button type="button" 
              class="filter-pill rose ${activeFix === 'No' ? 'active' : ''}" 
              onclick="window.mainPanel.toggleFixFilter('No')" 
              title="${activeFix === 'No' ? 'Click to show all records' : 'Filter by Solution Failed (No)'}">
        <div class="pill-text-stack">
          <span class="pill-title-main">Solution</span>
          <span class="pill-title-sub">Failed</span>
          <span class="pill-action-hint">${activeFix === 'No' ? 'Click to remove filter' : 'Click to filter'}</span>
        </div>
        <span class="pill-count count-rose">${noCount.toLocaleString()}</span>
      </button>

      <button type="button" 
              class="filter-pill purple ${activeFix === 'False Fail' ? 'active' : ''}" 
              onclick="window.mainPanel.toggleFixFilter('False Fail')" 
              title="${activeFix === 'False Fail' ? 'Click to show all records' : 'Filter by Solution False Fail'}">
        <div class="pill-text-stack">
          <span class="pill-title-main">Solution</span>
          <span class="pill-title-sub">False Fail</span>
          <span class="pill-action-hint">${activeFix === 'False Fail' ? 'Click to remove filter' : 'Click to filter'}</span>
        </div>
        <span class="pill-count count-purple">${falseFailCount.toLocaleString()}</span>
      </button>

      <button type="button" 
              class="filter-pill amber ${activeFix === 'Possible False Fail' ? 'active' : ''}" 
              onclick="window.mainPanel.toggleFixFilter('Possible False Fail')" 
              title="${activeFix === 'Possible False Fail' ? 'Click to show all records' : 'Filter by Solution Possible False Fail'}">
        <div class="pill-text-stack">
          <span class="pill-title-main">Solution</span>
          <span class="pill-title-sub">Possible False Fail</span>
          <span class="pill-action-hint">${activeFix === 'Possible False Fail' ? 'Click to remove filter' : 'Click to filter'}</span>
        </div>
        <span class="pill-count count-amber">${possibleFalseFailCount.toLocaleString()}</span>
      </button>
    `;
  }

  renderSolutionPills() {
    const html = this.renderSolutionPillsHtml();
    const tabbarPills = document.getElementById('tabbar-solution-pills');
    if (tabbarPills) {
      tabbarPills.innerHTML = html;
      if (window.lucide) window.lucide.createIcons({ el: tabbarPills });
    }
  }

  updateKpiSyncState(state) {
    this.kpiSyncState = state;
    const indicators = document.querySelectorAll('.kpi-sync-indicator');
    indicators.forEach(el => {
      if (state === 'syncing') {
        el.className = 'kpi-sync-indicator syncing';
        el.title = 'Retrieving latest solution annotations...';
        el.innerHTML = '<i data-lucide="loader-2" class="kpi-spin"></i>';
      } else if (state === 'synced') {
        el.className = 'kpi-sync-indicator synced';
        el.title = 'Solution annotations up to date';
        el.innerHTML = '<i data-lucide="check" class="kpi-check"></i>';
        setTimeout(() => {
          if (el && this.kpiSyncState === 'synced') {
            el.className = 'kpi-sync-indicator';
          }
        }, 2500);
      }
      if (window.lucide) window.lucide.createIcons({ el: el });
    });
  }

  countUniqueSerialNumbers(recordList) {
    if (!recordList || recordList.length === 0) return 0;
    const snSet = new Set();
    const invalidValues = new Set(['', '-', 'N/A', 'NA', 'NONE', '[NONE]', 'UNKNOWN', 'NULL', 'UNDEFINED']);

    for (let i = 0; i < recordList.length; i++) {
      const sn = (recordList[i].serialNo || '').toString().trim().toUpperCase();
      if (sn && !invalidValues.has(sn)) {
        snSet.add(sn);
      }
    }
    return snSet.size;
  }

  renderStats(records) {
    const counterEl = document.getElementById('workspace-records-counter');
    if (!counterEl) return;

    const allRaw = window.dataStore.rawRecords || [];
    const globalTotal = allRaw.length;
    const selectedTotal = records ? records.length : 0;
    const hasTreeSelection = (window.dataStore && window.dataStore.maximalSelectedNodes && window.dataStore.maximalSelectedNodes.length > 0) || !!window.dataStore.selectedNode;
    const isFiltered = !!(hasTreeSelection || window.dataStore.searchQuery || window.dataStore.fixFilter !== 'all' || window.dataStore.datePreset !== 'all');

    // Efficiently cache global unique serial numbers
    if (this._cachedGlobalRawLength !== globalTotal) {
      this._cachedGlobalUniqueSNs = this.countUniqueSerialNumbers(allRaw);
      this._cachedGlobalRawLength = globalTotal;
    }
    const globalSNs = this._cachedGlobalUniqueSNs || 0;

    if (isFiltered) {
      const selectedSNs = this.countUniqueSerialNumbers(records);
      counterEl.innerHTML = `
        <i data-lucide="filter" style="width: 18px; height: 18px; color: var(--accent-blue);"></i>
        <span class="count-label">Filtered:</span>
        <span class="count-highlight">${selectedTotal.toLocaleString()}</span>
        <span class="count-divider">/</span>
        <span class="count-total">${globalTotal.toLocaleString()}</span>
        <span class="count-label">Records</span>
        <span class="count-sn-badge" title="${selectedSNs.toLocaleString()} unique serial numbers in filtered results">(<span class="count-sn-number">${selectedSNs.toLocaleString()}</span> Unique SNs)</span>
      `;
    } else {
      counterEl.innerHTML = `
        <i data-lucide="database" style="width: 18px; height: 18px; color: var(--accent-blue);"></i>
        <span class="count-total">${globalTotal.toLocaleString()}</span>
        <span class="count-label">Total Records</span>
        <span class="count-sn-badge" title="${globalSNs.toLocaleString()} total unique serial numbers in dataset">(<span class="count-sn-number">${globalSNs.toLocaleString()}</span> Unique SNs)</span>
      `;
    }

    if (window.lucide) window.lucide.createIcons({ el: counterEl });
  }

  renderComments(selected, records) {
    if (!this.commentsContainer) return;

    const totalCount = records.length;
    const commentsList = records.slice(0, 50);

    if (this.commentsTitle) {
      const countInfo = totalCount > 50 
        ? ` (Showing 50 most recent of ${totalCount.toLocaleString()} records)` 
        : ` (${totalCount.toLocaleString()} records)`;

      const maximal = window.dataStore ? window.dataStore.maximalSelectedNodes : [];
      if (maximal && maximal.length > 1) {
        this.commentsTitle.innerHTML = `<i data-lucide="message-square"></i> Failure & Defect Comments Feed for Multi-Selection (${maximal.length} items)${countInfo}`;
      } else if (selected && selected.level === 5) {
        this.commentsTitle.innerHTML = `<i data-lucide="message-square"></i> Failure, Defect & Repair Comments for Ref Des: <span style="color: var(--accent-blue);">${this.escapeHtml(selected.refDes)}</span>${countInfo}`;
      } else if (selected && selected.level === 4) {
        this.commentsTitle.innerHTML = `<i data-lucide="message-square"></i> Failure, Defect & Repair Comments for <span style="color: var(--accent-blue);">${this.escapeHtml(selected.defectDescription)}</span>${countInfo}`;
      } else if (selected && selected.level === 3) {
        this.commentsTitle.innerHTML = `<i data-lucide="message-square"></i> Failure, Defect & Repair Comments for Process: <span style="color: var(--accent-blue);">${this.escapeHtml(selected.processRecorded)}</span>${countInfo}`;
      } else if (selected && selected.level === 2) {
        this.commentsTitle.innerHTML = `<i data-lucide="message-square"></i> Failure & Defect Comments Feed for Part: <span style="color: var(--accent-blue);">${this.escapeHtml(selected.parentPartNo)}</span>${countInfo}`;
      } else if (selected && selected.level === 1) {
        this.commentsTitle.innerHTML = `<i data-lucide="message-square"></i> Failure & Defect Comments Feed for Customer: <span style="color: var(--accent-blue);">${this.escapeHtml(selected.customer)}</span>${countInfo}`;
      } else {
        this.commentsTitle.innerHTML = `<i data-lucide="message-square"></i> Failure & Defect Comments Feed${countInfo}`;
      }
      if (window.lucide) window.lucide.createIcons({ el: this.commentsTitle });
    }

    if (commentsList.length === 0) {
      this.commentsContainer.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💬</div>
          <p>No records found for this selection.</p>
        </div>
      `;
      return;
    }

    let html = '';
    commentsList.forEach(rec => {
      html += this.renderCommentCardHtml(rec);
    });

    this.commentsContainer.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ el: this.commentsContainer });
  }

  formatConfirmedDate(status, timestamp) {
    if (!status || status === 'Pending' || !timestamp) {
      return '<span class="confirmed-date-val" style="color: var(--text-muted); font-size: 0.8rem; font-family: \'JetBrains Mono\', monospace;">Confirmed: N/A</span>';
    }
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) {
      return `<span class="confirmed-date-val" style="color: var(--text-muted); font-size: 0.8rem; font-family: 'JetBrains Mono', monospace;">Confirmed: ${this.escapeHtml(timestamp)}</span>`;
    }
    const dateStr = d.toLocaleString([], {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    return `<span class="confirmed-date-val" style="color: var(--accent-emerald); font-weight: 600; font-size: 0.8rem; font-family: 'JetBrains Mono', monospace;" title="Solution Confirmed: ${this.escapeHtml(d.toLocaleString())}">Confirmed: ${this.escapeHtml(dateStr)}</span>`;
  }

  renderCommentCardHtml(rec) {
    const fixStatus = rec.confirmedFix || 'Pending';
    const fixComment = rec.fixComment || '';

    return `
      <div class="comment-card" style="margin-bottom: 1rem;">
        <div class="comment-card-header">
          <div class="comment-tags">
            <span class="tag" style="color: var(--accent-blue); font-weight: 700;">Part: ${this.highlightText(rec.parentPartNo || 'N/A')}</span>
            <span class="tag" style="color: var(--accent-blue); font-weight: 600;">Date: ${this.escapeHtml(rec.faDate || 'N/A')}</span>
            ${rec.serialNo ? `<span class="tag" style="color: var(--accent-amber); font-weight: 600;">SN: ${this.highlightText(rec.serialNo)}</span>` : ''}
            <span class="tag">Ref Des: ${this.highlightText(rec.refDes || 'N/A')}</span>
          </div>

          <!-- Solution Confirmed Selector -->
          <div style="display: flex; align-items: center; gap: 0.5rem;" onclick="event.stopPropagation()">
            <span style="font-size: 0.78rem; font-weight: 600; color: var(--accent-emerald); text-transform: uppercase; letter-spacing: 0.03em;">Solution Confirmed:</span>
            <select class="fix-status-badge ${this.getFixStatusBadgeClass(fixStatus)}" 
                    onchange="window.mainPanel.handleEncodedFixStatusChange('${this.safeParam(rec.serialNo)}', '${this.safeParam(rec.faDate)}', '${this.safeParam(rec.refDes)}', '${this.safeParam(rec.defectDescription)}', this.value, this)">
              <option value="Pending" ${fixStatus === 'Pending' ? 'selected' : ''}>❓ Pending</option>
              <option value="Yes" ${fixStatus === 'Yes' ? 'selected' : ''}>✅ Yes (Confirmed)</option>
              <option value="No" ${fixStatus === 'No' ? 'selected' : ''}>❌ No (Failed)</option>
              <option value="False Fail" ${fixStatus === 'False Fail' ? 'selected' : ''}>⚡ False Fail</option>
              <option value="Possible False Fail" ${fixStatus === 'Possible False Fail' ? 'selected' : ''}>⚠️ Possible False Fail</option>
            </select>
            <span class="solution-confirmed-date-container">
              ${this.formatConfirmedDate(fixStatus, rec.confirmedAt)}
            </span>
          </div>
        </div>

        <!-- Failure Comment Block -->
        ${rec.failureComment ? `
          <div class="comment-block failure-block">
            <div class="comment-block-label amber-label">
              <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i>
              <strong>Failure Comment</strong> ${rec.whoFailed ? `<span class="user-badge">by ${this.highlightText(rec.whoFailed)}</span>` : ''}
            </div>
            <div class="comment-text">${this.highlightText(rec.failureComment)}</div>
          </div>
        ` : ''}

        <!-- Defect Comment Block -->
        ${rec.defectComment ? `
          <div class="comment-block defect-block">
            <div class="comment-block-label blue-label">
              <i data-lucide="wrench" style="width: 14px; height: 14px;"></i>
              <strong>Defect Comment</strong> ${rec.debugTech ? `<span class="user-badge">by ${this.highlightText(rec.debugTech)}</span>` : ''}
            </div>
            <div class="comment-text">${this.highlightText(rec.defectComment)}</div>
          </div>
        ` : ''}

        <!-- Repair Comment Block -->
        ${rec.repairComment ? `
          <div class="comment-block repair-block">
            <div class="comment-block-label purple-label">
              <i data-lucide="tool" style="width: 14px; height: 14px;"></i>
              <strong>Repair Comment</strong> ${rec.repairTech ? `<span class="user-badge">by ${this.highlightText(rec.repairTech)}</span>` : ''}
            </div>
            <div class="comment-text">${this.highlightText(rec.repairComment)}</div>
          </div>
        ` : ''}

        <!-- Solution Memo Editable Block -->
        <div class="comment-block fix-memo-block" onclick="event.stopPropagation()">
          <div class="comment-block-label emerald-label" style="display: flex; justify-content: space-between; align-items: center;">
            <span style="display: flex; align-items: center; gap: 0.35rem;">
              <i data-lucide="check-square" style="width: 14px; height: 14px;"></i>
              <strong>Solution Memo</strong>
            </span>
            <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 400;">Linked by SN: ${this.highlightText(rec.serialNo)} | Ref: ${this.highlightText(rec.refDes)}</span>
          </div>
          <textarea class="fix-comment-textarea" 
                    placeholder="Type solution notes, root cause confirmation, or testing results..."
                    oninput="window.mainPanel.handleEncodedFixCommentInput('${this.safeParam(rec.serialNo)}', '${this.safeParam(rec.faDate)}', '${this.safeParam(rec.refDes)}', '${this.safeParam(rec.defectDescription)}', this.value)"
                    onchange="window.mainPanel.handleEncodedFixCommentChange('${this.safeParam(rec.serialNo)}', '${this.safeParam(rec.faDate)}', '${this.safeParam(rec.refDes)}', '${this.safeParam(rec.defectDescription)}', this.value)"
          >${this.escapeHtml(fixComment)}</textarea>
        </div>

        <div class="comment-meta">
          <span><strong>Customer:</strong> ${this.highlightText(rec.customer || 'N/A')}</span>
          <span><strong>Process:</strong> ${this.highlightText(rec.processRecorded || 'N/A')}</span>
          ${rec.defectCode ? `<span><strong>Defect Code:</strong> <span style="color: var(--accent-purple); font-weight: 600;">${this.highlightText(rec.defectCode)}</span></span>` : ''}
          <span><strong>Defect:</strong> ${this.highlightText(rec.defectDescription || 'N/A')}</span>
          ${rec.failureCode ? `<span><strong>Failure Code:</strong> <span style="color: var(--accent-rose); font-weight: 600;">${this.highlightText(rec.failureCode)}</span></span>` : ''}
        </div>
      </div>
    `;
  }

  ensureRecordCommentsModalExists() {
    let modal = document.getElementById('record-comments-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'record-comments-modal';
      modal.className = 'lightbox-modal';
      modal.onclick = (e) => this.closeRecordCommentsModal(e);
      modal.innerHTML = `
        <div class="modal-dialog" onclick="event.stopPropagation()">
          <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding: 1.25rem 1.75rem;">
            <h3 id="record-comments-modal-title" style="margin: 0; font-size: 1.3rem; display: flex; align-items: center; gap: 0.6rem; color: #fff;">
              <i data-lucide="message-square" style="color: var(--accent-blue);"></i> Record Details & Comments
            </h3>
            <button class="modal-close-btn" onclick="window.mainPanel.closeRecordCommentsModal()" style="background: none; border: none; font-size: 1.8rem; color: var(--text-muted); cursor: pointer; padding: 0 0.5rem; line-height: 1;">&times;</button>
          </div>
          <div id="record-comments-modal-body" style="padding: 1.75rem; overflow-y: auto; flex: 1;"></div>
          <div style="display: flex; justify-content: flex-end; padding: 1rem 1.75rem; border-top: 1px solid var(--border-color); background: rgba(0,0,0,0.15);">
            <button class="btn" onclick="window.mainPanel.closeRecordCommentsModal()">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    return modal;
  }

  openRecordCommentsModal(rec) {
    const modal = this.ensureRecordCommentsModalExists();
    const titleEl = document.getElementById('record-comments-modal-title');
    const bodyEl = document.getElementById('record-comments-modal-body');
    if (!modal || !bodyEl || !rec) return;

    if (titleEl) {
      titleEl.innerHTML = `<i data-lucide="message-square" style="color: var(--accent-blue);"></i> Record Details: <span style="color: var(--accent-blue); font-weight: 700;">${this.highlightText(rec.parentPartNo || 'N/A')}</span> | <span style="color: var(--accent-amber); font-family: 'JetBrains Mono', monospace;">SN: ${this.highlightText(rec.serialNo || 'SN N/A')}</span> (${this.highlightText(rec.refDes || 'No Ref')})`;
    }

    bodyEl.innerHTML = this.renderCommentCardHtml(rec);
    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons({ el: modal });
  }

  openRecordCommentsModalByIndex(index) {
    const idx = parseInt(index, 10);
    const rec = (this.currentPaginatedRecords && this.currentPaginatedRecords[idx])
             || (this.currentRecords && this.currentRecords[idx])
             || (window.dataStore && window.dataStore.getActiveRecords() && window.dataStore.getActiveRecords()[idx]);
    if (!rec) {
      console.warn('[MODAL] Record not found at index:', index);
      return;
    }
    this.openRecordCommentsModal(rec);
  }

  closeRecordCommentsModal(event) {
    if (event && event.target && !event.target.classList.contains('lightbox-modal') && !event.target.classList.contains('modal-close-btn') && event.target.tagName !== 'BUTTON') {
      return;
    }
    const modal = document.getElementById('record-comments-modal');
    if (modal) modal.style.display = 'none';
  }

  handleEncodedFixStatusChange(encSerialNo, encFaDate, encRefDes, encDefectDesc, newStatus, selectEl = null) {
    const serialNo = decodeURIComponent(encSerialNo);
    const faDate = decodeURIComponent(encFaDate);
    const refDes = decodeURIComponent(encRefDes || '');
    const defectDesc = decodeURIComponent(encDefectDesc || '');
    this.handleFixStatusChange(serialNo, faDate, refDes, defectDesc, newStatus, selectEl);
  }

  handleEncodedFixCommentInput(encSerialNo, encFaDate, encRefDes, encDefectDesc, newComment) {
    const serialNo = decodeURIComponent(encSerialNo);
    const faDate = decodeURIComponent(encFaDate);
    const refDes = decodeURIComponent(encRefDes || '');
    const defectDesc = decodeURIComponent(encDefectDesc || '');

    if (this.commentDebounceTimer) {
      clearTimeout(this.commentDebounceTimer);
    }

    this.commentDebounceTimer = setTimeout(() => {
      this.handleFixCommentChange(serialNo, faDate, refDes, defectDesc, newComment, true);
    }, 400);
  }

  handleEncodedFixCommentChange(encSerialNo, encFaDate, encRefDes, encDefectDesc, newComment) {
    const serialNo = decodeURIComponent(encSerialNo);
    const faDate = decodeURIComponent(encFaDate);
    const refDes = decodeURIComponent(encRefDes || '');
    const defectDesc = decodeURIComponent(encDefectDesc || '');
    if (this.commentDebounceTimer) {
      clearTimeout(this.commentDebounceTimer);
    }
    this.handleFixCommentChange(serialNo, faDate, refDes, defectDesc, newComment, false);
  }

  handleFixStatusChange(serialNo, faDate, refDes, defectDescription, newStatus, selectEl = null) {
    const sn = (serialNo || '').trim();
    const dt = (faDate || '').trim();
    const ref = (refDes || '').trim();
    const desc = (defectDescription || '').trim();
    const key4 = `${sn}_${dt}_${ref}_${desc}`;
    const key2 = `${sn}_${dt}`;

    const currentAnn = window.dataStore.annotationsMap[key4] || window.dataStore.annotationsMap[key2] || {};
    window.dataStore.updateFixAnnotation(serialNo, faDate, newStatus, currentAnn.fixComment || '', refDes, defectDescription);
    this.showToast('⚡ Solution status synced to server backend');

    if (selectEl) {
      selectEl.className = `fix-status-badge ${this.getFixStatusBadgeClass(newStatus)}`;
      const parentContainer = selectEl.closest('div');
      if (parentContainer) {
        const dateContainer = parentContainer.querySelector('.solution-confirmed-date-container');
        if (dateContainer) {
          const nowIso = new Date().toISOString();
          dateContainer.innerHTML = this.formatConfirmedDate(newStatus, newStatus === 'Pending' ? null : nowIso);
        }
      }
    }
  }

  handleFixCommentChange(serialNo, faDate, refDes, defectDescription, newComment, isDebounced = false) {
    const sn = (serialNo || '').trim();
    const dt = (faDate || '').trim();
    const ref = (refDes || '').trim();
    const desc = (defectDescription || '').trim();
    const key4 = `${sn}_${dt}_${ref}_${desc}`;
    const key2 = `${sn}_${dt}`;

    const currentAnn = window.dataStore.annotationsMap[key4] || window.dataStore.annotationsMap[key2] || {};
    if (currentAnn.fixComment === newComment) return;

    window.dataStore.updateFixAnnotation(serialNo, faDate, currentAnn.confirmedFix || 'Pending', newComment, refDes, defectDescription);
    if (!isDebounced) {
      this.showToast('⚡ Solution memo synced to server backend');
    }
  }

  renderTable(records) {
    this.currentRecords = records;
    this.currentPage = 1;
    this.renderTableOnly();
  }

  setPageSize(size) {
    this.pageSize = size === 'all' ? 'all' : parseInt(size, 10);
    this.currentPage = 1;
    this.renderTableOnly();
  }

  goToPage(page) {
    this.currentPage = page;
    this.renderTableOnly();
  }

  renderPaginationControls(totalRecords) {
    const topContainer = document.getElementById('table-pagination-top');
    const bottomContainer = document.getElementById('table-pagination-bottom');

    if (!topContainer && !bottomContainer) return;

    if (totalRecords === 0) {
      const emptyHtml = `
        <div class="table-pagination">
          <div class="page-size-label">
            <span>Show</span>
            <select class="page-size-select" onchange="window.mainPanel.setPageSize(this.value)">
              <option value="25" ${this.pageSize == 25 ? 'selected' : ''}>25</option>
              <option value="50" ${this.pageSize == 50 ? 'selected' : ''}>50</option>
              <option value="100" ${this.pageSize == 100 ? 'selected' : ''}>100</option>
              <option value="250" ${this.pageSize == 250 ? 'selected' : ''}>250</option>
              <option value="all" ${this.pageSize === 'all' ? 'selected' : ''}>All</option>
            </select>
            <span>per page</span>
          </div>

          <div class="page-info-badge">
            Showing 0 of 0 records
          </div>

          <div class="pagination-controls-group">
            <button class="pagination-btn" disabled title="First Page">&laquo;</button>
            <button class="pagination-btn" disabled title="Previous Page">&lt;</button>
            <span class="pagination-btn active">Page 0 of 0</span>
            <button class="pagination-btn" disabled title="Next Page">&gt;</button>
            <button class="pagination-btn" disabled title="Last Page">&raquo;</button>
          </div>
        </div>
      `;
      if (topContainer) topContainer.innerHTML = emptyHtml;
      if (bottomContainer) bottomContainer.innerHTML = emptyHtml;
      return;
    }

    const isAll = this.pageSize === 'all';
    const effectivePageSize = isAll ? totalRecords : parseInt(this.pageSize, 10);
    const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalRecords / effectivePageSize));

    if (this.currentPage > totalPages) {
      this.currentPage = totalPages;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }

    const startItem = (this.currentPage - 1) * effectivePageSize + 1;
    const endItem = isAll ? totalRecords : Math.min(this.currentPage * effectivePageSize, totalRecords);

    const html = `
      <div class="table-pagination">
        <div class="page-size-label">
          <span>Show</span>
          <select class="page-size-select" onchange="window.mainPanel.setPageSize(this.value)">
            <option value="25" ${this.pageSize == 25 ? 'selected' : ''}>25</option>
            <option value="50" ${this.pageSize == 50 ? 'selected' : ''}>50</option>
            <option value="100" ${this.pageSize == 100 ? 'selected' : ''}>100</option>
            <option value="250" ${this.pageSize == 250 ? 'selected' : ''}>250</option>
            <option value="all" ${this.pageSize === 'all' ? 'selected' : ''}>All</option>
          </select>
          <span>per page</span>
        </div>

        <div class="page-info-badge">
          Showing ${startItem.toLocaleString()} - ${endItem.toLocaleString()} of ${totalRecords.toLocaleString()} records
        </div>

        <div class="pagination-controls-group">
          <button class="pagination-btn" ${this.currentPage <= 1 ? 'disabled' : ''} onclick="window.mainPanel.goToPage(1)" title="First Page">
            &laquo;
          </button>
          <button class="pagination-btn" ${this.currentPage <= 1 ? 'disabled' : ''} onclick="window.mainPanel.goToPage(${this.currentPage - 1})" title="Previous Page">
            &lt;
          </button>
          
          <span class="pagination-btn active">
            Page ${this.currentPage} of ${totalPages}
          </span>

          <button class="pagination-btn" ${this.currentPage >= totalPages ? 'disabled' : ''} onclick="window.mainPanel.goToPage(${this.currentPage + 1})" title="Last Page">
            &gt;
          </button>
          <button class="pagination-btn" ${this.currentPage >= totalPages ? 'disabled' : ''} onclick="window.mainPanel.goToPage(${totalPages})" title="Last Page">
            &raquo;
          </button>
        </div>
      </div>
    `;

    if (topContainer) topContainer.innerHTML = html;
    if (bottomContainer) bottomContainer.innerHTML = html;
  }

  renderTableOnly() {
    if (!this.tableBody) return;

    let records = (this.currentRecords || []).slice();

    if (this.tableFilter) {
      const q = this.tableFilter;
      records = records.filter(r => 
        r.serialNo.toLowerCase().includes(q) ||
        r.processRecorded.toLowerCase().includes(q) ||
        r.failureComment.toLowerCase().includes(q) ||
        r.defectComment.toLowerCase().includes(q) ||
        r.fixComment.toLowerCase().includes(q) ||
        r.defectDescription.toLowerCase().includes(q) ||
        r.refDes.toLowerCase().includes(q) ||
        r.debugTech.toLowerCase().includes(q) ||
        r.repairComment.toLowerCase().includes(q)
      );
    }

    records = this.sortData(records);
    this.updateTableHeaderSortUI();

    const totalRecords = records.length;
    this.renderPaginationControls(totalRecords);

    if (totalRecords === 0) {
      this.tableBody.innerHTML = `
        <tr>
          <td colspan="13" class="empty-state" style="padding: 2rem;">
            No records found matching criteria.
          </td>
        </tr>
      `;
      return;
    }

    let paginatedRecords = records;
    if (this.pageSize !== 'all') {
      const pageSize = parseInt(this.pageSize, 10);
      const startIndex = (this.currentPage - 1) * pageSize;
      paginatedRecords = records.slice(startIndex, startIndex + pageSize);
    }
    this.currentPaginatedRecords = paginatedRecords;

    let html = '';
    paginatedRecords.forEach((r, idx) => {
      const fixStatus = r.confirmedFix || 'Pending';
      const fixComment = r.fixComment || '';

      html += `
        <tr class="record-row-clickable" data-row-index="${idx}" ondblclick="window.mainPanel.openRecordCommentsModalByIndex(${idx})" title="Double-click to view all failure, defect, repair comments & solution notes for this record">
          <td><span style="font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--accent-blue);">${this.escapeHtml(r.faDate)}</span></td>
          <td><strong>${this.highlightText(r.parentPartNo)}</strong></td>
          <td><span style="font-family: 'JetBrains Mono', monospace; color: var(--accent-amber);">${this.highlightText(r.serialNo || '-')}</span></td>
          <td><span class="tag" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border-color: rgba(56, 189, 248, 0.25); font-weight: 600;">${this.highlightText(r.processRecorded || '-')}</span></td>
          <td>${this.highlightText(r.defectDescription)}</td>
          <td><span class="tag">${this.highlightText(r.refDes)}</span></td>
          <td style="text-align: center; font-weight: 600;">${r.defectQuantity}</td>
          
          <!-- Solution Confirmed Status -->
          <td onclick="event.stopPropagation()">
            <select class="fix-status-badge ${this.getFixStatusBadgeClass(fixStatus)}" 
                    onchange="window.mainPanel.handleEncodedFixStatusChange('${this.safeParam(r.serialNo)}', '${this.safeParam(r.faDate)}', '${this.safeParam(r.refDes)}', '${this.safeParam(r.defectDescription)}', this.value, this)">
              <option value="Pending" ${fixStatus === 'Pending' ? 'selected' : ''}>Pending</option>
              <option value="Yes" ${fixStatus === 'Yes' ? 'selected' : ''}>Yes</option>
              <option value="No" ${fixStatus === 'No' ? 'selected' : ''}>No</option>
              <option value="False Fail" ${fixStatus === 'False Fail' ? 'selected' : ''}>False Fail</option>
              <option value="Possible False Fail" ${fixStatus === 'Possible False Fail' ? 'selected' : ''}>Possible False Fail</option>
            </select>
          </td>

          <!-- Solution Memo Input -->
          <td style="max-width: 200px;" onclick="event.stopPropagation()">
            <input type="text" class="table-inline-input" value="${this.escapeHtml(fixComment)}" 
                   placeholder="Add solution memo..." 
                   oninput="window.mainPanel.handleEncodedFixCommentInput('${this.safeParam(r.serialNo)}', '${this.safeParam(r.faDate)}', '${this.safeParam(r.refDes)}', '${this.safeParam(r.defectDescription)}', this.value)"
                   onchange="window.mainPanel.handleEncodedFixCommentChange('${this.safeParam(r.serialNo)}', '${this.safeParam(r.faDate)}', '${this.safeParam(r.refDes)}', '${this.safeParam(r.defectDescription)}', this.value)" />
          </td>

          <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent-amber);" title="${this.escapeHtml(r.failureComment)}">${this.highlightText(r.failureComment || '-')}</td>
          <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this.escapeHtml(r.defectComment)}">${this.highlightText(r.defectComment || '-')}</td>
          <td>${this.highlightText(r.debugTech || '-')}</td>
          <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${this.escapeHtml(r.repairComment)}">${this.highlightText(r.repairComment || '-')}</td>
        </tr>
      `;
    });

    this.tableBody.innerHTML = html;
  }

  exportCSV() {
    const records = (this.currentRecords || window.dataStore.getActiveRecords()).slice();
    records.sort((a, b) => this.parseDate(b.faDate) - this.parseDate(a.faDate));

    if (!records || records.length === 0) {
      alert('No data to export.');
      return;
    }

    const headers = [
      'Customer', 'Parent Part No.', 'Serial No.', 'F.A. Date', 'Process Recorded',
      'Defect Description', 'Defect Code', 'Ref Des', 'Defect Quantity',
      'Solution Confirmed', 'Solution Memo', 'Failure Comment', 'Defect Comment', 'Debug Tech', 'Repair Description', 'Repair Comment'
    ];

    const sanitizeCsvCell = (val) => {
      if (val === null || val === undefined) return '""';
      let str = String(val).replace(/"/g, '""');
      if (/^[=\+\-\@\t\r]/.test(str)) {
        str = "'" + str;
      }
      return `"${str}"`;
    };

    const rows = records.map(r => [
      sanitizeCsvCell(r.customer),
      sanitizeCsvCell(r.parentPartNo),
      sanitizeCsvCell(r.serialNo),
      sanitizeCsvCell(r.faDate),
      sanitizeCsvCell(r.processRecorded),
      sanitizeCsvCell(r.defectDescription),
      sanitizeCsvCell(r.defectCode),
      sanitizeCsvCell(r.refDes),
      parseInt(r.defectQuantity, 10) || 1,
      sanitizeCsvCell(r.confirmedFix || 'Pending'),
      sanitizeCsvCell(r.fixComment),
      sanitizeCsvCell(r.failureComment),
      sanitizeCsvCell(r.defectComment),
      sanitizeCsvCell(r.debugTech),
      sanitizeCsvCell(r.repairDescription),
      sanitizeCsvCell(r.repairComment)
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `DefectDetails_Export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  openServerSettingsModal() {
    const modal = document.getElementById('server-settings-modal');
    const input = document.getElementById('server-url-input');
    const statusDiv = document.getElementById('server-modal-status');
    const candidatesDiv = document.getElementById('server-candidates-list');

    if (!modal) return;

    const currentUrl = window.dataStore.activeServerUrl || localStorage.getItem('DEFECT_APP_SERVER_URL') || 'http://localhost:8080';
    if (input) input.value = currentUrl;

    if (statusDiv) {
      if (window.dataStore.syncStatus === 'connected') {
        statusDiv.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 600;">⚡ Connected to Central Server: ${this.escapeHtml(window.dataStore.activeServerUrl)}</span>`;
      } else if (window.dataStore.syncStatus === 'shared_file') {
        statusDiv.innerHTML = `<span style="color: var(--accent-blue); font-weight: 600;">⚡ Shared Drive Network File Sync Active (file://)</span>`;
      } else {
        statusDiv.innerHTML = `<span style="color: var(--accent-rose); font-weight: 600;">❌ Disconnected / Local Mode</span>`;
      }
    }

    if (candidatesDiv) {
      const candidates = ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://10.100.51.64:8080', 'http://HSV-TE-23794:8080'];
      if (window.CENTRAL_SERVER_CONFIG && Array.isArray(window.CENTRAL_SERVER_CONFIG.serverUrls)) {
        window.CENTRAL_SERVER_CONFIG.serverUrls.forEach(u => {
          if (u && !candidates.includes(u)) candidates.push(u);
        });
      }

      let html = '';
      candidates.forEach(url => {
        const safeUrl = this.escapeHtml(url);
        const safeParamUrl = encodeURIComponent(url).replace(/'/g, '%27');
        html += `<button type="button" class="btn" style="font-size: 0.75rem; padding: 0.25rem 0.5rem;" onclick="document.getElementById('server-url-input').value=decodeURIComponent('${safeParamUrl}')">${safeUrl}</button>`;
      });
      candidatesDiv.innerHTML = html;
    }

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons();
  }

  closeServerSettingsModal(event) {
    if (event && event.target && !event.target.classList.contains('lightbox-modal') && !event.target.classList.contains('lightbox-close')) {
      return;
    }
    const modal = document.getElementById('server-settings-modal');
    if (modal) modal.style.display = 'none';
  }

  async saveServerSettings() {
    const input = document.getElementById('server-url-input');
    if (input && input.value) {
      const url = input.value.trim();
      window.dataStore.setServerUrl(url);
      await window.dataStore.forceSyncNow();
      this.closeServerSettingsModal();
      this.showToast(`⚡ Connected to ${url}`);
    }
  }

  renderChart(records) {
    const recs = records || (window.dataStore ? window.dataStore.getActiveRecords() : []);
    if (this.chartViewMode === 'pareto') {
      this.renderParetoChart(recs);
    } else {
      this.renderTimelineChart(recs);
    }
  }

  setChartViewMode(mode) {
    this.chartViewMode = mode === 'pareto' ? 'pareto' : 'timeline';
    const btnTimeline = document.getElementById('chart-view-btn-timeline');
    const btnPareto = document.getElementById('chart-view-btn-pareto');
    if (btnTimeline) btnTimeline.classList.toggle('active', this.chartViewMode === 'timeline');
    if (btnPareto) btnPareto.classList.toggle('active', this.chartViewMode === 'pareto');

    const timeWrap = document.getElementById('chart-time-grouping-wrapper');
    const paretoWrap = document.getElementById('chart-pareto-grouping-wrapper');
    if (timeWrap) timeWrap.style.display = this.chartViewMode === 'timeline' ? 'flex' : 'none';
    if (paretoWrap) paretoWrap.style.display = this.chartViewMode === 'pareto' ? 'flex' : 'none';

    this.renderChart();
  }

  setParetoGrouping(dimension) {
    this.paretoGrouping = dimension || 'defectDescription';
    const map = {
      'defectDescription': 'pareto-grp-defect',
      'refDes': 'pareto-grp-refdes',
      'processRecorded': 'pareto-grp-process',
      'parentPartNo': 'pareto-grp-part'
    };
    Object.keys(map).forEach(dim => {
      const btn = document.getElementById(map[dim]);
      if (btn) btn.classList.toggle('active', this.paretoGrouping === dim);
    });
    this.renderChart();
  }

  setChartGranularity(mode) {
    this.chartGranularity = mode || 'auto';
    ['auto', 'daily', 'weekly', 'monthly'].forEach(m => {
      const btn = document.getElementById(`gran-btn-${m}`);
      if (btn) btn.classList.toggle('active', this.chartGranularity === m);
    });
    this.renderChart(window.dataStore.getActiveRecords());
  }

  setChartMetric(metric) {
    this.chartMetric = metric === 'uniqueSN' ? 'uniqueSN' : 'defects';
    try {
      localStorage.setItem('DEFECT_APP_CHART_METRIC', this.chartMetric);
    } catch (e) {}
    const isSN = this.chartMetric === 'uniqueSN';
    const btnDefects = document.getElementById('chart-metric-btn-defects');
    const btnSN = document.getElementById('chart-metric-btn-uniquesn');
    if (btnDefects) btnDefects.classList.toggle('active', !isSN);
    if (btnSN) btnSN.classList.toggle('active', isSN);
    this.renderChart(window.dataStore.getActiveRecords());
  }

  renderTimelineChart(records) {
    const canvas = document.getElementById('timeline-chart-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('chart-canvas-wrapper');
    const legendContainer = document.getElementById('chart-legend-container');
    const heading = document.getElementById('chart-heading');
    const subheading = document.getElementById('chart-subheading');

    const isSNMode = this.chartMetric === 'uniqueSN';
    const btnDefects = document.getElementById('chart-metric-btn-defects');
    const btnSN = document.getElementById('chart-metric-btn-uniquesn');
    if (btnDefects) btnDefects.classList.toggle('active', !isSNMode);
    if (btnSN) btnSN.classList.toggle('active', isSNMode);

    const selected = window.dataStore.selectedNode;
    const maximal = window.dataStore ? window.dataStore.maximalSelectedNodes : [];
    if (heading) {
      let trail = [];
      if (maximal && maximal.length > 1) {
        const names = maximal.map(n => n.name);
        trail.push(`Multi-Selection (${maximal.length} items: ${names.slice(0, 3).join(', ')}${maximal.length > 3 ? '...' : ''})`);
      } else if (!selected) {
        trail.push('All Defect Data (All Customers & Programs)');
      } else {
        const { level, customer, parentPartNo, processRecorded, defectDescription, refDes } = selected;
        if (customer) trail.push(`Customer: ${customer}`);
        if (level >= 2 && parentPartNo) trail.push(`Part: ${parentPartNo}`);
        if (level >= 3 && processRecorded) trail.push(`Process: ${processRecorded}`);
        if (level >= 4 && defectDescription) trail.push(`Defect: ${defectDescription}`);
        if (level >= 5 && refDes) trail.push(`Ref Des: ${refDes}`);
      }

      if (window.dataStore.searchQuery) {
        trail.push(`[Search: "${window.dataStore.searchQuery}"]`);
      }

      const fullTrail = trail.join(' ➔ ');
      const metricLabel = isSNMode ? 'Unique Serial Numbers' : 'Defect Quantity';
      const iconName = isSNMode ? 'cpu' : 'line-chart';
      heading.innerHTML = `<i data-lucide="${iconName}" style="width: 18px; height: 18px; color: var(--accent-blue);"></i> ${metricLabel} Timeline Trend: ${this.escapeHtml(fullTrail)}`;
      if (window.lucide) window.lucide.createIcons({ el: heading });
    }

    if (!container || !records || records.length === 0) {
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (legendContainer) legendContainer.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">No records available to plot timeline graph.</span>';
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let stackProp = 'defectDescription';
    if (selected) {
      if (selected.level === 1) stackProp = 'parentPartNo';
      else if (selected.level === 2) stackProp = 'processRecorded';
      else if (selected.level === 3) stackProp = 'defectDescription';
      else if (selected.level >= 4) stackProp = 'refDes';
    }

    const parsedRecords = [];
    records.forEach(r => {
      if (!r.faDate) return;
      const d = new Date(r.faDate);
      if (isNaN(d.getTime())) return;
      const qty = parseInt(r.defectQuantity, 10) || 1;
      let rawSub = r[stackProp];
      if (!rawSub && stackProp === 'refDes') rawSub = r.defectDescription || 'General';
      const subValue = (rawSub || 'Unspecified').trim();
      const rawSn = (r.serialNo || '').toString().trim().toUpperCase();
      const isValidSn = window.dataStore ? window.dataStore.isValidSerialNo(rawSn) : (rawSn && rawSn !== '-' && rawSn !== 'N/A' && rawSn !== 'UNKNOWN');
      parsedRecords.push({
        date: d,
        qty: qty,
        subName: subValue,
        serialNo: rawSn,
        isValidSn: isValidSn
      });
    });

    if (parsedRecords.length === 0) {
      ctx.clearRect(0, 0, width, height);
      if (legendContainer) legendContainer.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">No dated defect records found in selected category.</span>';
      return;
    }

    parsedRecords.sort((a, b) => a.date - b.date);

    let startD = null;
    let endD = null;

    if (window.dataStore) {
      if (window.dataStore.startDate && window.dataStore.endDate) {
        const sp = window.dataStore.startDate.split('-');
        const ep = window.dataStore.endDate.split('-');
        if (sp.length === 3) startD = new Date(parseInt(sp[0], 10), parseInt(sp[1], 10) - 1, parseInt(sp[2], 10));
        if (ep.length === 3) endD = new Date(parseInt(ep[0], 10), parseInt(ep[1], 10) - 1, parseInt(ep[2], 10));
      }

      if ((!startD || isNaN(startD.getTime()) || !endD || isNaN(endD.getTime())) && window.dataStore.getMinMaxDates) {
        const minMax = window.dataStore.getMinMaxDates();
        if (minMax.minDateStr && minMax.maxDateStr) {
          const sp = minMax.minDateStr.split('-');
          const ep = minMax.maxDateStr.split('-');
          if (sp.length === 3) startD = new Date(parseInt(sp[0], 10), parseInt(sp[1], 10) - 1, parseInt(sp[2], 10));
          if (ep.length === 3) endD = new Date(parseInt(ep[0], 10), parseInt(ep[1], 10) - 1, parseInt(ep[2], 10));
        }
      }
    }

    if (!startD || isNaN(startD.getTime())) {
      startD = new Date(parsedRecords[0].date.getFullYear(), parsedRecords[0].date.getMonth(), parsedRecords[0].date.getDate());
    }
    if (!endD || isNaN(endD.getTime())) {
      endD = new Date(parsedRecords[parsedRecords.length - 1].date.getFullYear(), parsedRecords[parsedRecords.length - 1].date.getMonth(), parsedRecords[parsedRecords.length - 1].date.getDate());
    }

    let mode = this.chartGranularity || 'auto';
    if (mode === 'auto') {
      const timeSpanDays = Math.max(1, (endD.getTime() - startD.getTime()) / (1000 * 3600 * 24));
      if (timeSpanDays <= 31) mode = 'daily';
      else if (timeSpanDays <= 180) mode = 'weekly';
      else mode = 'monthly';
    }

    if (subheading) {
      const stackLabel = stackProp === 'refDes' ? 'Ref Des' : (stackProp === 'defectDescription' ? 'Defect Type' : (stackProp === 'processRecorded' ? 'Process' : 'Part No'));
      if (isSNMode) {
        subheading.textContent = `Unique serial numbers aggregated ${mode} stacked by ${stackLabel} (${parsedRecords.length.toLocaleString()} records parsed)`;
      } else {
        subheading.textContent = `Defect quantity volume aggregated ${mode} stacked by ${stackLabel} (${parsedRecords.length.toLocaleString()} records parsed)`;
      }
    }

    const buckets = {};
    const subCatVolumeMap = {};
    const subCatSnMap = {};
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const initBucket = (key, label, ts) => ({
      key: key,
      dateLabel: label,
      timestamp: ts,
      totalQty: 0,
      subBreakdown: {},
      subBreakdownSN: {},
      snSet: new Set(),
      subSnSets: {}
    });

    // Pre-populate full continuous date intervals across the entire date range (including blank periods)
    if (mode === 'daily') {
      const curr = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate());
      const endLimit = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate());
      while (curr <= endLimit) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const d = String(curr.getDate()).padStart(2, '0');
        const bucketKey = `${y}-${m}-${d}`;
        const dateLabel = `${m}/${d}/${y}`;
        buckets[bucketKey] = initBucket(bucketKey, dateLabel, curr.getTime());
        curr.setDate(curr.getDate() + 1);
      }
    } else if (mode === 'weekly') {
      const day = startD.getDay();
      const diff = startD.getDate() - day + (day === 0 ? -6 : 1);
      const currMon = new Date(startD.getFullYear(), startD.getMonth(), diff);
      const endLimit = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate());
      while (currMon <= endLimit || (currMon.getTime() - endLimit.getTime() < 7 * 86400000)) {
        const my = currMon.getFullYear();
        const mm = String(currMon.getMonth() + 1).padStart(2, '0');
        const md = String(currMon.getDate()).padStart(2, '0');
        const bucketKey = `W_${my}-${mm}-${md}`;
        const dateLabel = `Wk of ${mm}/${md}/${my}`;
        buckets[bucketKey] = initBucket(bucketKey, dateLabel, currMon.getTime());
        currMon.setDate(currMon.getDate() + 7);
        if (currMon > endLimit && Object.keys(buckets).length >= 1) break;
      }
    } else {
      // Monthly mode
      const curr = new Date(startD.getFullYear(), startD.getMonth(), 1);
      const endLimit = new Date(endD.getFullYear(), endD.getMonth(), 1);
      while (curr <= endLimit) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const bucketKey = `${y}-${m}`;
        const dateLabel = `${monthNames[curr.getMonth()]} ${y}`;
        buckets[bucketKey] = initBucket(bucketKey, dateLabel, curr.getTime());
        curr.setMonth(curr.getMonth() + 1);
      }
    }

    // Populate parsed records into the continuous buckets
    parsedRecords.forEach(r => {
      let bucketKey = '';
      const y = r.date.getFullYear();
      const m = String(r.date.getMonth() + 1).padStart(2, '0');
      const d = String(r.date.getDate()).padStart(2, '0');

      if (mode === 'daily') {
        bucketKey = `${y}-${m}-${d}`;
      } else if (mode === 'weekly') {
        const day = r.date.getDay();
        const diff = r.date.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(r.date.getFullYear(), r.date.getMonth(), diff);
        const my = mon.getFullYear();
        const mm = String(mon.getMonth() + 1).padStart(2, '0');
        const md = String(mon.getDate()).padStart(2, '0');
        bucketKey = `W_${my}-${mm}-${md}`;
      } else {
        bucketKey = `${y}-${m}`;
      }

      if (buckets[bucketKey]) {
        const b = buckets[bucketKey];
        const subName = r.subName;
        b.totalQty += r.qty;
        b.subBreakdown[subName] = (b.subBreakdown[subName] || 0) + r.qty;
        subCatVolumeMap[subName] = (subCatVolumeMap[subName] || 0) + r.qty;

        if (r.isValidSn) {
          b.snSet.add(r.serialNo);
          if (!b.subSnSets[subName]) b.subSnSets[subName] = new Set();
          b.subSnSets[subName].add(r.serialNo);

          if (!subCatSnMap[subName]) subCatSnMap[subName] = new Set();
          subCatSnMap[subName].add(r.serialNo);
        }
      }
    });

    // Finalize per-bucket unique SN counts
    Object.values(buckets).forEach(b => {
      b.bucketUniqueSNTotal = b.snSet.size;
      b.totalStackedSN = 0;
      Object.keys(b.subSnSets).forEach(sub => {
        const sz = b.subSnSets[sub].size;
        b.subBreakdownSN[sub] = sz;
        b.totalStackedSN += sz;
      });
    });

    const sortedBuckets = Object.values(buckets).sort((a, b) => a.timestamp - b.timestamp);
    if (sortedBuckets.length === 0) return;

    const activeVolumeMap = isSNMode
      ? Object.keys(subCatSnMap).reduce((acc, k) => { acc[k] = subCatSnMap[k].size; return acc; }, {})
      : subCatVolumeMap;

    const sortedSubCats = Object.keys(activeVolumeMap).sort((a, b) => activeVolumeMap[b] - activeVolumeMap[a]);
    const topSubCats = sortedSubCats.slice(0, 5);
    const otherLabel = stackProp === 'refDes' ? 'Other Ref Des' : 'Other Defect Types';
    if (sortedSubCats.length > 5) topSubCats.push(otherLabel);

    const colorPalette = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#64748b'];
    const catColorMap = {};
    topSubCats.forEach((cat, idx) => {
      catColorMap[cat] = colorPalette[idx % colorPalette.length];
    });

    if (legendContainer) {
      legendContainer.innerHTML = topSubCats.map(cat => {
        let countDisplay = 0;
        if (cat === otherLabel) {
          if (isSNMode) {
            const otherSet = new Set();
            Object.keys(subCatSnMap).forEach(k => {
              if (!topSubCats.includes(k) && k !== otherLabel) {
                subCatSnMap[k].forEach(sn => otherSet.add(sn));
              }
            });
            countDisplay = otherSet.size;
          } else {
            Object.keys(subCatVolumeMap).forEach(k => {
              if (!topSubCats.includes(k) && k !== otherLabel) {
                countDisplay += subCatVolumeMap[k];
              }
            });
          }
        } else {
          countDisplay = activeVolumeMap[cat] || 0;
        }
        const unit = isSNMode ? (countDisplay === 1 ? 'SN' : 'SNs') : (countDisplay === 1 ? 'defect' : 'defects');
        return `
          <div class="chart-legend-item">
            <span class="chart-legend-color" style="background:${catColorMap[cat]};"></span>
            <span>${this.escapeHtml(cat)} (${countDisplay.toLocaleString()} ${unit})</span>
          </div>
        `;
      }).join('');
    }

    const paddingLeft = 45;
    const paddingRight = 25;
    const paddingTop = 15;
    const paddingBottom = 115;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    let maxVal = Math.max(...sortedBuckets.map(b => isSNMode ? (b.totalStackedSN || 0) : b.totalQty), 1);
    const steps = 4;
    maxVal = Math.ceil(maxVal / steps) * steps;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridStroke = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.08)';
    const axisTextFill = isLight ? '#334155' : '#94a3b8';
    const dateLabelFill = isLight ? '#1e293b' : '#cbd5e1';

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = gridStroke;
    ctx.fillStyle = axisTextFill;
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= steps; i++) {
      const val = Math.round((maxVal / steps) * i);
      const yPos = paddingTop + plotHeight - (i / steps) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, yPos);
      ctx.lineTo(width - paddingRight, yPos);
      ctx.stroke();
      ctx.fillText(val.toLocaleString(), paddingLeft - 8, yPos);
    }

    const numBuckets = sortedBuckets.length;
    const slotWidth = plotWidth / numBuckets;
    const barWidth = Math.max(Math.min(slotWidth * 0.65, 36), Math.min(1.5, slotWidth * 0.8));

    this.chartHitboxes = [];

    sortedBuckets.forEach((bucket, bIdx) => {
      const slotLeft = paddingLeft + bIdx * slotWidth;
      const slotRight = slotLeft + slotWidth;
      const xCenter = paddingLeft + (bIdx + 0.5) * slotWidth;
      const xLeft = xCenter - barWidth / 2;
      let currentY = paddingTop + plotHeight;

      topSubCats.forEach(cat => {
        let catVal = 0;
        if (isSNMode) {
          if (cat === otherLabel) {
            Object.keys(bucket.subBreakdownSN).forEach(k => {
              if (!topSubCats.includes(k) && k !== otherLabel) catVal += bucket.subBreakdownSN[k] || 0;
            });
          } else {
            catVal = bucket.subBreakdownSN[cat] || 0;
          }
        } else {
          if (cat === otherLabel) {
            Object.keys(bucket.subBreakdown).forEach(k => {
              if (!topSubCats.includes(k) && k !== otherLabel) catVal += bucket.subBreakdown[k] || 0;
            });
          } else {
            catVal = bucket.subBreakdown[cat] || 0;
          }
        }

        if (catVal > 0) {
          const segHeight = (catVal / maxVal) * plotHeight;
          const segY = currentY - segHeight;
          ctx.fillStyle = catColorMap[cat] || '#3b82f6';
          ctx.fillRect(xLeft, segY, barWidth, segHeight);
          currentY = segY;
        }
      });

      const totalPlotHeight = isSNMode ? (bucket.totalStackedSN || 0) : bucket.totalQty;
      const barTopY = paddingTop + plotHeight - (totalPlotHeight / maxVal) * plotHeight;
      this.chartHitboxes.push({
        slotLeft: slotLeft,
        slotRight: slotRight,
        xLeft: xLeft,
        xRight: xLeft + barWidth,
        xCenter: xCenter,
        yTop: barTopY,
        yBottom: paddingTop + plotHeight,
        bucket: bucket
      });

      const labelInterval = Math.max(1, Math.ceil(numBuckets / 15));
      if (bIdx % labelInterval === 0 || bIdx === numBuckets - 1) {
        ctx.save();
        ctx.translate(xCenter, paddingTop + plotHeight + 10);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = dateLabelFill;
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(bucket.dateLabel, 0, 0);
        ctx.restore();
      }
    });

    this.bindChartHover(container, canvas);
  }

  bindChartHover(container, canvas) {
    const tooltip = document.getElementById('chart-tooltip');
    if (!tooltip || !canvas) return;

    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (!this.chartHitboxes || this.chartHitboxes.length === 0) {
        tooltip.style.display = 'none';
        return;
      }

      // Match the exact slot column corresponding to mouseX
      const hit = this.chartHitboxes.find(hb => mouseX >= hb.slotLeft && mouseX <= hb.slotRight);

      if (hit) {
        const b = hit.bucket;
        const isSN = this.chartMetric === 'uniqueSN';
        const breakdownMap = isSN ? (b.subBreakdownSN || {}) : (b.subBreakdown || {});

        let subDetails = Object.keys(breakdownMap)
          .filter(k => breakdownMap[k] > 0)
          .sort((k1, k2) => breakdownMap[k2] - breakdownMap[k1])
          .slice(0, 5)
          .map(k => {
            const count = breakdownMap[k];
            const suffix = isSN ? ` SN${count !== 1 ? 's' : ''}` : '';
            return `<div style="display:flex; justify-content:space-between; gap:1rem; font-size:0.75rem; margin-top:2px;"><span style="color:#94a3b8;">${this.escapeHtml(k)}:</span> <strong>${count.toLocaleString()}${suffix}</strong></div>`;
          })
          .join('');

        const isZero = isSN ? (b.bucketUniqueSNTotal === 0) : (b.totalQty === 0);
        if (isZero) {
          subDetails = `<div style="font-size:0.72rem; color:var(--text-muted); font-style:italic;">No occurrences recorded</div>`;
        }

        const totalHeader = isSN
          ? `Total Unique SNs: ${b.bucketUniqueSNTotal.toLocaleString()}`
          : `Total Defects: ${b.totalQty.toLocaleString()}`;

        tooltip.innerHTML = `
          <div style="font-weight:600; color:#38bdf8; margin-bottom:4px;">${this.escapeHtml(b.dateLabel)}</div>
          <div style="font-size:0.85rem; font-weight:700; color:#fff; margin-bottom:6px;">${totalHeader}</div>
          ${subDetails}
        `;
        tooltip.style.display = 'block';

        // Position tooltip directly centered over the hovered bar
        let tooltipLeft = hit.xCenter - 110;
        if (tooltipLeft < 10) tooltipLeft = 10;
        if (tooltipLeft + 230 > rect.width) tooltipLeft = rect.width - 235;

        let tooltipTop = hit.yTop - 85;
        if (tooltipTop < 10) {
          tooltipTop = hit.yTop + 25;
        }

        tooltip.style.left = `${Math.round(tooltipLeft)}px`;
        tooltip.style.top = `${Math.round(tooltipTop)}px`;
      } else {
        tooltip.style.display = 'none';
      }
    };

    canvas.onmouseleave = () => {
      if (tooltip) tooltip.style.display = 'none';
    };
  }

  renderParetoChart(records) {
    const canvas = document.getElementById('timeline-chart-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('chart-canvas-wrapper');
    const legendContainer = document.getElementById('chart-legend-container');
    const heading = document.getElementById('chart-heading');
    const subheading = document.getElementById('chart-subheading');

    const isSNMode = this.chartMetric === 'uniqueSN';
    const btnDefects = document.getElementById('chart-metric-btn-defects');
    const btnSN = document.getElementById('chart-metric-btn-uniquesn');
    if (btnDefects) btnDefects.classList.toggle('active', !isSNMode);
    if (btnSN) btnSN.classList.toggle('active', isSNMode);

    const dim = this.paretoGrouping || 'defectDescription';
    const dimNames = {
      'defectDescription': 'Defect Description',
      'refDes': 'Reference Designator (Ref Des)',
      'processRecorded': 'Manufacturing Process',
      'parentPartNo': 'Parent Part Number'
    };
    const dimLabel = dimNames[dim] || 'Defect Description';

    const selected = window.dataStore ? window.dataStore.selectedNode : null;
    const maximal = window.dataStore ? window.dataStore.maximalSelectedNodes : [];
    if (heading) {
      let trail = [];
      if (maximal && maximal.length > 1) {
        const names = maximal.map(n => n.name);
        trail.push(`Multi-Selection (${maximal.length} items: ${names.slice(0, 3).join(', ')}${maximal.length > 3 ? '...' : ''})`);
      } else if (!selected) {
        trail.push('All Defect Data (All Customers & Programs)');
      } else {
        const { level, customer, parentPartNo, processRecorded, defectDescription, refDes } = selected;
        if (customer) trail.push(`Customer: ${customer}`);
        if (level >= 2 && parentPartNo) trail.push(`Part: ${parentPartNo}`);
        if (level >= 3 && processRecorded) trail.push(`Process: ${processRecorded}`);
        if (level >= 4 && defectDescription) trail.push(`Defect: ${defectDescription}`);
        if (level >= 5 && refDes) trail.push(`Ref Des: ${refDes}`);
      }
      if (window.dataStore && window.dataStore.searchQuery) {
        trail.push(`[Search: "${window.dataStore.searchQuery}"]`);
      }
      const fullTrail = trail.join(' ➔ ');
      heading.innerHTML = `<i data-lucide="bar-chart-2" style="width: 18px; height: 18px; color: var(--accent-blue);"></i> Pareto 80/20 Analysis (${dimLabel}): ${this.escapeHtml(fullTrail)}`;
      if (window.lucide) window.lucide.createIcons({ el: heading });
    }

    if (!container || !records || records.length === 0) {
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (legendContainer) legendContainer.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">No records available to perform Pareto analysis.</span>';
      return;
    }

    // Canvas scaling
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Aggregate records by dimension
    const catCounts = {};
    const catSnSets = {};

    records.forEach(r => {
      let val = r[dim];
      if (!val || !val.toString().trim()) {
        val = (dim === 'refDes' ? '[Unassigned Ref Des]' : 'Unspecified');
      }
      val = val.toString().trim();
      const qty = parseInt(r.defectQuantity, 10) || 1;
      const rawSn = (r.serialNo || '').toString().trim().toUpperCase();
      const isValidSn = window.dataStore ? window.dataStore.isValidSerialNo(rawSn) : (rawSn && rawSn !== '-' && rawSn !== 'N/A' && rawSn !== 'UNKNOWN');

      if (!catCounts[val]) {
        catCounts[val] = 0;
        catSnSets[val] = new Set();
      }
      catCounts[val] += qty;
      if (isValidSn) {
        catSnSets[val].add(rawSn);
      }
    });

    const categories = Object.keys(catCounts).map(name => {
      const count = isSNMode ? catSnSets[name].size : catCounts[name];
      return {
        name: name,
        count: count,
        snCount: catSnSets[name].size,
        qty: catCounts[name]
      };
    }).filter(c => c.count > 0);

    if (categories.length === 0) {
      ctx.clearRect(0, 0, width, height);
      if (legendContainer) legendContainer.innerHTML = '<span style="font-size:0.8rem; color:var(--text-muted);">No valid metric data to calculate Pareto chart.</span>';
      return;
    }

    // Sort descending by count
    categories.sort((a, b) => b.count - a.count);

    const totalOverallMetric = categories.reduce((sum, c) => sum + c.count, 0);

    // Slice top categories to keep chart readable (top 15)
    const MAX_PARETO_BARS = 15;
    let displayCategories = categories.slice(0, MAX_PARETO_BARS);
    if (categories.length > MAX_PARETO_BARS) {
      const otherItems = categories.slice(MAX_PARETO_BARS);
      const otherCount = otherItems.reduce((sum, c) => sum + c.count, 0);
      displayCategories.push({
        name: `Other (${otherItems.length} categories)`,
        count: otherCount,
        snCount: otherCount,
        qty: otherCount,
        isOther: true
      });
    }

    // Compute cumulative percentages
    let runningSum = 0;
    let vitalFewCount = 0;
    displayCategories.forEach((cat, idx) => {
      runningSum += cat.count;
      cat.cumPct = totalOverallMetric > 0 ? (runningSum / totalOverallMetric) * 100 : 0;
      cat.pctOfTotal = totalOverallMetric > 0 ? (cat.count / totalOverallMetric) * 100 : 0;
      if (cat.cumPct <= 80 || (vitalFewCount === 0 && cat.cumPct > 80)) {
        vitalFewCount++;
      } else if (vitalFewCount === idx && cat.cumPct <= 85) {
        vitalFewCount++;
      }
    });

    if (subheading) {
      const metricLabel = isSNMode ? 'unique serial numbers' : 'defect quantity';
      subheading.textContent = `80/20 Pareto distribution of ${totalOverallMetric.toLocaleString()} ${metricLabel} grouped by ${dimLabel} (${categories.length} total categories)`;
    }

    // Measure label widths to ensure BOTH paddingBottom and paddingLeft dynamically prevent any clipping
    ctx.font = '13px Inter, sans-serif';
    let maxLabelWidth = 0;
    const numCats = displayCategories.length;

    displayCategories.forEach(cat => {
      let l = cat.name;
      if (l.length > 40) l = l.slice(0, 38) + '...';
      const w = ctx.measureText(l).width;
      if (w > maxLabelWidth) maxLabelWidth = w;
    });

    const firstCat = displayCategories[0];
    let firstLabel = firstCat ? firstCat.name : '';
    if (firstLabel.length > 40) firstLabel = firstLabel.slice(0, 38) + '...';
    const firstLabelWidth = ctx.measureText(firstLabel).width;

    const rotationAngle = -Math.PI / 2.8; // ~-64.3° provides steep vertical orientation for long defect names
    const cosA = Math.cos(Math.abs(rotationAngle));
    const sinA = Math.sin(Math.abs(rotationAngle));

    // Dynamic paddingLeft ensures leftmost text of first bar never clips off the left screen edge (x >= 15px)
    const estimatedSlotWidth = (width - 120) / Math.max(1, numCats);
    const neededLeft = Math.ceil(firstLabelWidth * cosA - 0.5 * estimatedSlotWidth + 24);
    const paddingLeft = Math.max(72, Math.min(145, neededLeft));

    const paddingRight = 60;
    const paddingTop = 32;
    const labelDrop = Math.ceil(maxLabelWidth * sinA) + 38;
    const paddingBottom = Math.max(155, Math.min(250, labelDrop));

    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridStroke = isLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.08)';
    const axisTextFill = isLight ? '#334155' : '#94a3b8';
    const barCountFill = isLight ? '#0f172a' : '#cbd5e1';
    const cutoffColor = isLight ? '#be123c' : '#f43f5e';
    const curveStroke = isLight ? '#b45309' : '#f59e0b';
    const pointTextFill = isLight ? '#78350f' : '#fbbf24';
    const dotBorder = isLight ? '#ffffff' : '#0f172a';

    ctx.clearRect(0, 0, width, height);

    // Left Y-axis (Frequency)
    let maxVal = Math.max(...displayCategories.map(c => c.count), 1);
    const steps = 4;
    maxVal = Math.ceil(maxVal / steps) * steps;

    // Grid lines & Axis labels
    ctx.strokeStyle = gridStroke;
    ctx.fillStyle = axisTextFill;
    ctx.font = '12px Inter, sans-serif';

    // Left axis tick values (counts) & Right axis tick values (percentages 0..100%)
    for (let i = 0; i <= steps; i++) {
      const yPos = paddingTop + plotHeight - (i / steps) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, yPos);
      ctx.lineTo(width - paddingRight, yPos);
      ctx.stroke();

      // Left axis label (Frequency)
      const val = Math.round((maxVal / steps) * i);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(val.toLocaleString(), paddingLeft - 10, yPos);

      // Right axis label (Cumulative %)
      const pctVal = Math.round((100 / steps) * i);
      ctx.textAlign = 'left';
      ctx.fillText(`${pctVal}%`, width - paddingRight + 10, yPos);
    }

    // 80% Threshold Line (Red/Pink dashed line)
    const y80 = paddingTop + plotHeight - (80 / 100) * plotHeight;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = cutoffColor;
    ctx.lineWidth = 1.8;
    ctx.moveTo(paddingLeft, y80);
    ctx.lineTo(width - paddingRight, y80);
    ctx.stroke();

    // 80% Cutoff Label
    ctx.fillStyle = cutoffColor;
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('80% Pareto Cutoff', width - paddingRight - 10, y80 - 4);
    ctx.restore();

    // Render Bars
    const slotWidth = plotWidth / (numCats || 1);
    const barWidth = Math.max(Math.min(slotWidth * 0.62, 48), 6);
    this.chartHitboxes = [];
    const curvePoints = [];

    displayCategories.forEach((cat, idx) => {
      const slotLeft = paddingLeft + idx * slotWidth;
      const slotRight = slotLeft + slotWidth;
      const xCenter = paddingLeft + (idx + 0.5) * slotWidth;
      const xLeft = xCenter - barWidth / 2;
      const barHeight = (cat.count / maxVal) * plotHeight;
      const barY = paddingTop + plotHeight - barHeight;

      // Modern rounded gradient bar
      const grad = ctx.createLinearGradient(0, barY, 0, paddingTop + plotHeight);
      if (idx < vitalFewCount && !cat.isOther) {
        grad.addColorStop(0, isLight ? '#0284c7' : '#38bdf8');
        grad.addColorStop(1, isLight ? 'rgba(3, 105, 161, 0.85)' : 'rgba(2, 132, 199, 0.65)');
      } else {
        grad.addColorStop(0, isLight ? '#64748b' : '#64748b');
        grad.addColorStop(1, isLight ? 'rgba(71, 85, 105, 0.85)' : 'rgba(51, 65, 85, 0.65)');
      }
      ctx.fillStyle = grad;

      // Rounded top rectangle
      const radius = Math.min(4, barWidth / 2);
      ctx.beginPath();
      ctx.moveTo(xLeft, paddingTop + plotHeight);
      ctx.lineTo(xLeft, barY + radius);
      ctx.quadraticCurveTo(xLeft, barY, xLeft + radius, barY);
      ctx.lineTo(xLeft + barWidth - radius, barY);
      ctx.quadraticCurveTo(xLeft + barWidth, barY, xLeft + barWidth, barY + radius);
      ctx.lineTo(xLeft + barWidth, paddingTop + plotHeight);
      ctx.closePath();
      ctx.fill();

      // Border outline
      ctx.strokeStyle = idx < vitalFewCount && !cat.isOther 
        ? (isLight ? 'rgba(2, 132, 199, 0.9)' : 'rgba(56, 189, 248, 0.8)') 
        : (isLight ? 'rgba(100, 116, 139, 0.6)' : 'rgba(148, 163, 184, 0.4)');
      ctx.lineWidth = 1;
      ctx.stroke();

      // Frequency number above bar
      ctx.fillStyle = barCountFill;
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(cat.count.toLocaleString(), xCenter, barY - 4);

      // Cumulative point coordinate
      const pointY = paddingTop + plotHeight - (cat.cumPct / 100) * plotHeight;
      curvePoints.push({ x: xCenter, y: pointY, cat: cat });

      // Hitbox for hover
      this.chartHitboxes.push({
        slotLeft: slotLeft,
        slotRight: slotRight,
        xLeft: xLeft,
        xRight: xLeft + barWidth,
        xCenter: xCenter,
        yTop: Math.min(barY, pointY),
        yBottom: paddingTop + plotHeight,
        paretoCat: cat,
        pointY: pointY
      });

      // Bottom Category Label (Rotated)
      ctx.save();
      ctx.translate(xCenter, paddingTop + plotHeight + 14);
      ctx.rotate(rotationAngle);
      ctx.fillStyle = idx < vitalFewCount && !cat.isOther 
        ? (isLight ? '#0369a1' : '#38bdf8') 
        : (isLight ? '#1e293b' : '#cbd5e1');
      ctx.font = idx < vitalFewCount && !cat.isOther ? 'bold 13px Inter, sans-serif' : '13px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      let label = cat.name;
      if (label.length > 40) label = label.slice(0, 38) + '...';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    });

    // Draw Cumulative % Curve
    if (curvePoints.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.strokeStyle = curveStroke;
      ctx.lineWidth = 2.5;
      curvePoints.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      // Draw points & percentage text
      curvePoints.forEach(pt => {
        // Outer glow/dot
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = curveStroke;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = dotBorder;
        ctx.stroke();

        // Inner white dot
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Label above point
        ctx.fillStyle = pointTextFill;
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${pt.cat.cumPct.toFixed(1)}%`, pt.x, pt.y - 7);
      });
      ctx.restore();
    }

    // Legend / Summary in legendContainer
    if (legendContainer) {
      const topVitalFew = displayCategories.slice(0, vitalFewCount).filter(c => !c.isOther);
      const vitalSum = topVitalFew.reduce((s, c) => s + c.count, 0);
      const vitalPct = totalOverallMetric > 0 ? ((vitalSum / totalOverallMetric) * 100).toFixed(1) : 0;
      const metricUnit = isSNMode ? 'Unique SNs' : 'Defect Qty';

      legendContainer.innerHTML = `
        <div class="pareto-vital-few-badge" title="80/20 Pareto Principle: The vital few causes generate the vast majority of defect fallout">
          <i data-lucide="zap" style="width: 14px; height: 14px;"></i>
          <span><strong>Vital Few:</strong> Top ${topVitalFew.length} of ${categories.length} categories generate <strong>${vitalPct}%</strong> of total fallout (${vitalSum.toLocaleString()} ${metricUnit})</span>
        </div>
        <div class="chart-legend-item">
          <span class="chart-legend-color" style="background:#38bdf8;"></span>
          <span>Vital Few (${dimLabel})</span>
        </div>
        <div class="chart-legend-item">
          <span class="chart-legend-color" style="background:#64748b;"></span>
          <span>Trivial Many / Other</span>
        </div>
        <div class="chart-legend-item">
          <span class="chart-legend-color" style="background:#f59e0b; height: 3px; border-radius: 1px;"></span>
          <span>Cumulative % Curve</span>
        </div>
        <div class="pareto-threshold-legend">
          <span>--- 80% Threshold</span>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ el: legendContainer });
    }

    this.bindParetoHover(container, canvas);
  }

  bindParetoHover(container, canvas) {
    const tooltip = document.getElementById('chart-tooltip');
    if (!tooltip || !canvas) return;

    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (!this.chartHitboxes || this.chartHitboxes.length === 0) {
        tooltip.style.display = 'none';
        return;
      }

      const hit = this.chartHitboxes.find(hb => mouseX >= hb.slotLeft && mouseX <= hb.slotRight);

      if (hit && hit.paretoCat) {
        const cat = hit.paretoCat;
        const isSN = this.chartMetric === 'uniqueSN';
        const metricName = isSN ? 'Unique SNs' : 'Defect Occurrences';

        tooltip.innerHTML = `
          <div style="font-weight:700; color:#38bdf8; margin-bottom:4px; font-size:0.85rem;">${this.escapeHtml(cat.name)}</div>
          <div style="font-size:0.78rem; color:#f8fafc; margin-bottom:3px;"><strong>${metricName}:</strong> ${cat.count.toLocaleString()}</div>
          <div style="font-size:0.78rem; color:#94a3b8; margin-bottom:3px;"><strong>Percent of Total:</strong> ${cat.pctOfTotal.toFixed(1)}%</div>
          <div style="font-size:0.78rem; color:#fbbf24;"><strong>Cumulative Percent:</strong> ${cat.cumPct.toFixed(1)}%</div>
        `;
        tooltip.style.display = 'block';

        let tooltipLeft = hit.xCenter - 110;
        if (tooltipLeft < 10) tooltipLeft = 10;
        if (tooltipLeft + 230 > rect.width) tooltipLeft = rect.width - 235;

        let tooltipTop = hit.pointY - 95;
        if (tooltipTop < 10) {
          tooltipTop = hit.pointY + 25;
        }

        tooltip.style.left = `${Math.round(tooltipLeft)}px`;
        tooltip.style.top = `${Math.round(tooltipTop)}px`;
      } else {
        tooltip.style.display = 'none';
      }
    };

    canvas.onmouseleave = () => {
      if (tooltip) tooltip.style.display = 'none';
    };
  }

  generateExportCanvas() {
    const mainCanvas = document.getElementById('timeline-chart-canvas');
    if (!mainCanvas) return null;

    const exportCanvas = document.createElement('canvas');
    const width = 1600;
    const height = 960;
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isDark = currentTheme === 'dark';

    // Background
    ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Header border / brand accent
    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, '#0284c7');
    grad.addColorStop(0.5, '#38bdf8');
    grad.addColorStop(1, '#818cf8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, 5);

    // Title & Context
    ctx.fillStyle = isDark ? '#ffffff' : '#0f172a';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleText = this.chartViewMode === 'pareto' 
      ? 'Benchmark Electronics - Defect Pareto 80/20 Analysis' 
      : 'Benchmark Electronics - Defect Timeline Trend Analysis';
    ctx.fillText(titleText, 40, 24);

    // Subtitle & Breadcrumbs
    ctx.fillStyle = isDark ? '#94a3b8' : '#64748b';
    ctx.font = '14px Inter, sans-serif';
    let trail = 'All Customers & Programs';
    const maximal = window.dataStore ? window.dataStore.maximalSelectedNodes : [];
    if (maximal && maximal.length > 1) {
      const names = maximal.map(n => n.name);
      trail = `Multi-Selection (${maximal.length} items: ${names.slice(0, 3).join(', ')}${maximal.length > 3 ? '...' : ''})`;
    } else {
      const selected = window.dataStore ? window.dataStore.selectedNode : null;
      if (selected) {
        const parts = [];
        if (selected.customer) parts.push(`Customer: ${selected.customer}`);
        if (selected.level >= 2 && selected.parentPartNo) parts.push(`Part: ${selected.parentPartNo}`);
        if (selected.level >= 3 && selected.processRecorded) parts.push(`Process: ${selected.processRecorded}`);
        if (selected.level >= 4 && selected.defectDescription) parts.push(`Defect: ${selected.defectDescription}`);
        if (selected.level >= 5 && selected.refDes) parts.push(`Ref Des: ${selected.refDes}`);
        trail = parts.join(' ➔ ');
      }
    }
    const metricLabel = this.chartMetric === 'uniqueSN' ? 'Metric: Unique Board SNs' : 'Metric: Defect Quantity';
    const dateRange = (window.dataStore && window.dataStore.startDate && window.dataStore.endDate) 
      ? `Date Range: ${window.dataStore.startDate} to ${window.dataStore.endDate}` 
      : 'Date Range: All Time';
    ctx.fillText(`${trail}  |  ${metricLabel}  |  ${dateRange}`, 40, 58);

    // Timestamp
    ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'right';
    const nowStr = new Date().toLocaleString();
    ctx.fillText(`Generated: ${nowStr}`, width - 40, 32);

    // Draw main chart
    const chartX = 40;
    const chartY = 95;
    const chartW = width - 80;
    const chartH = height - 125;

    // Draw border around chart area
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(chartX, chartY, chartW, chartH);

    ctx.drawImage(mainCanvas, chartX, chartY, chartW, chartH);

    return exportCanvas;
  }

  exportChartPNG() {
    const exportCanvas = this.generateExportCanvas();
    if (!exportCanvas) return;

    const mode = this.chartViewMode || 'chart';
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Defect_${mode.toUpperCase()}_Analysis_${dateStr}.png`;

    exportCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showToast(`📊 Exported ${filename}`);
    }, 'image/png');
  }

  async copyChartClipboard() {
    const exportCanvas = this.generateExportCanvas();
    if (!exportCanvas) return;

    if (!navigator.clipboard || !navigator.clipboard.write) {
      this.showToast('⚠️ Clipboard image write not supported in this browser. Please use Download PNG.');
      return;
    }

    try {
      exportCanvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          this.showToast('📋 Chart image copied to clipboard! (Ready to paste into PowerPoint, Word, or Teams)');
        } catch (err) {
          console.warn('Clipboard write failed:', err);
          this.showToast('⚠️ Could not copy image to clipboard. Downloading PNG instead.');
          this.exportChartPNG();
        }
      }, 'image/png');
    } catch (e) {
      this.exportChartPNG();
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.mainPanel = new MainPanel();
  });
} else {
  window.mainPanel = new MainPanel();
}
