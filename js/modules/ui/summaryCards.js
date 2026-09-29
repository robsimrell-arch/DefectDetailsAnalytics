/**
 * SummaryCards - KPI metric cards, workspace record counters, solution pills, and breadcrumbs.
 */
class SummaryCards {
  constructor(mainPanel) {
    this.mp = mainPanel;
    this.kpiSyncState = 'idle';
    this._cachedGlobalRawLength = -1;
    this._cachedGlobalUniqueSNs = 0;
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

  safeParam(str) {
    return encodeURIComponent(str || '').replace(/'/g, '%27');
  }

  getLevelPrefix(level) {
    if (level === 1) return 'CUSTOMER:';
    if (level === 2) return 'PART:';
    if (level === 3) return 'PROCESS:';
    if (level === 4) return 'DEFECT:';
    if (level === 5) return 'REF DES:';
    return 'ITEM:';
  }

  getFixStatusBadgeClass(status) {
    const s = (status || 'Pending').toLowerCase().trim();
    if (s === 'yes') return 'yes';
    if (s === 'no') return 'no';
    if (s === 'false fail') return 'false-fail';
    if (s === 'possible false fail') return 'possible-false-fail';
    return 'pending';
  }

  renderBreadcrumbs(selected) {
    const container = document.getElementById('breadcrumb-bar');
    if (!container) return;

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

      container.innerHTML = `
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
      if (window.lucide) window.lucide.createIcons({ el: container });
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

    container.innerHTML = `<div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">${trail.join('')}</div>`;
    if (window.lucide) window.lucide.createIcons({ el: container });
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

    const allRaw = window.dataStore ? (window.dataStore.rawRecords || []) : [];
    const globalTotal = allRaw.length;
    const selectedTotal = records ? records.length : 0;
    const hasTreeSelection = (window.dataStore && window.dataStore.maximalSelectedNodes && window.dataStore.maximalSelectedNodes.length > 0) || (window.dataStore && !!window.dataStore.selectedNode);
    const isFiltered = !!(hasTreeSelection || (window.dataStore && (window.dataStore.searchQuery || window.dataStore.fixFilter !== 'all' || window.dataStore.datePreset !== 'all')));

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
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.SummaryCards = SummaryCards;
