/**
 * TreeView Component - Renders 5-level left margin tree navigation:
 * Customer (L1) -> Parent Part No (L2) -> Process Recorded (L3) -> Defect Description (L4) -> Ref Des (L5)
 */
class TreeView {
  constructor(containerId = 'tree-content') {
    this.containerId = containerId;
    this.expandedKeys = new Set();

    window.dataStore.subscribe(() => this.render());
    this.render();
  }

  get container() {
    return document.getElementById(this.containerId);
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

  getHighlightRegex() {
    const query = (window.dataStore && window.dataStore.searchQuery) ? window.dataStore.searchQuery.trim() : '';
    if (!query) return null;
    if (this._cachedQuery === query && this._cachedRegex !== undefined) {
      return this._cachedRegex;
    }
    const words = query.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) {
      this._cachedQuery = query;
      this._cachedRegex = null;
      return null;
    }
    words.sort((a, b) => b.length - a.length);
    const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    this._cachedQuery = query;
    this._cachedRegex = new RegExp(`(${escapedWords.join('|')})`, 'gi');
    return this._cachedRegex;
  }

  highlightText(str) {
    if (!str && str !== 0) return '';
    const safeStr = this.escapeHtml(str);
    const regex = this.getHighlightRegex();
    if (!regex) return safeStr;

    regex.lastIndex = 0;
    return safeStr.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  toggleNode(key) {
    if (this.expandedKeys.has(key)) {
      this.expandedKeys.delete(key);
    } else {
      this.expandedKeys.add(key);
    }
    this.render();
  }

  toggleEncodedNode(encKey) {
    const key = decodeURIComponent(encKey);
    this.toggleNode(key);
  }

  expandAll() {
    if (!this.expandedKeys) this.expandedKeys = new Set();
    const tree = window.dataStore ? (window.dataStore.treeData || []) : [];
    tree.forEach(c => {
      const cKey = `c:${c.name}`;
      this.expandedKeys.add(cKey);
      if (Array.isArray(c.children)) {
        c.children.forEach(p => {
          const pKey = `${cKey}>p:${p.name}`;
          this.expandedKeys.add(pKey);
          if (Array.isArray(p.children)) {
            p.children.forEach(pr => {
              const prKey = `${pKey}>pr:${pr.name}`;
              this.expandedKeys.add(prKey);
              if (Array.isArray(pr.children)) {
                pr.children.forEach(d => {
                  const dKey = `${prKey}>d:${d.name}`;
                  this.expandedKeys.add(dKey);
                });
              }
            });
          }
        });
      }
    });
    this.render();
  }

  collapseAll() {
    if (!this.expandedKeys) {
      this.expandedKeys = new Set();
    } else {
      this.expandedKeys.clear();
    }
    this.render();
  }

  renderBadge(node) {
    const isSN = window.dataStore && window.dataStore.treeMetric === 'uniqueSN';
    const count = isSN ? (node.uniqueSNCount || 0) : (node.recordCount || 0);
    const title = isSN 
      ? `${count.toLocaleString()} unique serial number${count !== 1 ? 's' : ''}` 
      : `${count.toLocaleString()} defect record${count !== 1 ? 's' : ''}`;
    const badgeClass = isSN ? 'tree-badge sn-mode' : 'tree-badge';
    return `<span class="${badgeClass}" title="${title}">${count.toLocaleString()}</span>`;
  }

  syncToggleButtons() {
    const isSN = window.dataStore && window.dataStore.treeMetric === 'uniqueSN';
    const btnRecords = document.getElementById('tree-metric-btn-records');
    const btnSN = document.getElementById('tree-metric-btn-uniquesn');
    if (btnRecords) btnRecords.classList.toggle('active', !isSN);
    if (btnSN) btnSN.classList.toggle('active', isSN);
  }

  render() {
    this.syncToggleButtons();
    if (!this.container) return;

    const tree = window.dataStore.treeData;
    const selectedKeys = window.dataStore.selectedKeys || new Set();
    const query = window.dataStore.searchQuery;

    let html = '';

    if (query) {
      const activeRecs = window.dataStore.getActiveRecords();
      const totalMatchCount = activeRecs.length;
      const totalMatchCusts = tree ? tree.length : 0;

      html += `
        <div class="search-banner" style="margin-bottom: 0.75rem; padding: 0.6rem 0.75rem; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 6px; font-size: 0.78rem; color: #38bdf8; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 4px;">
              <span>🔍 Filtered by:</span> <code style="background: rgba(255,255,255,0.15); padding: 1px 5px; border-radius: 3px; color: #fff;">${this.escapeHtml(query)}</code>
            </div>
            <div style="color: #cbd5e1; font-size: 0.72rem; margin-top: 2px;">
              Found <strong>${totalMatchCount.toLocaleString()}</strong> record${totalMatchCount !== 1 ? 's' : ''} across <strong>${totalMatchCusts}</strong> program group${totalMatchCusts !== 1 ? 's' : ''}
            </div>
          </div>
          <button type="button" onclick="window.dataStore.setSearchQuery('')" style="background: rgba(255,255,255,0.12); color: #f8fafc; border: 1px solid rgba(255,255,255,0.2); padding: 3px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 600; cursor: pointer;" title="Clear Search">
            Clear ✕
          </button>
        </div>
      `;
    }

    if (!tree || tree.length === 0) {
      this.container.innerHTML = html + `
        <div class="empty-state" style="padding: 2rem 1rem;">
          <div class="empty-state-icon">🔍</div>
          <p>No defect records match "${this.escapeHtml(query)}".</p>
          <button class="btn btn-clear-filter" onclick="window.dataStore.clearAllFilters()" style="margin-top: 0.5rem;">
            Clear All Filters
          </button>
        </div>
      `;
      return;
    }

    html += '<div class="tree-root">';

    tree.forEach(cust => {
      const custKey = `c:${cust.name}`;
      const isCustExpanded = this.expandedKeys.has(custKey);
      const isCustChecked = selectedKeys.has(custKey);
      const isCustIndeterminate = window.dataStore.isNodeIndeterminate(custKey);

      html += `
        <div class="tree-node level-1">
          <div class="tree-node-row ${isCustChecked ? 'selected' : ''} ${isCustIndeterminate ? 'indeterminate' : ''}" 
               data-key="${this.safeParam(custKey)}"
               onclick="window.treeView.handleRowClick(event, '${this.safeParam(custKey)}')">
            <div class="tree-node-left">
              <span class="tree-toggle ${isCustExpanded ? 'expanded' : ''}" 
                    onclick="event.stopPropagation(); window.treeView.toggleEncodedNode('${this.safeParam(custKey)}')">
                <i data-lucide="chevron-right"></i>
              </span>
              <input type="checkbox" class="tree-node-checkbox" 
                     data-key="${this.safeParam(custKey)}" 
                     ${isCustChecked ? 'checked' : ''} 
                     onclick="window.treeView.handleCheckboxClick(event, '${this.safeParam(custKey)}')" />
              <i class="tree-icon" data-lucide="building-2"></i>
              <span class="tree-label" title="Customer ${this.escapeHtml(cust.name)}">${this.highlightText(cust.name)}</span>
            </div>
            ${this.renderBadge(cust)}
          </div>
      `;

      if (isCustExpanded) {
        html += '<div class="tree-children">';

        cust.children.forEach(part => {
          const partKey = `${custKey}>p:${part.name}`;
          const isPartExpanded = this.expandedKeys.has(partKey);
          const isPartChecked = selectedKeys.has(partKey);
          const isPartIndeterminate = window.dataStore.isNodeIndeterminate(partKey);

          html += `
            <div class="tree-node level-2">
              <div class="tree-node-row ${isPartChecked ? 'selected' : ''} ${isPartIndeterminate ? 'indeterminate' : ''}" 
                   data-key="${this.safeParam(partKey)}"
                   onclick="window.treeView.handleRowClick(event, '${this.safeParam(partKey)}')">
                <div class="tree-node-left">
                  <span class="tree-toggle ${isPartExpanded ? 'expanded' : ''}" 
                        onclick="event.stopPropagation(); window.treeView.toggleEncodedNode('${this.safeParam(partKey)}')">
                    <i data-lucide="chevron-right"></i>
                  </span>
                  <input type="checkbox" class="tree-node-checkbox" 
                         data-key="${this.safeParam(partKey)}" 
                         ${isPartChecked ? 'checked' : ''} 
                         onclick="window.treeView.handleCheckboxClick(event, '${this.safeParam(partKey)}')" />
                  <i class="tree-icon" data-lucide="cpu"></i>
                  <span class="tree-label" title="Part No: ${this.escapeHtml(part.name)}">${this.highlightText(part.name)}</span>
                </div>
                ${this.renderBadge(part)}
              </div>
          `;

          if (isPartExpanded) {
            html += '<div class="tree-children">';

            part.children.forEach(proc => {
              const procKey = `${partKey}>pr:${proc.name}`;
              const isProcExpanded = this.expandedKeys.has(procKey);
              const isProcChecked = selectedKeys.has(procKey);
              const isProcIndeterminate = window.dataStore.isNodeIndeterminate(procKey);

              html += `
                <div class="tree-node level-3">
                  <div class="tree-node-row ${isProcChecked ? 'selected' : ''} ${isProcIndeterminate ? 'indeterminate' : ''}" 
                       data-key="${this.safeParam(procKey)}"
                       onclick="window.treeView.handleRowClick(event, '${this.safeParam(procKey)}')">
                    <div class="tree-node-left">
                      <span class="tree-toggle ${isProcExpanded ? 'expanded' : ''}" 
                            onclick="event.stopPropagation(); window.treeView.toggleEncodedNode('${this.safeParam(procKey)}')">
                        <i data-lucide="chevron-right"></i>
                      </span>
                      <input type="checkbox" class="tree-node-checkbox" 
                             data-key="${this.safeParam(procKey)}" 
                             ${isProcChecked ? 'checked' : ''} 
                             onclick="window.treeView.handleCheckboxClick(event, '${this.safeParam(procKey)}')" />
                      <i class="tree-icon" data-lucide="activity"></i>
                      <span class="tree-label" title="Process: ${this.escapeHtml(proc.name)}">${this.highlightText(proc.name)}</span>
                    </div>
                    ${this.renderBadge(proc)}
                  </div>
              `;

              if (isProcExpanded) {
                html += '<div class="tree-children">';

                proc.children.forEach(desc => {
                  const descKey = `${procKey}>d:${desc.name}`;
                  const isDescExpanded = this.expandedKeys.has(descKey);
                  const isDescChecked = selectedKeys.has(descKey);
                  const isDescIndeterminate = window.dataStore.isNodeIndeterminate(descKey);

                  html += `
                    <div class="tree-node level-4">
                      <div class="tree-node-row ${isDescChecked ? 'selected' : ''} ${isDescIndeterminate ? 'indeterminate' : ''}" 
                           data-key="${this.safeParam(descKey)}"
                           onclick="window.treeView.handleRowClick(event, '${this.safeParam(descKey)}')">
                        <div class="tree-node-left">
                          <span class="tree-toggle ${isDescExpanded ? 'expanded' : ''}" 
                                onclick="event.stopPropagation(); window.treeView.toggleEncodedNode('${this.safeParam(descKey)}')">
                            <i data-lucide="chevron-right"></i>
                          </span>
                          <input type="checkbox" class="tree-node-checkbox" 
                                 data-key="${this.safeParam(descKey)}" 
                                 ${isDescChecked ? 'checked' : ''} 
                                 onclick="window.treeView.handleCheckboxClick(event, '${this.safeParam(descKey)}')" />
                          <i class="tree-icon" data-lucide="alert-triangle"></i>
                          <span class="tree-label" title="${this.escapeHtml(desc.name)}">${this.highlightText(desc.name)}</span>
                        </div>
                        ${this.renderBadge(desc)}
                      </div>
                  `;

                  if (isDescExpanded) {
                    html += '<div class="tree-children">';

                    desc.children.forEach(ref => {
                      const refKey = `${descKey}>r:${ref.name}`;
                      const isRefChecked = selectedKeys.has(refKey);

                      html += `
                        <div class="tree-node level-5">
                          <div class="tree-node-row ${isRefChecked ? 'selected' : ''}" 
                               data-key="${this.safeParam(refKey)}"
                               onclick="window.treeView.handleRowClick(event, '${this.safeParam(refKey)}')">
                            <div class="tree-node-left">
                              <span class="tree-toggle" style="visibility: hidden;"><i data-lucide="minus"></i></span>
                              <input type="checkbox" class="tree-node-checkbox" 
                                     data-key="${this.safeParam(refKey)}" 
                                     ${isRefChecked ? 'checked' : ''} 
                                     onclick="window.treeView.handleCheckboxClick(event, '${this.safeParam(refKey)}')" />
                              <i class="tree-icon" data-lucide="map-pin"></i>
                              <span class="tree-label" title="Ref Des: ${this.escapeHtml(ref.name)}">${this.highlightText(ref.name)}</span>
                            </div>
                            ${this.renderBadge(ref)}
                          </div>
                        </div>
                      `;
                    });

                    html += '</div>'; // end desc children
                  }

                  html += '</div>'; // end level-4 desc node
                });

                html += '</div>'; // end proc children
              }

              html += '</div>'; // end level-3 proc node
            });

            html += '</div>'; // end part children
          }

          html += '</div>'; // end level-2 part node
        });

        html += '</div>'; // end cust children
      }

      html += '</div>'; // end level-1 cust node
    });

    html += '</div>'; // end tree-root

    this.container.innerHTML = html;

    const checkboxes = this.container.querySelectorAll('.tree-node-checkbox');
    checkboxes.forEach(cb => {
      const k = decodeURIComponent(cb.getAttribute('data-key') || '');
      if (window.dataStore.isNodeIndeterminate(k)) {
        cb.indeterminate = true;
      }
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  handleRowClick(event, encKey) {
    const key = decodeURIComponent(encKey);
    if (event.ctrlKey || event.metaKey) {
      const isChecked = window.dataStore.selectedKeys.has(key);
      window.dataStore.toggleNodeChecked(key, !isChecked);
      this.lastClickedKey = key;
    } else if (event.shiftKey) {
      this.handleRangeSelection(key);
    } else {
      this.toggleNode(key);
    }
  }

  handleCheckboxClick(event, encKey) {
    event.stopPropagation();
    const key = decodeURIComponent(encKey);
    if (event.shiftKey) {
      this.handleRangeSelection(key);
    } else {
      const isChecked = window.dataStore.selectedKeys.has(key);
      window.dataStore.toggleNodeChecked(key, !isChecked);
      this.lastClickedKey = key;
    }
  }

  handleRangeSelection(targetKey) {
    if (!this.lastClickedKey) {
      const isChecked = window.dataStore.selectedKeys.has(targetKey);
      window.dataStore.toggleNodeChecked(targetKey, !isChecked);
      this.lastClickedKey = targetKey;
      return;
    }

    const rowElements = Array.from(this.container.querySelectorAll('.tree-node-row'));
    const visibleKeys = rowElements.map(el => decodeURIComponent(el.getAttribute('data-key') || '')).filter(Boolean);

    const idxA = visibleKeys.indexOf(this.lastClickedKey);
    const idxB = visibleKeys.indexOf(targetKey);

    if (idxA === -1 || idxB === -1) {
      const isChecked = window.dataStore.selectedKeys.has(targetKey);
      window.dataStore.toggleNodeChecked(targetKey, !isChecked);
      this.lastClickedKey = targetKey;
      return;
    }

    const start = Math.min(idxA, idxB);
    const end = Math.max(idxA, idxB);
    const rangeKeys = visibleKeys.slice(start, end + 1);

    const shouldCheck = !window.dataStore.selectedKeys.has(targetKey);
    window.dataStore.selectNodeKeysRange(rangeKeys, shouldCheck);
    this.lastClickedKey = targetKey;
  }

  selectEncodedNode(event, level, encCust = '', encPart = '', encProc = '', encDesc = '', encRef = '') {
    const customer = decodeURIComponent(encCust);
    const parentPartNo = decodeURIComponent(encPart);
    const processRecorded = decodeURIComponent(encProc);
    const defectDescription = decodeURIComponent(encDesc);
    const refDes = decodeURIComponent(encRef);

    this.selectNode(event, level, customer, parentPartNo, processRecorded, defectDescription, refDes);
  }

  selectNode(event, level, customer, parentPartNo = '', processRecorded = '', defectDescription = '', refDes = '') {
    if (event && event.stopPropagation) event.stopPropagation();
    
    let nodeKey = '';
    if (level === 1) {
      nodeKey = `c:${customer}`;
    } else if (level === 2) {
      nodeKey = `c:${customer}>p:${parentPartNo}`;
    } else if (level === 3) {
      nodeKey = `c:${customer}>p:${parentPartNo}>pr:${processRecorded}`;
    } else if (level === 4) {
      nodeKey = `c:${customer}>p:${parentPartNo}>pr:${processRecorded}>d:${defectDescription}`;
    } else if (level === 5) {
      nodeKey = `c:${customer}>p:${parentPartNo}>pr:${processRecorded}>d:${defectDescription}>r:${refDes}`;
    }

    if (nodeKey) {
      window.dataStore.toggleNodeChecked(nodeKey, true);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.treeView = new TreeView('tree-content');
  });
} else {
  window.treeView = new TreeView('tree-content');
}
