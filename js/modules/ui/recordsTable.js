/**
 * RecordsTable - Data table rendering, pagination controls, column sorting, and search query highlighting.
 */
class RecordsTable {
  constructor(mainPanel) {
    this.mp = mainPanel;
    this._cachedHighlightKey = null;
    this._cachedHighlightRegex = null;
  }

  escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/&lt;/g, '&lt;')
      .replace(/&gt;/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  safeParam(str) {
    return encodeURIComponent(str || '').replace(/'/g, '%27');
  }

  parseDate(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  getHighlightRegex(extraQuery) {
    const mainQ = (window.dataStore && window.dataStore.searchQuery) ? window.dataStore.searchQuery.trim() : '';
    const extraQ = (extraQuery !== undefined ? extraQuery : (this.mp.tableFilter || '')).trim();
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

  handleSort(column) {
    if (this.mp.sortColumn === column) {
      this.mp.sortDirection = this.mp.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.mp.sortColumn = column;
      this.mp.sortDirection = (column === 'faDate' || column === 'defectQuantity' || column === 'qty') ? 'desc' : 'asc';
    }
    this.mp.currentPage = 1;
    this.renderTableOnly();
  }

  sortData(records) {
    if (!this.mp.sortColumn || !Array.isArray(records)) return records;

    const col = this.mp.sortColumn;
    const dir = this.mp.sortDirection === 'desc' ? -1 : 1;

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

      if (colKey === this.mp.sortColumn) {
        th.classList.add('active-sort');
        if (iconSpan) {
          iconSpan.innerHTML = this.mp.sortDirection === 'asc' ? '▲' : '▼';
        }
      } else {
        th.classList.remove('active-sort');
        if (iconSpan) {
          iconSpan.innerHTML = '↕';
        }
      }
    });
  }

  renderTable(records) {
    this.mp.currentRecords = records;
    this.mp.currentPage = 1;
    this.renderTableOnly();
  }

  setPageSize(size) {
    this.mp.pageSize = size === 'all' ? 'all' : parseInt(size, 10);
    this.mp.currentPage = 1;
    this.renderTableOnly();
  }

  goToPage(page) {
    this.mp.currentPage = page;
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
              <option value="25" ${this.mp.pageSize == 25 ? 'selected' : ''}>25</option>
              <option value="50" ${this.mp.pageSize == 50 ? 'selected' : ''}>50</option>
              <option value="100" ${this.mp.pageSize == 100 ? 'selected' : ''}>100</option>
              <option value="250" ${this.mp.pageSize == 250 ? 'selected' : ''}>250</option>
              <option value="all" ${this.mp.pageSize === 'all' ? 'selected' : ''}>All</option>
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

    const isAll = this.mp.pageSize === 'all';
    const effectivePageSize = isAll ? totalRecords : parseInt(this.mp.pageSize, 10);
    const totalPages = isAll ? 1 : Math.max(1, Math.ceil(totalRecords / effectivePageSize));

    if (this.mp.currentPage > totalPages) {
      this.mp.currentPage = totalPages;
    }
    if (this.mp.currentPage < 1) {
      this.mp.currentPage = 1;
    }

    const startItem = (this.mp.currentPage - 1) * effectivePageSize + 1;
    const endItem = isAll ? totalRecords : Math.min(this.mp.currentPage * effectivePageSize, totalRecords);

    const html = `
      <div class="table-pagination">
        <div class="page-size-label">
          <span>Show</span>
          <select class="page-size-select" onchange="window.mainPanel.setPageSize(this.value)">
            <option value="25" ${this.mp.pageSize == 25 ? 'selected' : ''}>25</option>
            <option value="50" ${this.mp.pageSize == 50 ? 'selected' : ''}>50</option>
            <option value="100" ${this.mp.pageSize == 100 ? 'selected' : ''}>100</option>
            <option value="250" ${this.mp.pageSize == 250 ? 'selected' : ''}>250</option>
            <option value="all" ${this.mp.pageSize === 'all' ? 'selected' : ''}>All</option>
          </select>
          <span>per page</span>
        </div>

        <div class="page-info-badge">
          Showing ${startItem.toLocaleString()} - ${endItem.toLocaleString()} of ${totalRecords.toLocaleString()} records
        </div>

        <div class="pagination-controls-group">
          <button class="pagination-btn" ${this.mp.currentPage <= 1 ? 'disabled' : ''} onclick="window.mainPanel.goToPage(1)" title="First Page">
            &laquo;
          </button>
          <button class="pagination-btn" ${this.mp.currentPage <= 1 ? 'disabled' : ''} onclick="window.mainPanel.goToPage(${this.mp.currentPage - 1})" title="Previous Page">
            &lt;
          </button>
          
          <span class="pagination-btn active">
            Page ${this.mp.currentPage} of ${totalPages}
          </span>

          <button class="pagination-btn" ${this.mp.currentPage >= totalPages ? 'disabled' : ''} onclick="window.mainPanel.goToPage(${this.mp.currentPage + 1})" title="Last Page">
            &gt;
          </button>
          <button class="pagination-btn" ${this.mp.currentPage >= totalPages ? 'disabled' : ''} onclick="window.mainPanel.goToPage(${totalPages})" title="Last Page">
            &raquo;
          </button>
        </div>
      </div>
    `;

    if (topContainer) topContainer.innerHTML = html;
    if (bottomContainer) bottomContainer.innerHTML = html;
  }

  renderTableOnly() {
    const tableBody = document.getElementById('table-body');
    if (!tableBody) return;

    let records = (this.mp.currentRecords || []).slice();

    if (this.mp.tableFilter) {
      const q = this.mp.tableFilter;
      records = records.filter(r => 
        (r.serialNo || '').toLowerCase().includes(q) ||
        (r.processRecorded || '').toLowerCase().includes(q) ||
        (r.failureComment || '').toLowerCase().includes(q) ||
        (r.defectComment || '').toLowerCase().includes(q) ||
        (r.fixComment || '').toLowerCase().includes(q) ||
        (r.defectDescription || '').toLowerCase().includes(q) ||
        (r.refDes || '').toLowerCase().includes(q) ||
        (r.debugTech || '').toLowerCase().includes(q) ||
        (r.repairComment || '').toLowerCase().includes(q)
      );
    }

    records = this.sortData(records);
    this.updateTableHeaderSortUI();

    const totalRecords = records.length;
    this.renderPaginationControls(totalRecords);

    if (totalRecords === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="13" class="empty-state" style="padding: 2rem;">
            No records found matching criteria.
          </td>
        </tr>
      `;
      return;
    }

    let paginatedRecords = records;
    if (this.mp.pageSize !== 'all') {
      const pageSize = parseInt(this.mp.pageSize, 10);
      const startIndex = (this.mp.currentPage - 1) * pageSize;
      paginatedRecords = records.slice(startIndex, startIndex + pageSize);
    }
    this.mp.currentPaginatedRecords = paginatedRecords;

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
          
          <td onclick="event.stopPropagation()">
            <select class="fix-status-badge ${this.mp.getFixStatusBadgeClass(fixStatus)}" 
                    onchange="window.mainPanel.handleEncodedFixStatusChange('${this.safeParam(r.serialNo)}', '${this.safeParam(r.faDate)}', '${this.safeParam(r.refDes)}', '${this.safeParam(r.defectDescription)}', this.value, this)">
              <option value="Pending" ${fixStatus === 'Pending' ? 'selected' : ''}>Pending</option>
              <option value="Yes" ${fixStatus === 'Yes' ? 'selected' : ''}>Yes</option>
              <option value="No" ${fixStatus === 'No' ? 'selected' : ''}>No</option>
              <option value="False Fail" ${fixStatus === 'False Fail' ? 'selected' : ''}>False Fail</option>
              <option value="Possible False Fail" ${fixStatus === 'Possible False Fail' ? 'selected' : ''}>Possible False Fail</option>
            </select>
          </td>

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

    tableBody.innerHTML = html;
  }
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.RecordsTable = RecordsTable;
