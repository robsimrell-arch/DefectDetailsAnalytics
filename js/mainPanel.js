/**
 * MainPanel Component - Main Presentation Layer Facade.
 * Coordinates between SummaryCards, RecordsTable, ChartRenderer, and AnnotationModal.
 * Maintains full backwards compatibility with all HTML inline event handlers and window.mainPanel consumers.
 */
class MainPanel {
  constructor() {
    this.tableFilter = '';
    this.currentPage = 1;
    this.pageSize = 50;
    this.activeTab = 'pareto'; // Default active tab on load: 'pareto'
    this.sortColumn = 'faDate'; // Active sorting column
    this.sortDirection = 'desc'; // Active sorting direction: 'asc' | 'desc'
    this.currentRecords = [];
    this.currentPaginatedRecords = [];

    // Timeline Chart Metric Mode
    let savedTimelineMetric = 'defects';
    try {
      savedTimelineMetric = localStorage.getItem('DEFECT_APP_TIMELINE_METRIC') || localStorage.getItem('DEFECT_APP_CHART_METRIC') || 'defects';
    } catch (e) {}
    this.timelineMetric = savedTimelineMetric === 'uniqueSN' ? 'uniqueSN' : 'defects';

    // Pareto Chart Metric Mode
    let savedParetoMetric = 'uniqueSN';
    try {
      savedParetoMetric = localStorage.getItem('DEFECT_APP_PARETO_METRIC') || 'uniqueSN';
    } catch (e) {}
    this.paretoMetric = savedParetoMetric === 'defects' ? 'defects' : 'uniqueSN';

    this.chartGranularity = 'auto';
    this.paretoGrouping = 'defectDescription';

    // Sub-modules
    this.summaryCards = window.DefectApp && window.DefectApp.SummaryCards 
      ? new window.DefectApp.SummaryCards(this) 
      : new SummaryCards(this);

    this.chartRenderer = window.DefectApp && window.DefectApp.ChartRenderer
      ? new window.DefectApp.ChartRenderer(this)
      : new ChartRenderer(this);

    this.recordsTable = window.DefectApp && window.DefectApp.RecordsTable
      ? new window.DefectApp.RecordsTable(this)
      : new RecordsTable(this);

    this.annotationModal = window.DefectApp && window.DefectApp.AnnotationModal
      ? new window.DefectApp.AnnotationModal(this)
      : new AnnotationModal(this);

    if (window.dataStore) {
      window.dataStore.subscribe(() => this.render());
    }
    setTimeout(() => this.bindEventListeners(), 0);
    this.render();
  }

  // DOM element getters
  get breadcrumbContainer() { return document.getElementById('breadcrumb-bar'); }
  get headerTotalContainer() { return document.getElementById('workspace-records-counter'); }
  get statsContainer() { return document.getElementById('workspace-records-counter'); }
  get commentsContainer() { return document.getElementById('comments-feed'); }
  get commentsTitle() { return document.getElementById('comments-title'); }
  get tableBody() { return document.getElementById('table-body'); }
  get tableSearchInput() { return document.getElementById('table-search'); }
  get tableSearchClear() { return document.getElementById('table-search-clear'); }

  // Backward-compatible properties
  get chartMetric() { return this.activeTab === 'pareto' ? this.paretoMetric : this.timelineMetric; }
  set chartMetric(val) { this.chartRenderer.setChartMetric(val); }
  get chartViewMode() { return this.activeTab === 'pareto' ? 'pareto' : 'timeline'; }
  set chartViewMode(val) { if (val === 'pareto' || val === 'timeline') this.switchTab(val); }
  get kpiSyncState() { return this.summaryCards.kpiSyncState; }
  set kpiSyncState(val) { this.summaryCards.kpiSyncState = val; }
  get chartHitboxes() { return this.chartRenderer.chartHitboxes; }
  set chartHitboxes(val) { this.chartRenderer.chartHitboxes = val; }

