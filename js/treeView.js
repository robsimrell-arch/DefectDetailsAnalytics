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

  highlightText(str) {
    if (!str && str !== 0) return '';
    const safeStr = this.escapeHtml(str);
    const query = (window.dataStore && window.dataStore.searchQuery) ? window.dataStore.searchQuery.trim() : '';
    if (!query) return safeStr;

    const words = query.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return safeStr;

    words.sort((a, b) => b.length - a.length);
    const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi');

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
    if (window.dataStore) {
      window.dataStore.selectedNode = null;
    }
    this.render();
  }

  render() {
    if (!this.container) return;

    const tree = window.dataStore.treeData;
    const selected = window.dataStore.selectedNode;
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
      const isCustSelected = selected && selected.level === 1 && selected.customer === cust.name;

      html += `
        <div class="tree-node level-1">
          <div class="tree-node-row ${isCustSelected ? 'selected' : ''}" 
               onclick="window.treeView.selectEncodedNode(event, 1, '${this.safeParam(cust.name)}')">
            <div class="tree-node-left">
              <span class="tree-toggle ${isCustExpanded ? 'expanded' : ''}" 
                    onclick="event.stopPropagation(); window.treeView.toggleEncodedNode('${this.safeParam(custKey)}')">
                <i data-lucide="chevron-right"></i>
              </span>
              <i class="tree-icon" data-lucide="building-2"></i>
              <span class="tree-label" title="Customer ${this.escapeHtml(cust.name)}">${this.highlightText(cust.name)}</span>
            </div>
            <span class="tree-badge" title="${(cust.recordCount || 0).toLocaleString()} records">${(cust.recordCount || 0).toLocaleString()}</span>
          </div>
      `;

      if (isCustExpanded) {
        html += '<div class="tree-children">';

        cust.children.forEach(part => {
          const partKey = `${custKey}>p:${part.name}`;
          const isPartExpanded = this.expandedKeys.has(partKey);
          const isPartSelected = selected && selected.level === 2 && selected.customer === cust.name && selected.parentPartNo === part.name;

          html += `
            <div class="tree-node level-2">
              <div class="tree-node-row ${isPartSelected ? 'selected' : ''}" 
                   onclick="window.treeView.selectEncodedNode(event, 2, '${this.safeParam(cust.name)}', '${this.safeParam(part.name)}')">
                <div class="tree-node-left">
                  <span class="tree-toggle ${isPartExpanded ? 'expanded' : ''}" 
                        onclick="event.stopPropagation(); window.treeView.toggleEncodedNode('${this.safeParam(partKey)}')">
                    <i data-lucide="chevron-right"></i>
                  </span>
                  <i class="tree-icon" data-lucide="cpu"></i>
                  <span class="tree-label" title="Part No: ${this.escapeHtml(part.name)}">${this.highlightText(part.name)}</span>
                </div>
                <span class="tree-badge" title="${(part.recordCount || 0).toLocaleString()} records">${(part.recordCount || 0).toLocaleString()}</span>
              </div>
          `;

          if (isPartExpanded) {
            html += '<div class="tree-children">';

            part.children.forEach(proc => {
              const procKey = `${partKey}>pr:${proc.name}`;
              const isProcExpanded = this.expandedKeys.has(procKey);
              const isProcSelected = selected && selected.level === 3 && selected.customer === cust.name && selected.parentPartNo === part.name && selected.processRecorded === proc.name;

              html += `
                <div class="tree-node level-3">
                  <div class="tree-node-row ${isProcSelected ? 'selected' : ''}" 
                       onclick="window.treeView.selectEncodedNode(event, 3, '${this.safeParam(cust.name)}', '${this.safeParam(part.name)}', '${this.safeParam(proc.name)}')">
                    <div class="tree-node-left">
                      <span class="tree-toggle ${isProcExpanded ? 'expanded' : ''}" 
                            onclick="event.stopPropagation(); window.treeView.toggleEncodedNode('${this.safeParam(procKey)}')">
                        <i data-lucide="chevron-right"></i>
                      </span>
                      <i class="tree-icon" data-lucide="activity"></i>
                      <span class="tree-label" title="Process: ${this.escapeHtml(proc.name)}">${this.highlightText(proc.name)}</span>
                    </div>
                    <span class="tree-badge" title="${(proc.recordCount || 0).toLocaleString()} records">${(proc.recordCount || 0).toLocaleString()}</span>
                  </div>
              `;

              if (isProcExpanded) {
                html += '<div class="tree-children">';

                proc.children.forEach(desc => {
                  const descKey = `${procKey}>d:${desc.name}`;
                  const isDescExpanded = this.expandedKeys.has(descKey);
                  const isDescSelected = selected && selected.level === 4 && selected.customer === cust.name && selected.parentPartNo === part.name && selected.processRecorded === proc.name && selected.defectDescription === desc.name;

                  html += `
                    <div class="tree-node level-4">
                      <div class="tree-node-row ${isDescSelected ? 'selected' : ''}" 
                           onclick="window.treeView.selectEncodedNode(event, 4, '${this.safeParam(cust.name)}', '${this.safeParam(part.name)}', '${this.safeParam(proc.name)}', '${this.safeParam(desc.name)}')">
                        <div class="tree-node-left">
                          <span class="tree-toggle ${isDescExpanded ? 'expanded' : ''}" 
                                onclick="event.stopPropagation(); window.treeView.toggleEncodedNode('${this.safeParam(descKey)}')">
                            <i data-lucide="chevron-right"></i>
                          </span>
                          <i class="tree-icon" data-lucide="alert-triangle"></i>
                          <span class="tree-label" title="${this.escapeHtml(desc.name)}">${this.highlightText(desc.name)}</span>
                        </div>
                        <span class="tree-badge" title="${(desc.recordCount || 0).toLocaleString()} records">${(desc.recordCount || 0).toLocaleString()}</span>
                      </div>
                  `;

                  if (isDescExpanded) {
                    html += '<div class="tree-children">';

                    desc.children.forEach(ref => {
                      const isRefSelected = selected && selected.level === 5 && 
                        selected.customer === cust.name && 
                        selected.parentPartNo === part.name && 
                        selected.processRecorded === proc.name &&
                        selected.defectDescription === desc.name && 
                        selected.refDes === ref.name;

                      html += `
                        <div class="tree-node level-5">
                          <div class="tree-node-row ${isRefSelected ? 'selected' : ''}" 
                               onclick="window.treeView.selectEncodedNode(event, 5, '${this.safeParam(cust.name)}', '${this.safeParam(part.name)}', '${this.safeParam(proc.name)}', '${this.safeParam(desc.name)}', '${this.safeParam(ref.name)}')">
                            <div class="tree-node-left">
                              <span class="tree-toggle" style="visibility: hidden;"><i data-lucide="minus"></i></span>
                              <i class="tree-icon" data-lucide="map-pin"></i>
                              <span class="tree-label" title="Ref Des: ${this.escapeHtml(ref.name)}">${this.highlightText(ref.name)}</span>
                            </div>
                            <span class="tree-badge" title="${(ref.recordCount || 0).toLocaleString()} records">${(ref.recordCount || 0).toLocaleString()}</span>
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

    if (window.lucide) {
      window.lucide.createIcons();
    }
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
    event.stopPropagation();
    
    let nodeKey = '';
    if (level === 1) {
      nodeKey = `c:${customer}`;
    } else if (level === 2) {
      nodeKey = `c:${customer}>p:${parentPartNo}`;
    } else if (level === 3) {
      nodeKey = `c:${customer}>p:${parentPartNo}>pr:${processRecorded}`;
    } else if (level === 4) {
      nodeKey = `c:${customer}>p:${parentPartNo}>pr:${processRecorded}>d:${defectDescription}`;
    }

    if (nodeKey) {
      if (this.expandedKeys.has(nodeKey)) {
        this.expandedKeys.delete(nodeKey);
      } else {
        this.expandedKeys.add(nodeKey);
      }
    }

    window.dataStore.setSelectedNode({
      level,
      customer,
      parentPartNo,
      processRecorded,
      defectDescription,
      refDes
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.treeView = new TreeView('tree-content');
  });
} else {
  window.treeView = new TreeView('tree-content');
}
