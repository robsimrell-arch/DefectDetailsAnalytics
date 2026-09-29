/**
 * AnnotationModal - Handles solution comments feed, record detail modal, fix annotation edits, and server settings.
 */
class AnnotationModal {
  constructor(mainPanel) {
    this.mp = mainPanel;
    this.commentDebounceTimer = null;
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

  highlightText(str, extraQuery) {
    return this.mp.highlightText(str, extraQuery);
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

          <div style="display: flex; align-items: center; gap: 0.5rem;" onclick="event.stopPropagation()">
            <span style="font-size: 0.78rem; font-weight: 600; color: var(--accent-emerald); text-transform: uppercase; letter-spacing: 0.03em;">Solution Confirmed:</span>
            <select class="fix-status-badge ${this.mp.getFixStatusBadgeClass(fixStatus)}" 
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

        ${rec.failureComment ? `
          <div class="comment-block failure-block">
            <div class="comment-block-label amber-label">
              <i data-lucide="alert-triangle" style="width: 14px; height: 14px;"></i>
              <strong>Failure Comment</strong> ${rec.whoFailed ? `<span class="user-badge">by ${this.highlightText(rec.whoFailed)}</span>` : ''}
            </div>
            <div class="comment-text">${this.highlightText(rec.failureComment)}</div>
          </div>
        ` : ''}

        ${rec.defectComment ? `
          <div class="comment-block defect-block">
            <div class="comment-block-label blue-label">
              <i data-lucide="wrench" style="width: 14px; height: 14px;"></i>
              <strong>Defect Comment</strong> ${rec.debugTech ? `<span class="user-badge">by ${this.highlightText(rec.debugTech)}</span>` : ''}
            </div>
            <div class="comment-text">${this.highlightText(rec.defectComment)}</div>
          </div>
        ` : ''}

        ${rec.repairComment ? `
          <div class="comment-block repair-block">
            <div class="comment-block-label purple-label">
              <i data-lucide="tool" style="width: 14px; height: 14px;"></i>
              <strong>Repair Comment</strong> ${rec.repairTech ? `<span class="user-badge">by ${this.highlightText(rec.repairTech)}</span>` : ''}
            </div>
            <div class="comment-text">${this.highlightText(rec.repairComment)}</div>
          </div>
        ` : ''}

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

  renderComments(selected, records) {
    const container = document.getElementById('comments-feed');
    const titleEl = document.getElementById('comments-title');
    if (!container) return;

    const totalCount = records.length;
    const commentsList = records.slice(0, 50);

    if (titleEl) {
      const countInfo = totalCount > 50 
        ? ` (Showing 50 most recent of ${totalCount.toLocaleString()} records)` 
        : ` (${totalCount.toLocaleString()} records)`;

      const maximal = window.dataStore ? window.dataStore.maximalSelectedNodes : [];
      if (maximal && maximal.length > 1) {
        titleEl.innerHTML = `<i data-lucide="message-square"></i> Failure & Defect Comments Feed for Multi-Selection (${maximal.length} items)${countInfo}`;
      } else if (selected && selected.level === 5) {
        titleEl.innerHTML = `<i data-lucide="message-square"></i> Failure, Defect & Repair Comments for Ref Des: <span style="color: var(--accent-blue);">${this.escapeHtml(selected.refDes)}</span>${countInfo}`;
      } else if (selected && selected.level === 4) {
        titleEl.innerHTML = `<i data-lucide="message-square"></i> Failure, Defect & Repair Comments for <span style="color: var(--accent-blue);">${this.escapeHtml(selected.defectDescription)}</span>${countInfo}`;
      } else if (selected && selected.level === 3) {
        titleEl.innerHTML = `<i data-lucide="message-square"></i> Failure, Defect & Repair Comments for Process: <span style="color: var(--accent-blue);">${this.escapeHtml(selected.processRecorded)}</span>${countInfo}`;
      } else if (selected && selected.level === 2) {
        titleEl.innerHTML = `<i data-lucide="message-square"></i> Failure & Defect Comments Feed for Part: <span style="color: var(--accent-blue);">${this.escapeHtml(selected.parentPartNo)}</span>${countInfo}`;
      } else if (selected && selected.level === 1) {
        titleEl.innerHTML = `<i data-lucide="message-square"></i> Failure & Defect Comments Feed for Customer: <span style="color: var(--accent-blue);">${this.escapeHtml(selected.customer)}</span>${countInfo}`;
      } else {
        titleEl.innerHTML = `<i data-lucide="message-square"></i> Failure & Defect Comments Feed${countInfo}`;
      }
      if (window.lucide) window.lucide.createIcons({ el: titleEl });
    }

    if (commentsList.length === 0) {
      container.innerHTML = `
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

    container.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ el: container });
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
    const rec = (this.mp.currentPaginatedRecords && this.mp.currentPaginatedRecords[idx])
             || (this.mp.currentRecords && this.mp.currentRecords[idx])
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
    this.mp.showToast('⚡ Solution status synced to server backend');

    if (selectEl) {
      selectEl.className = `fix-status-badge ${this.mp.getFixStatusBadgeClass(newStatus)}`;
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
      this.mp.showToast('⚡ Solution memo synced to server backend');
    }
  }

  openServerSettingsModal() {
    const modal = document.getElementById('server-settings-modal');
    const input = document.getElementById('server-url-input');
    const statusDiv = document.getElementById('server-modal-status');
    const candidatesDiv = document.getElementById('server-candidates-list');

    if (!modal) return;

    const currentUrl = (window.dataStore && window.dataStore.activeServerUrl) || localStorage.getItem('DEFECT_APP_SERVER_URL') || 'http://localhost:8080';
    if (input) input.value = currentUrl;

    if (statusDiv && window.dataStore) {
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
    if (input && input.value && window.dataStore) {
      const url = input.value.trim();
      window.dataStore.setServerUrl(url);
      await window.dataStore.forceSyncNow();
      this.closeServerSettingsModal();
      this.mp.showToast(`⚡ Connected to ${url}`);
    }
  }
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.AnnotationModal = AnnotationModal;