  // Utility delegators
  safeParam(str) { return this.recordsTable.safeParam(str); }
  escapeHtml(str) { return this.recordsTable.escapeHtml(str); }
  highlightText(str, extraQuery) { return this.recordsTable.highlightText(str, extraQuery); }
  parseDate(dateStr) { return this.recordsTable.parseDate(dateStr); }
  getFixStatusBadgeClass(status) { return this.summaryCards.getFixStatusBadgeClass(status); }
  getLevelPrefix(level) { return this.summaryCards.getLevelPrefix(level); }

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

  switchTab(tabName) {
    if (tabName === 'chart') tabName = 'timeline';
    if (tabName !== 'comments' && tabName !== 'records' && tabName !== 'timeline' && tabName !== 'pareto') return;
    this.activeTab = tabName;

    const btnComments = document.getElementById('tab-btn-comments');
    const btnRecords = document.getElementById('tab-btn-records');
    const btnTimeline = document.getElementById('tab-btn-timeline');
    const btnPareto = document.getElementById('tab-btn-pareto');

    const contentComments = document.getElementById('tab-content-comments');
    const contentRecords = document.getElementById('tab-content-records');
    const contentTimeline = document.getElementById('tab-content-timeline');
    const contentPareto = document.getElementById('tab-content-pareto');

    if (btnComments) btnComments.classList.toggle('active', tabName === 'comments');
    if (btnRecords) btnRecords.classList.toggle('active', tabName === 'records');
    if (btnTimeline) btnTimeline.classList.toggle('active', tabName === 'timeline');
    if (btnPareto) btnPareto.classList.toggle('active', tabName === 'pareto');

    if (contentComments) contentComments.classList.toggle('active', tabName === 'comments');
    if (contentRecords) contentRecords.classList.toggle('active', tabName === 'records');
    if (contentTimeline) contentTimeline.classList.toggle('active', tabName === 'timeline');
    if (contentPareto) contentPareto.classList.toggle('active', tabName === 'pareto');

    const records = window.dataStore ? window.dataStore.getActiveRecords() : [];
    if (tabName === 'timeline') {
      this.renderTimelineChart(records);
    } else if (tabName === 'pareto') {
      this.renderParetoChart(records);
    }
    
    if (window.lucide) window.lucide.createIcons();
    this.render();
  }

  render() {
    const selected = window.dataStore ? window.dataStore.selectedNode : null;
    const records = window.dataStore ? window.dataStore.getActiveRecords() : [];

    this.renderBreadcrumbs(selected);
    this.renderStats(records);
    this.renderSolutionPills();

    const active = document.activeElement;
    if (active && (
      active.classList.contains('fix-comment-textarea') || 
      active.classList.contains('table-inline-input')
    )) {
      return;
    }

    this.renderComments(selected, records);
    this.renderTable(records);
    if (this.activeTab === 'timeline' || this.activeTab === 'chart') {
      this.renderTimelineChart(records);
    } else if (this.activeTab === 'pareto') {
      this.renderParetoChart(records);
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
    if (window.dataStore && window.dataStore.fixFilter === status) {
      window.dataStore.setFixFilter('all');
      this.sortColumn = 'faDate';
      this.sortDirection = 'desc';
    } else if (window.dataStore) {
      window.dataStore.setFixFilter(status);
      this.sortColumn = 'confirmedAt';
      this.sortDirection = 'desc';
    }
  }

  // SummaryCards delegation
  renderBreadcrumbs(selected) { this.summaryCards.renderBreadcrumbs(selected); }
  renderSolutionPills() { this.summaryCards.renderSolutionPills(); }
  renderSolutionPillsHtml() { return this.summaryCards.renderSolutionPillsHtml(); }
  renderStats(records) { this.summaryCards.renderStats(records); }
  updateKpiSyncState(state) { this.summaryCards.updateKpiSyncState(state); }
  countUniqueSerialNumbers(recordList) { return this.summaryCards.countUniqueSerialNumbers(recordList); }
  formatConfirmedDate(status, timestamp) { return this.summaryCards.formatConfirmedDate(status, timestamp); }

  // RecordsTable delegation
  handleSort(column) { this.recordsTable.handleSort(column); }
  sortData(records) { return this.recordsTable.sortData(records); }
  updateTableHeaderSortUI() { this.recordsTable.updateTableHeaderSortUI(); }
  renderTable(records) { this.recordsTable.renderTable(records); }
  renderTableOnly() { this.recordsTable.renderTableOnly(); }
  setPageSize(size) { this.recordsTable.setPageSize(size); }
  goToPage(page) { this.recordsTable.goToPage(page); }
  renderPaginationControls(totalRecords) { this.recordsTable.renderPaginationControls(totalRecords); }
  exportCSV() {
    const records = (this.currentRecords || (window.dataStore ? window.dataStore.getActiveRecords() : [])).slice();
    records.sort((a, b) => this.parseDate(b.faDate) - this.parseDate(a.faDate));
    if (window.DefectApp && window.DefectApp.ExportService) {
      window.DefectApp.ExportService.exportCSV(records);
    } else {
      ExportService.exportCSV(records);
    }
    this.showToast(`📊 Exported ${records.length.toLocaleString()} records to CSV`);
  }

  // ChartRenderer delegation
  setTimelineMetric(metric) { this.chartRenderer.setTimelineMetric(metric); }
  setParetoMetric(metric) { this.chartRenderer.setParetoMetric(metric); }
  setChartMetric(metric) { this.chartRenderer.setChartMetric(metric); }
  setParetoGrouping(dimension) { this.chartRenderer.setParetoGrouping(dimension); }
  setChartGranularity(mode) { this.chartRenderer.setChartGranularity(mode); }
  renderTimelineChart(records) { this.chartRenderer.renderTimelineChart(records); }
  renderParetoChart(records) { this.chartRenderer.renderParetoChart(records); }
  renderChart(records) {
    if (this.activeTab === 'pareto') {
      this.renderParetoChart(records);
    } else {
      this.renderTimelineChart(records);
    }
  }
  generateExportCanvas(requestedMode) { return this.chartRenderer.generateExportCanvas(requestedMode); }
  exportChartPNG(requestedMode) { this.chartRenderer.exportChartPNG(requestedMode); }
  async copyChartClipboard(requestedMode) { return this.chartRenderer.copyChartClipboard(requestedMode); }

  // AnnotationModal delegation
  renderComments(selected, records) { this.annotationModal.renderComments(selected, records); }
  openRecordCommentsModal(rec) { this.annotationModal.openRecordCommentsModal(rec); }
  openRecordCommentsModalByIndex(index) { this.annotationModal.openRecordCommentsModalByIndex(index); }
  closeRecordCommentsModal(event) { this.annotationModal.closeRecordCommentsModal(event); }
  handleEncodedFixStatusChange(encSerialNo, encFaDate, encRefDes, encDefectDesc, newStatus, selectEl = null) {
    this.annotationModal.handleEncodedFixStatusChange(encSerialNo, encFaDate, encRefDes, encDefectDesc, newStatus, selectEl);
  }
  handleEncodedFixCommentInput(encSerialNo, encFaDate, encRefDes, encDefectDesc, newComment) {
    this.annotationModal.handleEncodedFixCommentInput(encSerialNo, encFaDate, encRefDes, encDefectDesc, newComment);
  }
  handleEncodedFixCommentChange(encSerialNo, encFaDate, encRefDes, encDefectDesc, newComment) {
    this.annotationModal.handleEncodedFixCommentChange(encSerialNo, encFaDate, encRefDes, encDefectDesc, newComment);
  }
  handleFixStatusChange(serialNo, faDate, refDes, defectDescription, newStatus, selectEl = null) {
    this.annotationModal.handleFixStatusChange(serialNo, faDate, refDes, defectDescription, newStatus, selectEl);
  }
  handleFixCommentChange(serialNo, faDate, refDes, defectDescription, newComment, isDebounced = false) {
    this.annotationModal.handleFixCommentChange(serialNo, faDate, refDes, defectDescription, newComment, isDebounced);
  }
  openServerSettingsModal() { this.annotationModal.openServerSettingsModal(); }
  closeServerSettingsModal(event) { this.annotationModal.closeServerSettingsModal(event); }
  async saveServerSettings() { return this.annotationModal.saveServerSettings(); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.mainPanel = new MainPanel();
  });
} else {
  window.mainPanel = new MainPanel();
}
