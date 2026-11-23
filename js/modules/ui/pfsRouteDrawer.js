/**
 * PfsRouteDrawer - Right-side slide-over inspector for live TestLink (PFS) route status,
 * active PfsQuery eligibility, station visit history, and live PFS defects.
 */
const DEFAULT_PFS_SITES = [
  { key: 'huntsville', name: 'Huntsville', database: 'PFSHSP4', host: 'pfs-gw-hsp4.corp.bench.com', port: 50000 },
  { key: 'almelo', name: 'Almelo', database: 'PFSALP4', host: 'pfs-gw-alp4.corp.bench.com', port: 50000 },
  { key: 'angleton', name: 'Angleton', database: 'PFSTXP4', host: 'pfs-gw-txp4.corp.bench.com', port: 50000 },
  { key: 'austin', name: 'Austin', database: 'PFSATP4', host: 'pfs-gw-atp4.corp.bench.com', port: 50000 },
  { key: 'ayuthaya', name: 'Ayuthaya', database: 'PFSTHP4', host: 'pfs-gw-thp4.corp.bench.com', port: 50000 },
  { key: 'brasov', name: 'Brasov', database: 'PFSROP4', host: 'pfs-gw-rop4.corp.bench.com', port: 50000 },
  { key: 'dunseith', name: 'Dunseith', database: 'PFSDNP4', host: 'pfs-gw-dnp4.corp.bench.com', port: 50000 },
  { key: 'guadalajara', name: 'Guadalajara', database: 'PFSMXP4', host: 'pfs-gw-mxp4.corp.bench.com', port: 50000 },
  { key: 'moorpark', name: 'Moorpark', database: 'PFSMPP4', host: 'pfs-gw-mpp4.corp.bench.com', port: 50000 },
  { key: 'nashua', name: 'Nashua', database: 'PFSHDP4', host: 'pfs-gw-hdp4.corp.bench.com', port: 50000 },
  { key: 'penang', name: 'Penang', database: 'PFSMYP4', host: 'pfs-gw-myp4.corp.bench.com', port: 50000 },
  { key: 'phoenix', name: 'Phoenix', database: 'PFSPHP4', host: 'pfs-gw-php4.corp.bench.com', port: 50000 },
  { key: 'precision_tech', name: 'Precision Technologies', database: 'PFSPTP4', host: 'pfs-gw-ptp4.corp.bench.com', port: 50000 },
  { key: 'rochester', name: 'Rochester', database: 'PFSMNP4', host: 'pfs-gw-mnp4.corp.bench.com', port: 50000 },
  { key: 'san_jose', name: 'San Jose', database: 'PFSSJP4', host: 'pfs-gw-sjp4.corp.bench.com', port: 50000 },
  { key: 'santa_anna', name: 'Santa Anna', database: 'PFSSAP4', host: 'pfs-gw-sap4.corp.bench.com', port: 50000 },
  { key: 'scottsdale', name: 'Scottsdale AZ IoT Group', database: 'PFSSZP4', host: 'pfs-gw-szp4.corp.bench.com', port: 50000 },
  { key: 'suzhou', name: 'Suzhou', database: 'PFSCHP4', host: 'pfs-gw-chp4.corp.bench.com', port: 50000 },
  { key: 'tijuana', name: 'Tijuana', database: 'PFSTIP4', host: 'pfs-gw-tip4.corp.bench.com', port: 50000 },
  { key: 'tijuana_filtros', name: 'Tijuana (Filtros)', database: 'PFSFLP4', host: 'pfs-gw-flp4.corp.bench.com', port: 50000 },
  { key: 'winona', name: 'Winona', database: 'PFSMNP4', host: 'pfs-gw-mnp4.corp.bench.com', port: 50000 }
];

class PfsRouteDrawer {
  constructor(mainPanel) {
    this.mp = mainPanel;
    this.STORAGE_CONFIG_KEY = 'DEFECT_APP_PFS_CONFIG';
    this.SESSION_CREDS_KEY = 'DEFECT_APP_PFS_CREDS';

    this.sites = DEFAULT_PFS_SITES.slice();
    this.defaultSiteKey = 'huntsville';
    this.cache = new Map();

    this.isOpen = false;
    this.activeTab = 'route';
    this.stepFilter = 'all';
    this.expandedSteps = new Set();
    this.currentContext = null;
    this.currentData = null;
    this.currentFromCache = false;
    this.isLoading = false;
    this.loadingSerial = '';
    this.errorMessage = null;
    this.pendingAction = null;
    this.requestSeq = 0;

    this._bindGlobalKeys();
    this.updateHeaderBadge();
    this.loadSitesFromServer();
  }

  escapeHtml(str) {
    if (this.mp && typeof this.mp.escapeHtml === 'function') {
      return this.mp.escapeHtml(str);
    }
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

  getDefaultConfig() {
    const defSite = this.sites.find(s => s.key === this.defaultSiteKey) || this.sites[0];
    return {
      siteKey: defSite.key,
      host: defSite.host,
      port: defSite.port || 50000,
      database: defSite.database,
      isCustom: false
    };
  }

  getConfig() {
    const defaults = this.getDefaultConfig();
    try {
      const raw = localStorage.getItem(this.STORAGE_CONFIG_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return defaults;
      const isCustom = Boolean(parsed.isCustom || parsed.siteKey === '__custom__');
      return {
        siteKey: parsed.siteKey || defaults.siteKey,
        host: (parsed.host || defaults.host).trim(),
        port: parseInt(parsed.port, 10) || defaults.port,
        database: (parsed.database || defaults.database).trim(),
        isCustom
      };
    } catch (e) {
      return defaults;
    }
  }

  saveConfig(cfg) {
    try {
      localStorage.setItem(this.STORAGE_CONFIG_KEY, JSON.stringify({
        siteKey: cfg.siteKey,
        host: cfg.host,
        port: parseInt(cfg.port, 10) || 50000,
        database: cfg.database,
        isCustom: Boolean(cfg.isCustom)
      }));
    } catch (e) {}
  }

  getSessionCreds() {
    try {
      const raw = sessionStorage.getItem(this.SESSION_CREDS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.userId || !parsed.password) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  saveSessionCreds(userId, password) {
    try {
      sessionStorage.setItem(this.SESSION_CREDS_KEY, JSON.stringify({
        userId: String(userId || '').trim(),
        password: String(password || ''),
        verifiedAt: new Date().toISOString()
      }));
    } catch (e) {}
  }

  clearSessionCreds() {
    try {
      sessionStorage.removeItem(this.SESSION_CREDS_KEY);
    } catch (e) {}
  }

  _bindGlobalKeys() {
    if (this._keysBound) return;
    this._keysBound = true;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const loginModal = document.getElementById('pfs-login-modal');
      if (loginModal && loginModal.style.display === 'flex') {
        this.closeLoginModal();
        return;
      }
      if (this.isOpen) {
        this.closeDrawer();
      }
    });
  }

  async getApiBaseUrl() {
    if (window.dataStore && typeof window.dataStore.getActiveServerUrl === 'function') {
      try {
        const discovered = await window.dataStore.getActiveServerUrl();
        if (discovered) return discovered.replace(/\/$/, '');
      } catch (e) {}
    }
    if (window.location && window.location.protocol && window.location.protocol.startsWith('http')) {
      return window.location.origin.replace(/\/$/, '');
    }
    return null;
  }

  async loadSitesFromServer() {
    try {
      const baseUrl = await this.getApiBaseUrl();
      if (!baseUrl) return;
      const res = await fetch(`${baseUrl}/api/pfs/sites`, { cache: 'no-store' });
      if (!res.ok) return;
      const payload = await res.json();
      if (payload && Array.isArray(payload.sites) && payload.sites.length > 0) {
        this.sites = payload.sites;
        if (payload.defaultSiteKey) {
          this.defaultSiteKey = payload.defaultSiteKey;
        }
        this.updateHeaderBadge();
      }
    } catch (e) {}
  }

  updateHeaderBadge() {
    const loginBtn = document.getElementById('pfs-login-btn');
    const toggleBtn = document.getElementById('pfs-drawer-toggle-btn');
    const cfg = this.getConfig();
    const creds = this.getSessionCreds();

    if (loginBtn) {
      if (creds && creds.userId) {
        loginBtn.classList.add('connected');
        loginBtn.title = `Signed in to PFS (${cfg.database} @ ${cfg.host}:${cfg.port}) — Click to switch user or site`;
        loginBtn.innerHTML = `<span class="pfs-status-dot connected"></span><span>PFS: ${this.escapeHtml(creds.userId)} &middot; ${this.escapeHtml(cfg.database)}</span>`;
      } else {
        loginBtn.classList.remove('connected');
        loginBtn.title = `Sign in to TestLink (${cfg.database} @ ${cfg.host}:${cfg.port})`;
        loginBtn.innerHTML = `<span class="pfs-status-dot"></span><span>PFS Login (${this.escapeHtml(cfg.database)})</span>`;
      }
    }

    if (toggleBtn) {
      toggleBtn.classList.toggle('active', this.isOpen);
    }
  }

  ensureLoginModalExists() {
    let modal = document.getElementById('pfs-login-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pfs-login-modal';
      modal.className = 'lightbox-modal pfs-login-modal';
      modal.onclick = (e) => this.closeLoginModal(e);
      document.body.appendChild(modal);
    }
    return modal;
  }

  openLoginModal(reasonMsg = '') {
    const modal = this.ensureLoginModalExists();
    const cfg = this.getConfig();
    const creds = this.getSessionCreds();
    const isCustom = Boolean(cfg.isCustom || cfg.siteKey === '__custom__');

    let siteOptionsHtml = '';
    this.sites.forEach(s => {
      const selected = (!isCustom && s.key === cfg.siteKey) ? 'selected' : '';
      const defTag = s.key === this.defaultSiteKey ? ' (Default)' : '';
      siteOptionsHtml += `<option value="${this.escapeHtml(s.key)}" ${selected}>${this.escapeHtml(s.name)} (${this.escapeHtml(s.database)})${defTag}</option>`;
    });
    siteOptionsHtml += `<option value="__custom__" ${isCustom ? 'selected' : ''}>Custom / Simulator (Manual Host &amp; Port)</option>`;

    const reasonHtml = reasonMsg
      ? `<div class="pfs-login-notice"><i data-lucide="info" style="width:15px; height:15px; flex-shrink:0;"></i><span>${this.escapeHtml(reasonMsg)}</span></div>`
      : '';

    const signOutHtml = creds
      ? `<button type="button" class="btn pfs-btn-signout" onclick="window.mainPanel.pfsRouteDrawer.signOut()">Sign Out</button>`
      : '';

    modal.innerHTML = `
      <div class="lightbox-container pfs-login-dialog" onclick="event.stopPropagation()">
        <span class="lightbox-close" onclick="window.mainPanel.closePfsLoginModal()">&times;</span>
        <form id="pfs-login-form" onsubmit="window.mainPanel.pfsRouteDrawer.submitLogin(event)" style="padding: 1.5rem;">
          <div style="display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.75rem;">
            <i data-lucide="shield-check" style="width: 22px; height: 22px; color: var(--accent-blue);"></i>
            <h2 style="font-size: 1.15rem; font-weight: 700; margin: 0;">PFS / TestLink Connection &amp; Login</h2>
          </div>

          <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem;">
            Sign in with your PFS operator credentials to query live route status, step history, and PfsQuery eligibility over TLS 1.2 (port 50000).
          </p>

          ${reasonHtml}

          <div id="pfs-login-error" class="pfs-login-error" style="display: none;"></div>

          <div class="pfs-form-group">
            <label for="pfs-site-select">Benchmark Site / TestLink Server</label>
            <select id="pfs-site-select" class="select-field pfs-input" onchange="window.mainPanel.pfsRouteDrawer.handleSiteChange(this.value)">
              ${siteOptionsHtml}
            </select>
          </div>

          <div class="pfs-form-grid">
            <div class="pfs-form-group" style="flex: 2;">
              <label for="pfs-host-input">Server Hostname / IP</label>
              <input type="text" id="pfs-host-input" class="input-field pfs-input mono" value="${this.escapeHtml(cfg.host)}" ${isCustom ? '' : 'readonly'} required />
            </div>
            <div class="pfs-form-group" style="flex: 0.8; min-width: 90px;">
              <label for="pfs-port-input">Port</label>
              <input type="number" id="pfs-port-input" class="input-field pfs-input mono" value="${this.escapeHtml(cfg.port)}" min="1" max="65535" ${isCustom ? '' : 'readonly'} required />
            </div>
            <div class="pfs-form-group" style="flex: 1.1; min-width: 110px;">
              <label for="pfs-database-input">Database</label>
              <input type="text" id="pfs-database-input" class="input-field pfs-input mono" value="${this.escapeHtml(cfg.database)}" ${isCustom ? '' : 'readonly'} required />
            </div>
          </div>

          <div class="pfs-form-grid">
            <div class="pfs-form-group" style="flex: 1;">
              <label for="pfs-user-input">PFS User ID</label>
              <input type="text" id="pfs-user-input" class="input-field pfs-input" autocomplete="username" value="${this.escapeHtml(creds ? creds.userId : '')}" placeholder="PFS4 login (e.g. jdoe or BEI\\jdoe)" required />
            </div>
            <div class="pfs-form-group" style="flex: 1;">
              <label for="pfs-password-input">PFS Password</label>
              <input type="password" id="pfs-password-input" class="input-field pfs-input" autocomplete="current-password" value="" placeholder="Enter PFS password" required />
            </div>
          </div>

          <div class="pfs-session-security-note">
            <i data-lucide="lock" style="width: 13px; height: 13px; flex-shrink: 0;"></i>
            <span>Credentials are validated via <code>PfsVerifyUserInput</code> and kept strictly in browser <code>sessionStorage</code> (cleared when the browser closes).</span>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; border-top: 1px solid var(--border-color); padding-top: 1rem; margin-top: 1rem;">
            <div>${signOutHtml}</div>
            <div style="display: flex; gap: 0.65rem;">
              <button type="button" class="btn" onclick="window.mainPanel.closePfsLoginModal()">Cancel</button>
              <button type="submit" id="pfs-login-submit-btn" class="btn btn-primary">
                <i data-lucide="log-in"></i> Connect &amp; Verify
              </button>
            </div>
          </div>
        </form>
      </div>
    `;

    modal.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons({ el: modal });

    setTimeout(() => {
      const userEl = document.getElementById('pfs-user-input');
      const passEl = document.getElementById('pfs-password-input');
      if (userEl && !userEl.value) {
        userEl.focus();
      } else if (passEl) {
        passEl.focus();
      }
    }, 30);
  }

  closeLoginModal(event) {
    if (event && event.target && !event.target.classList.contains('lightbox-modal') && !event.target.classList.contains('lightbox-close')) {
      return;
    }
    const modal = document.getElementById('pfs-login-modal');
    if (modal) modal.style.display = 'none';
    this.pendingAction = null;
  }

  handleSiteChange(siteKey) {
    const hostEl = document.getElementById('pfs-host-input');
    const portEl = document.getElementById('pfs-port-input');
    const dbEl = document.getElementById('pfs-database-input');
    if (!hostEl || !portEl || !dbEl) return;

    if (siteKey === '__custom__') {
      hostEl.readOnly = false;
      portEl.readOnly = false;
      dbEl.readOnly = false;
      if (hostEl.value.endsWith('.corp.bench.com')) {
        hostEl.value = 'localhost';
      }
      portEl.value = portEl.value || '50000';
      hostEl.focus();
      return;
    }

    const site = this.sites.find(s => s.key === siteKey);
    if (site) {
      hostEl.value = site.host;
      portEl.value = site.port || 50000;
      dbEl.value = site.database;
      hostEl.readOnly = true;
      portEl.readOnly = true;
      dbEl.readOnly = true;
    }
  }

  async _parseJsonResponse(res) {
    const rawText = await res.text();
    if (!rawText) return { data: null, rawText: '' };
    try {
      return { data: JSON.parse(rawText), rawText };
    } catch (e) {
      return { data: null, rawText };
    }
  }

  async _isOutdatedBackend(baseUrl) {
    if (!baseUrl) return false;
    try {
      const probe = await fetch(`${baseUrl}/api/pfs/sites`, { cache: 'no-store' });
      return probe.status === 404;
    } catch (e) {
      return false;
    }
  }

  _showOutdatedBackendError(errEl) {
    if (!errEl) return;
    errEl.innerHTML = `
      <div>The running local backend server on port 8080 is an older version without PFS endpoints.</div>
      <div style="margin-top:0.5rem;">
        <button type="button" class="btn btn-sm btn-primary" onclick="window.mainPanel.pfsRouteDrawer.restartBackendFromModal()">Restart Local Backend Now</button>
      </div>
    `;
    errEl.style.display = 'block';
  }

  async restartBackendFromModal() {
    const errEl = document.getElementById('pfs-login-error');
    const baseUrl = await this.getApiBaseUrl();
    if (!baseUrl) return;
    if (errEl) {
      errEl.textContent = 'Restarting local backend server...';
      errEl.style.display = 'block';
    }
    try {
      await fetch(`${baseUrl}/api/restart`, { method: 'POST' });
    } catch (e) {}

    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 400));
      try {
        const res = await fetch(`${baseUrl}/api/pfs/sites`, { cache: 'no-store' });
        if (res.ok) {
          if (errEl) errEl.style.display = 'none';
          if (this.mp && typeof this.mp.showToast === 'function') {
            this.mp.showToast('⚡ Local backend restarted! Click Connect & Verify again.');
          }
          return;
        }
      } catch (e) {}
    }

    if (errEl) {
      errEl.textContent = 'Local backend did not expose PFS endpoints after restart. Re-run Install_Local_Desktop_App.cmd or Launch_Dashboard.bat.';
      errEl.style.display = 'block';
    }
  }

  async submitLogin(event) {
    if (event) event.preventDefault();

    const siteEl = document.getElementById('pfs-site-select');
    const hostEl = document.getElementById('pfs-host-input');
    const portEl = document.getElementById('pfs-port-input');
    const dbEl = document.getElementById('pfs-database-input');
    const userEl = document.getElementById('pfs-user-input');
    const passEl = document.getElementById('pfs-password-input');
    const errEl = document.getElementById('pfs-login-error');
    const submitBtn = document.getElementById('pfs-login-submit-btn');

    const siteKey = siteEl ? siteEl.value : this.defaultSiteKey;
    const isCustom = siteKey === '__custom__';
    const host = hostEl ? hostEl.value.trim() : '';
    const port = portEl ? (parseInt(portEl.value, 10) || 50000) : 50000;
    const database = dbEl ? dbEl.value.trim() : '';
    const userId = userEl ? userEl.value.trim() : '';
    const password = passEl ? passEl.value : '';

    const showErr = (msg) => {
      if (errEl) {
        errEl.textContent = msg;
        errEl.style.display = 'block';
      }
    };

    if (!host || !database || !userId || !password) {
      showErr('Please fill in Host, Database, User ID, and Password.');
      return;
    }
    if (port < 1 || port > 65535) {
      showErr('Port must be between 1 and 65535.');
      return;
    }

    if (errEl) errEl.style.display = 'none';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Verifying with TestLink (may take ~25s)...</span>';
    }

    let resolvedBaseUrl = null;
    try {
      resolvedBaseUrl = await this.getApiBaseUrl();
      if (!resolvedBaseUrl) {
        showErr('Local backend server is not reachable. Start Launch_Dashboard.bat or server.py first.');
        return;
      }

      const res = await fetch(`${resolvedBaseUrl}/api/pfs/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port, database, userId, password })
      });

      const { data } = await this._parseJsonResponse(res);
      if (res.status === 404 || !data) {
        if (await this._isOutdatedBackend(resolvedBaseUrl)) {
          this._showOutdatedBackendError(errEl);
        } else {
          showErr(`Unexpected server response (HTTP ${res.status}).`);
        }
        return;
      }

      if (!res.ok || !data.ok) {
        showErr(data.message || data.error || 'PFS authentication failed.');
        return;
      }

      this.saveConfig({ siteKey, host, port, database, isCustom });
      this.saveSessionCreds(userId, password);
      this.updateHeaderBadge();

      const modal = document.getElementById('pfs-login-modal');
      if (modal) modal.style.display = 'none';

      if (this.mp && typeof this.mp.showToast === 'function') {
        this.mp.showToast(`⚡ PFS verified (${database}) as ${userId}`);
      }

      const queued = this.pendingAction;
      this.pendingAction = null;
      if (typeof queued === 'function') {
        queued();
      } else if (this.isOpen) {
        this.render();
      }
    } catch (err) {
      if (resolvedBaseUrl && await this._isOutdatedBackend(resolvedBaseUrl)) {
        this._showOutdatedBackendError(errEl);
      } else {
        showErr(`Connection error: ${err.message || err}`);
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i data-lucide="log-in"></i> Connect &amp; Verify`;
        if (window.lucide) window.lucide.createIcons({ el: submitBtn });
      }
    }
  }

  signOut() {
    this.clearSessionCreds();
    this.cache.clear();
    this.pendingAction = null;
    this.updateHeaderBadge();

    const modal = document.getElementById('pfs-login-modal');
    if (modal) modal.style.display = 'none';

    if (this.mp && typeof this.mp.showToast === 'function') {
      this.mp.showToast('Signed out of PFS session');
    }
    if (this.isOpen) {
      this.render();
    }
  }

  ensureDrawerExists() {
    let drawer = document.getElementById('pfs-route-drawer');
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = 'pfs-route-drawer';
      drawer.className = 'pfs-drawer';
      drawer.setAttribute('aria-label', 'PFS Route Inspector');
      document.body.appendChild(drawer);
    }
    return drawer;
  }

  openDrawer() {
    const drawer = this.ensureDrawerExists();
    const wasOpen = this.isOpen;
    this.isOpen = true;
    drawer.classList.add('open');
    document.body.classList.add('pfs-drawer-open');
    this.updateHeaderBadge();
    this.render();

    if (!wasOpen) {
      this._reflowActiveChart();
    }
  }

  closeDrawer() {
    const drawer = document.getElementById('pfs-route-drawer');
    const wasOpen = this.isOpen;
    this.isOpen = false;
    if (drawer) drawer.classList.remove('open');
    document.body.classList.remove('pfs-drawer-open');
    this.updateHeaderBadge();

    if (wasOpen) {
      this._reflowActiveChart();
    }
  }

  toggleDrawer() {
    if (this.isOpen) {
      this.closeDrawer();
      return;
    }
    this.openDrawer();
    setTimeout(() => {
      const input = document.getElementById('pfs-manual-sn-input');
      if (input && !this.currentData) input.focus();
    }, 60);
  }

  _reflowActiveChart() {
    setTimeout(() => {
      if (this.mp && (this.mp.activeTab === 'timeline' || this.mp.activeTab === 'pareto' || this.mp.activeTab === 'chart')) {
        const records = window.dataStore ? window.dataStore.getActiveRecords() : [];
        if (typeof this.mp.renderChart === 'function') {
          this.mp.renderChart(records);
        }
      }
    }, 260);
  }

  openForRecord(serialNo, parentPartNo = '', faDate = '', refDes = '', defectDescription = '', processRecorded = '') {
    const sn = String(serialNo || '').trim();
    if (!sn) return;

    this.currentContext = {
      serialNo: sn,
      parentPartNo: String(parentPartNo || '').trim(),
      faDate: String(faDate || '').trim(),
      refDes: String(refDes || '').trim(),
      defectDescription: String(defectDescription || '').trim(),
      processRecorded: String(processRecorded || '').trim()
    };

    const creds = this.getSessionCreds();
    if (!creds) {
      this.pendingAction = () => this.lookupSerialNumber(sn, this.currentContext.parentPartNo, '', false);
      this.openLoginModal(`Sign in to PFS to inspect Serial Number ${sn}`);
      return;
    }

    this.lookupSerialNumber(sn, this.currentContext.parentPartNo, '', false);
  }

  handleManualSubmit(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('pfs-manual-sn-input');
    const sn = input ? input.value.trim() : '';
    if (!sn) {
      if (input) input.focus();
      return;
    }
    if (!this.currentContext || this.currentContext.serialNo.toUpperCase() !== sn.toUpperCase()) {
      this.currentContext = null;
    }
    const creds = this.getSessionCreds();
    if (!creds) {
      this.pendingAction = () => this.lookupSerialNumber(sn, '', '', false);
      this.openLoginModal(`Sign in to PFS to look up Serial Number ${sn}`);
      return;
    }
    this.lookupSerialNumber(sn, '', '', false);
  }

  resetViewForNewResult(data) {
    this.activeTab = 'route';
    this.stepFilter = 'all';
    this.expandedSteps = new Set();
    if (data && Array.isArray(data.routeSteps)) {
      data.routeSteps.forEach(s => {
        if (s.classification === 'failed') {
          this.expandedSteps.add(s.operationCode);
        }
      });
    }
  }

  async lookupSerialNumber(serialNumber, itemNumber = '', productionOrder = '', forceFresh = false) {
    const sn = String(serialNumber || '').trim();
    if (!sn) return;

    const creds = this.getSessionCreds();
    if (!creds) {
      this.pendingAction = () => this.lookupSerialNumber(sn, itemNumber, productionOrder, forceFresh);
      this.openLoginModal(`Sign in to PFS to inspect Serial Number ${sn}`);
      return;
    }

    const cfg = this.getConfig();
    const poClean = String(productionOrder || '').trim();
    const cacheKey = `${cfg.database}|${sn.toUpperCase()}|${poClean.toUpperCase()}`;

    if (!forceFresh && this.cache.has(cacheKey)) {
      this.currentData = this.cache.get(cacheKey);
      this.currentFromCache = true;
      this.isLoading = false;
      this.errorMessage = null;
      this.resetViewForNewResult(this.currentData);
      this.openDrawer();
      return;
    }

    const seq = ++this.requestSeq;
    this.isLoading = true;
    this.loadingSerial = sn;
    this.errorMessage = null;
    this.openDrawer();

    try {
      const baseUrl = await this.getApiBaseUrl();
      if (!baseUrl) {
        if (seq !== this.requestSeq) return;
        this.isLoading = false;
        this.errorMessage = 'Local backend server is not reachable. Launch via Launch_Dashboard.bat or server.py to query TestLink.';
        this.render();
        return;
      }

      const res = await fetch(`${baseUrl}/api/pfs/sn-route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: cfg.host,
          port: cfg.port,
          database: cfg.database,
          userId: creds.userId,
          password: creds.password,
          serialNumber: sn,
          itemNumber: String(itemNumber || '').trim(),
          productionOrder: poClean,
          forceFresh: Boolean(forceFresh)
        })
      });

      const { data } = await this._parseJsonResponse(res);
      if (seq !== this.requestSeq) return;

      if (!data) {
        this.isLoading = false;
        this.currentData = null;
        this.errorMessage = `Unexpected non-JSON response (HTTP ${res.status}).`;
        this.render();
        return;
      }

      if (data && data.authError) {
        this.clearSessionCreds();
        this.updateHeaderBadge();
        this.isLoading = false;
        this.pendingAction = () => this.lookupSerialNumber(sn, itemNumber, poClean, forceFresh);
        this.openLoginModal(data.error || 'PFS authentication failed. Please re-enter credentials.');
        this.render();
        return;
      }

      if (!res.ok || !data || data.ok === false) {
        this.isLoading = false;
        this.currentData = null;
        this.errorMessage = (data && data.error) ? data.error : `Server returned HTTP ${res.status}`;
        this.render();
        return;
      }

      this.isLoading = false;
      this.errorMessage = null;
      this.currentData = data;
      this.currentFromCache = false;

      if (data.found) {
        this.cache.set(cacheKey, data);
        if (data.selectedProductionOrder) {
          this.cache.set(`${cfg.database}|${sn.toUpperCase()}|${data.selectedProductionOrder.toUpperCase()}`, data);
        }
        if (data.resolvedSerialNumber && data.resolvedSerialNumber.toUpperCase() !== sn.toUpperCase()) {
          this.cache.set(`${cfg.database}|${data.resolvedSerialNumber.toUpperCase()}|${(data.selectedProductionOrder || '').toUpperCase()}`, data);
        }
        this.resetViewForNewResult(data);
      }

      this.render();
    } catch (err) {
      if (seq !== this.requestSeq) return;
      this.isLoading = false;
      this.currentData = null;
      this.errorMessage = `Network error contacting local backend: ${err.message || err}`;
      this.render();
    }
  }

  switchProductionOrder(newPo) {
    if (!this.currentData || !newPo) return;
    this.lookupSerialNumber(
      this.currentData.serialNumber,
      this.currentData.itemNumber || '',
      newPo,
      false
    );
  }

  refreshCurrent() {
    const targetSn = (this.currentData && this.currentData.serialNumber) || this.loadingSerial || (this.currentContext && this.currentContext.serialNo);
    if (!targetSn) return;
    const itemNo = (this.currentData && this.currentData.itemNumber) || (this.currentContext && this.currentContext.parentPartNo) || '';
    const po = (this.currentData && this.currentData.selectedProductionOrder) || '';
    this.lookupSerialNumber(targetSn, itemNo, po, true);
  }

  setSubTab(tabName) {
    if (tabName !== 'route' && tabName !== 'history' && tabName !== 'defects') return;
    this.activeTab = tabName;
    this.render();
  }

  setStepFilter(filterName) {
    if (this.activeTab !== 'route') {
      this.activeTab = 'route';
      this.stepFilter = filterName || 'all';
    } else if (this.stepFilter === filterName && filterName !== 'all') {
      this.stepFilter = 'all';
    } else {
      this.stepFilter = filterName || 'all';
    }
    this.render();
  }

  toggleStepExpand(encOpCode) {
    const opCode = decodeURIComponent(encOpCode || '');
    if (!opCode) return;
    if (this.expandedSteps.has(opCode)) {
      this.expandedSteps.delete(opCode);
    } else {
      this.expandedSteps.add(opCode);
    }
    this.render();
  }

  buildSummaryText(data) {
    if (!data || !data.found) return '';
    const s = data.summary || {};
    const dt = new Date(data.fetchedAt || Date.now());
    const pad = n => String(n).padStart(2, '0');
    const stamp = isNaN(dt.getTime())
      ? ''
      : `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;

    const parts = [];
    parts.push(`[PFS ${stamp || 'Live'}] PO ${data.selectedProductionOrder || 'N/A'}`);

    const statusLabelMap = {
      ACTIVE: 'ACTIVE',
      ACTIVE_WITH_FAILURE: 'ACTIVE (HAS FAILURE)',
      COMPLETE: 'COMPLETE',
      INACTIVE: 'INACTIVE',
      PO_HOLD: 'PO HOLD',
      BLOCKED: 'BLOCKED'
    };
    parts.push(`Status: ${statusLabelMap[data.overallStatus] || data.overallStatus}`);

    const reqActive = s.primaryActiveSteps || [];
    const optActive = s.optionalActiveSteps || [];
    if (reqActive.length > 0 && optActive.length > 0) {
      parts.push(`Active: ${reqActive.join(', ')} (+opt: ${optActive.join(', ')})`);
    } else if (reqActive.length > 0) {
      parts.push(`Active: ${reqActive.join(', ')}`);
    } else if (optActive.length > 0) {
      parts.push(`Active (Opt): ${optActive.join(', ')}`);
    } else if (data.overallStatus === 'COMPLETE') {
      parts.push('Active: None (Route Complete)');
    } else {
      parts.push('Active: None');
    }

    parts.push(`Passed: ${s.passedCount || 0}`);

    const failedList = s.failedSteps || [];
    if (failedList.length > 0) {
      parts.push(`Failed: ${failedList.length} (${failedList.join(', ')})`);
    } else {
      parts.push('Failed: 0');
    }

    const remReq = s.remainingRequiredSteps || [];
    const remOpt = s.remainingOptionalSteps || [];
    if (remReq.length > 0) {
      const optSuffix = remOpt.length > 0 ? ` + ${remOpt.length} opt` : '';
      parts.push(`Remaining: ${remReq.length} req${optSuffix} (${remReq.join(' -> ')})`);
    } else if (remOpt.length > 0) {
      parts.push(`Remaining: 0 req + ${remOpt.length} opt (${remOpt.join(', ')})`);
    } else {
      parts.push('Remaining: 0');
    }

    if ((s.openDefectCount || 0) > 0) {
      parts.push(`Open PFS Defects: ${s.openDefectCount}`);
    }

    return parts.join(' | ');
  }

  async copySummary() {
    const summaryText = this.buildSummaryText(this.currentData);
    if (!summaryText) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(summaryText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = summaryText;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      if (this.mp && typeof this.mp.showToast === 'function') {
        this.mp.showToast('📋 Copied PFS route summary to clipboard');
      }
    } catch (e) {
      if (this.mp && typeof this.mp.showToast === 'function') {
        this.mp.showToast('⚠️ Could not copy summary to clipboard');
      }
    }
  }

  async appendSummaryToMemo() {
    if (!this.currentContext || !this.currentData || !this.currentData.found) return;
    const summaryText = this.buildSummaryText(this.currentData);
    if (!summaryText || !window.dataStore) return;

    const ctx = this.currentContext;
    const sn = (ctx.serialNo || '').trim();
    const dt = (ctx.faDate || '').trim();
    const ref = (ctx.refDes || '').trim();
    const desc = (ctx.defectDescription || '').trim();
    const key4 = `${sn}_${dt}_${ref}_${desc}`;
    const key2 = `${sn}_${dt}`;

    const currentAnn = (window.dataStore.annotationsMap && (window.dataStore.annotationsMap[key4] || window.dataStore.annotationsMap[key2])) || {};
    const existingMemo = (currentAnn.fixComment || '').trim();
    const updatedMemo = existingMemo ? `${existingMemo}\n${summaryText}` : summaryText;

    await window.dataStore.updateFixAnnotation(
      ctx.serialNo,
      ctx.faDate,
      currentAnn.confirmedFix || 'Pending',
      updatedMemo,
      ctx.refDes,
      ctx.defectDescription
    );

    // Sync any currently open Record Details modal textarea
    const modal = document.getElementById('record-comments-modal');
    if (modal && modal.style.display === 'flex') {
      const ta = modal.querySelector('.fix-comment-textarea');
      if (ta) ta.value = updatedMemo;
    }

    if (this.mp && typeof this.mp.showToast === 'function') {
      this.mp.showToast('⚡ Appended PFS route summary to Solution Memo');
    }
  }

  _getStatusBadgeMeta(overallStatus) {
    const map = {
      ACTIVE: { label: 'ACTIVE', cls: 'active' },
      ACTIVE_WITH_FAILURE: { label: 'ACTIVE · PRIOR FAIL', cls: 'warn' },
      COMPLETE: { label: 'ROUTE COMPLETE', cls: 'complete' },
      INACTIVE: { label: 'INACTIVE', cls: 'danger' },
      PO_HOLD: { label: 'PO HOLD', cls: 'danger' },
      BLOCKED: { label: 'BLOCKED', cls: 'danger' }
    };
    return map[overallStatus] || { label: overallStatus || 'UNKNOWN', cls: 'muted' };
  }

  _renderStepBadges(step) {
    const badges = [];
    const cls = step.classification;
    if (cls === 'active') {
      if (step.isRequired) {
        badges.push('<span class="pfs-badge pfs-badge-active"><span class="pfs-pulse-dot"></span> ACTIVE</span>');
      } else {
        badges.push('<span class="pfs-badge pfs-badge-opt-active">ELIGIBLE (OPT)</span>');
      }
    } else if (cls === 'failed') {
      badges.push('<span class="pfs-badge pfs-badge-failed">FAILED</span>');
      if (step.isActive) {
        badges.push('<span class="pfs-badge pfs-badge-active">ACTIVE</span>');
      }
    } else if (cls === 'passed') {
      badges.push('<span class="pfs-badge pfs-badge-passed">PASSED</span>');
      if ((step.priorFailCount || 0) > 0) {
        const failLabel = step.priorFailCount === 1 ? '1 prior fail' : `${step.priorFailCount} prior fails`;
        badges.push(`<span class="pfs-badge pfs-badge-prior-fail">${failLabel}</span>`);
      }
      if (step.isActive) {
        badges.push('<span class="pfs-badge pfs-badge-opt-active">ELIGIBLE</span>');
      }
    } else if (cls === 'skipped') {
      badges.push('<span class="pfs-badge pfs-badge-skipped">SKIPPED (OPT)</span>');
    } else {
      badges.push('<span class="pfs-badge pfs-badge-remaining">REMAINING</span>');
    }

    const typeCls = step.isOptional ? 'pfs-type-optional' : 'pfs-type-required';
    const typeText = step.stepType || (step.isOptional ? 'MAY_VISIT' : 'MUST_PASS');
    badges.push(`<span class="pfs-step-type-pill ${typeCls}">${this.escapeHtml(typeText)}</span>`);
    return badges.join('');
  }

  _renderRouteTabHtml(data) {
    const steps = data.routeSteps || [];
    const s = data.summary || {};

    const counts = {
      all: steps.length,
      active: steps.filter(st => st.isActive).length,
      failed: steps.filter(st => st.classification === 'failed').length,
      passed: steps.filter(st => st.classification === 'passed').length,
      remaining: steps.filter(st => st.classification === 'remaining').length,
      skipped: steps.filter(st => st.classification === 'skipped').length
    };

    const filterChips = [
      { key: 'all', label: `All (${counts.all})` },
      { key: 'active', label: `Active (${counts.active})` },
      { key: 'failed', label: `Failed (${counts.failed})` },
      { key: 'passed', label: `Passed (${counts.passed})` },
      { key: 'remaining', label: `Remaining (${counts.remaining})` }
    ];
    if (counts.skipped > 0) {
      filterChips.push({ key: 'skipped', label: `Skipped Opt (${counts.skipped})` });
    }

    const chipsHtml = filterChips.map(fc => `
      <button type="button" class="pfs-filter-chip ${this.stepFilter === fc.key ? 'active' : ''}" onclick="window.mainPanel.pfsRouteDrawer.setStepFilter('${fc.key}')">
        ${fc.label}
      </button>
    `).join('');

    const filteredSteps = steps.filter(st => {
      if (this.stepFilter === 'all') return true;
      if (this.stepFilter === 'active') return st.isActive;
      return st.classification === this.stepFilter;
    });

    let stepsHtml = '';
    if (filteredSteps.length === 0) {
      stepsHtml = `<div class="pfs-empty-tab">No route operations match the <strong>${this.escapeHtml(this.stepFilter)}</strong> filter.</div>`;
    } else {
      stepsHtml = filteredSteps.map(step => {
        const isExpanded = this.expandedSteps.has(step.operationCode);
        const encOp = this.safeParam(step.operationCode);
        const lv = step.latestVisit;
        let subLine = '';
        if (lv) {
          const who = [lv.workCenter, lv.operatorId].filter(Boolean).join(' · ');
          subLine = `<div class="pfs-step-visit-preview">Latest: <strong>${this.escapeHtml(lv.outcome)}</strong> ${lv.createDate ? `on ${this.escapeHtml(lv.createDate)}` : ''}${who ? ` (${this.escapeHtml(who)})` : ''}</div>`;
        } else if (step.queryStatus === 'Warning' && step.queryMessage) {
          subLine = `<div class="pfs-step-visit-preview pfs-warn-text">${this.escapeHtml(step.queryMessage)}</div>`;
        } else if (step.isActive) {
          subLine = `<div class="pfs-step-visit-preview pfs-active-text">PfsQuery eligible — ready for processing</div>`;
        }

        let detailsHtml = '';
        if (isExpanded) {
          const metaItems = [
            step.operationType ? `<span><strong>Op Type:</strong> ${this.escapeHtml(step.operationType)}</span>` : '',
            step.stationType ? `<span><strong>Station:</strong> ${this.escapeHtml(step.stationType)}</span>` : '',
            step.routeVerification ? `<span><strong>Verification:</strong> ${this.escapeHtml(step.routeVerification)}</span>` : ''
          ].filter(Boolean).join('');

          const qBadgeCls = step.isActive ? 'ok' : 'blocked';
          const qMsg = step.queryMessage || (step.isActive ? 'Unit is eligible for this operation.' : 'Blocked / not eligible.');
          const visits = step.visits || [];
          const visitsHtml = visits.length === 0
            ? `<div class="pfs-no-visits">No recorded visits on this PO route step.</div>`
            : visits.map((v, idx) => `
              <div class="pfs-attempt-row">
                <span class="pfs-attempt-outcome ${v.outcome === 'Fail' ? 'fail' : 'pass'}">${this.escapeHtml(v.outcome)}</span>
                <span class="pfs-attempt-meta mono">${this.escapeHtml(v.createDate || 'Unknown time')}</span>
                ${v.workCenter ? `<span class="pfs-attempt-wc">${this.escapeHtml(v.workCenter)}</span>` : ''}
                ${v.operatorId ? `<span class="pfs-attempt-op">by ${this.escapeHtml(v.operatorId)}</span>` : ''}
                ${idx === 0 ? '<span class="pfs-latest-tag">Latest</span>' : ''}
                ${v.historyComment ? `<div class="pfs-attempt-comment">${this.escapeHtml(v.historyComment)}</div>` : ''}
              </div>
            `).join('');

          detailsHtml = `
            <div class="pfs-step-details">
              ${metaItems ? `<div class="pfs-step-meta-row">${metaItems}</div>` : ''}
              <div class="pfs-query-probe-box ${qBadgeCls}">
                <strong>PfsQuery (${this.escapeHtml(step.queryStatus)}):</strong>
                <span>${this.escapeHtml(qMsg)}</span>
              </div>
              <div class="pfs-attempts-list">
                <div class="pfs-attempts-title">Station Visits (${visits.length})</div>
                ${visitsHtml}
              </div>
            </div>
          `;
        }

        const cardCls = `pfs-step-card status-${step.classification}${step.isActive ? ' is-active-query' : ''}`;
        return `
          <div class="${cardCls}">
            <div class="pfs-step-header" onclick="window.mainPanel.pfsRouteDrawer.toggleStepExpand('${encOp}')">
              <div class="pfs-step-order-badge">#${this.escapeHtml(step.stepOrder)}</div>
              <div class="pfs-step-main">
                <div class="pfs-step-title-row">
                  <span class="pfs-step-opcode mono">${this.escapeHtml(step.operationCode)}</span>
                  <div class="pfs-step-badges">${this._renderStepBadges(step)}</div>
                </div>
                ${step.operationDesc ? `<div class="pfs-step-desc">${this.escapeHtml(step.operationDesc)}</div>` : ''}
                ${subLine}
              </div>
              <div class="pfs-step-chevron">${isExpanded ? '&#9662;' : '&#9656;'}</div>
            </div>
            ${detailsHtml}
          </div>
        `;
      }).join('');
    }

    return `
      <div class="pfs-filter-bar">${chipsHtml}</div>
      <div class="pfs-steps-list">${stepsHtml}</div>
    `;
  }

  _renderHistoryTabHtml(data) {
    const history = data.history || [];
    if (history.length === 0) {
      return '<div class="pfs-empty-tab">No visit history returned by <code>PfsGetSnHistory</code> for this serial number.</div>';
    }
    return `
      <div class="pfs-history-list">
        ${history.map(h => {
          const outcomeCls = h.outcome === 'Fail' ? 'fail' : (h.outcome === 'Pass' ? 'pass' : 'visited');
          const offRouteTag = !h.onCurrentRoute
            ? `<span class="pfs-badge pfs-badge-offroute">${h.matchesSelectedPo ? 'Off-Route' : `PO: ${this.escapeHtml(h.srcProductionOrder)}`}</span>`
            : '';
          return `
            <div class="pfs-history-card ${outcomeCls}">
              <div class="pfs-history-top">
                <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                  <span class="pfs-attempt-outcome ${outcomeCls}">${this.escapeHtml(h.outcome)}</span>
                  <span class="mono" style="font-weight:700; color:var(--text-primary);">${this.escapeHtml(h.srcOperationCode || 'N/A')}</span>
                  ${offRouteTag}
                </div>
                <span class="mono" style="font-size:0.74rem; color:var(--text-muted);">${this.escapeHtml(h.createDate || '')}</span>
              </div>
              <div class="pfs-history-meta">
                ${h.workCenter ? `<span><strong>Work Center:</strong> ${this.escapeHtml(h.workCenter)}</span>` : ''}
                ${h.operatorId ? `<span><strong>Operator:</strong> ${this.escapeHtml(h.operatorId)}</span>` : ''}
                ${h.srcProductionOrder ? `<span><strong>PO:</strong> ${this.escapeHtml(h.srcProductionOrder)}</span>` : ''}
              </div>
              ${h.historyComment ? `<div class="pfs-history-comment">${this.escapeHtml(h.historyComment)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderDefectsTabHtml(data) {
    const defects = data.defects || [];
    if (defects.length === 0) {
      return '<div class="pfs-empty-tab">No defect records returned by <code>PfsGetSnDefects</code> for this serial number.</div>';
    }
    return `
      <div class="pfs-defects-list">
        ${defects.map(d => {
          const repCls = d.isRepaired ? 'repaired' : 'open';
          const repLabel = d.isRepaired ? 'REPAIRED' : 'OPEN';
          const badgeTitle = `PFS IS_REPAIRED: ${d.isRepairedRaw || 'blank'}${d.repairCode ? ` | Repair Code: ${d.repairCode}` : ''}`;
          const formatNote = text => (String(text).includes('\n') ? '<br/>' : ' ') + this.escapeHtml(text);
          return `
            <div class="pfs-defect-card ${repCls}">
              <div class="pfs-defect-top">
                <div style="display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap;">
                  <span class="pfs-badge ${d.isRepaired ? 'pfs-badge-passed' : 'pfs-badge-failed'}" title="${this.escapeHtml(badgeTitle)}">${repLabel}</span>
                  <span class="mono" style="font-weight:700;">${this.escapeHtml(d.srcOperationCode || 'N/A')}</span>
                  ${d.refDes ? `<span class="tag">Ref: ${this.escapeHtml(d.refDes)}</span>` : ''}
                  ${d.defectCode ? `<span class="tag">${this.escapeHtml(d.defectCode)}</span>` : ''}
                </div>
                ${d.defectQuantity ? `<span class="mono" style="font-size:0.75rem; color:var(--text-muted);">Qty: ${this.escapeHtml(d.defectQuantity)}</span>` : ''}
              </div>
              <div class="pfs-history-meta">
                ${d.failureCode ? `<span><strong>Failure:</strong> ${this.escapeHtml(d.failureCode)}</span>` : ''}
                ${d.failureOrigin ? `<span><strong>Origin:</strong> ${this.escapeHtml(d.failureOrigin)}</span>` : ''}
                ${d.compItemNumber ? `<span><strong>Comp:</strong> ${this.escapeHtml(d.compItemNumber)}</span>` : ''}
                ${d.repairCode ? `<span><strong>Repair Code:</strong> ${this.escapeHtml(d.repairCode)}</span>` : ''}
                ${d.repairTech ? `<span><strong>Repair Tech:</strong> ${this.escapeHtml(d.repairTech)}</span>` : ''}
              </div>
              ${d.failureComment ? `<div class="pfs-defect-note amber"><strong>Failure:</strong>${formatNote(d.failureComment)}</div>` : ''}
              ${d.debugComment ? `<div class="pfs-defect-note blue"><strong>Debug${d.debugTech ? ` (${this.escapeHtml(d.debugTech)})` : ''}:</strong>${formatNote(d.debugComment)}</div>` : ''}
              ${d.repairComment ? `<div class="pfs-defect-note purple"><strong>Repair${d.repairTech ? ` (${this.escapeHtml(d.repairTech)})` : ''}:</strong>${formatNote(d.repairComment)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  _renderAlertsHtml(data) {
    const blocks = [];
    const statuses = data.snStatuses || [];
    if (statuses.length > 0) {
      const items = statuses.map(st => `
        <div class="pfs-alert-item">
          <strong>${this.escapeHtml(st.status || 'INACTIVE')}</strong>
          ${st.operationCode ? ` at <code>${this.escapeHtml(st.operationCode)}</code>` : ''}
          ${st.date ? ` (${this.escapeHtml(st.date)})` : ''}
          ${st.user ? ` by ${this.escapeHtml(st.user)}` : ''}
          ${st.comments ? `<div class="pfs-alert-comment">${this.escapeHtml(st.comments)}</div>` : ''}
        </div>
      `).join('');
      blocks.push(`<div class="pfs-alert-banner danger"><div class="pfs-alert-title">&#9888; Serial Number Status / Inactivation</div>${items}</div>`);
    }

    const po = data.poInfo || {};
    if (po.stopProductionFlag) {
      blocks.push(`
        <div class="pfs-alert-banner danger">
          <div class="pfs-alert-title">&#9940; Production Order Hold (STOP_PRODUCTION)</div>
          <div class="pfs-alert-item">
            ${po.STOP_PRODUCTION_OPCODE ? `Opcode: <code>${this.escapeHtml(po.STOP_PRODUCTION_OPCODE)}</code> ` : ''}
            ${this.escapeHtml(po.STOP_PRODUCTION_COMMENT || po.STOP_PRODUCTION_OPCODE_COMMENT || 'Production is stopped on this PO.')}
          </div>
        </div>
      `);
    }
    if (po.stopShipFlag) {
      blocks.push(`
        <div class="pfs-alert-banner warn">
          <div class="pfs-alert-title">&#9888; Shipping Hold (STOP_SHIP)</div>
          <div class="pfs-alert-item">${this.escapeHtml(po.STOP_SHIP_COMMENT || 'Shipping is held for this Production Order.')}</div>
        </div>
      `);
    }

    const warnings = data.warnings || [];
    if (warnings.length > 0) {
      blocks.push(`
        <div class="pfs-alert-banner info">
          <div class="pfs-alert-title">Server Notices (${warnings.length})</div>
          ${warnings.map(w => `<div class="pfs-alert-item">${this.escapeHtml(w)}</div>`).join('')}
        </div>
      `);
    }

    return blocks.join('');
  }

  _renderActiveCalloutHtml(data) {
    const s = data.summary || {};
    const reqActive = s.primaryActiveSteps || [];
    const optActive = s.optionalActiveSteps || [];

    if (reqActive.length > 0) {
      const optNote = optActive.length > 0
        ? `<div class="pfs-callout-sub">Optional eligible (<code>MAY_VISIT</code>): ${optActive.map(op => `<code>${this.escapeHtml(op)}</code>`).join(', ')}</div>`
        : '';
      return `
        <div class="pfs-active-callout primary">
          <div class="pfs-callout-label"><span class="pfs-pulse-dot"></span> Active Required Operation${reqActive.length > 1 ? 's' : ''} (<code>PfsQuery = OK</code>)</div>
          <div class="pfs-callout-ops">${reqActive.map(op => `<span class="pfs-callout-op-pill">${this.escapeHtml(op)}</span>`).join('')}</div>
          ${optNote}
        </div>
      `;
    }

    if (optActive.length > 0) {
      return `
        <div class="pfs-active-callout optional">
          <div class="pfs-callout-label">Eligible Optional Operation${optActive.length > 1 ? 's' : ''} (<code>MAY_VISIT</code>)</div>
          <div class="pfs-callout-ops">${optActive.map(op => `<span class="pfs-callout-op-pill opt">${this.escapeHtml(op)}</span>`).join('')}</div>
        </div>
      `;
    }

    if (data.overallStatus === 'COMPLETE') {
      return `
        <div class="pfs-active-callout complete">
          <div class="pfs-callout-label">&#10003; All Required Route Steps Passed</div>
          <div class="pfs-callout-sub">No active or remaining required operations on PO ${this.escapeHtml(data.selectedProductionOrder)}.</div>
        </div>
      `;
    }

    return `
      <div class="pfs-active-callout blocked">
        <div class="pfs-callout-label">&#9888; No Active Route Step (<code>PfsQuery</code> Blocked)</div>
        <div class="pfs-callout-sub">Review failed operations, SN inactivation status, or PO holds below.</div>
      </div>
    `;
  }

  renderBodyHtml() {
    if (this.isLoading) {
      return `
        <div class="pfs-state-box">
          <div class="loader-spinner" style="width:32px; height:32px; margin:0 auto 0.75rem auto;"></div>
          <div style="font-weight:600; color:var(--text-primary);">Querying TestLink (PfsGet* &amp; PfsQuery)...</div>
          <div class="mono" style="font-size:0.82rem; color:var(--accent-amber); margin-top:0.35rem;">SN: ${this.escapeHtml(this.loadingSerial)}</div>
        </div>
      `;
    }

    if (this.errorMessage) {
      return `
        <div class="pfs-alert-banner danger" style="margin-top:0.5rem;">
          <div class="pfs-alert-title">&#9888; PFS Lookup Error</div>
          <div class="pfs-alert-item">${this.escapeHtml(this.errorMessage)}</div>
          <div style="display:flex; gap:0.5rem; margin-top:0.75rem;">
            <button type="button" class="btn btn-sm btn-primary" onclick="window.mainPanel.pfsRouteDrawer.refreshCurrent()">Retry</button>
            <button type="button" class="btn btn-sm" onclick="window.mainPanel.openPfsLoginModal()">PFS Settings</button>
          </div>
        </div>
      `;
    }

    if (!this.currentData) {
      const creds = this.getSessionCreds();
      return `
        <div class="pfs-state-box">
          <div style="font-size:1.75rem; margin-bottom:0.5rem;">&#128269;</div>
          <div style="font-weight:600; color:var(--text-primary); margin-bottom:0.35rem;">Inspect Serial Number Route</div>
          <div style="font-size:0.82rem; color:var(--text-muted); line-height:1.45;">
            Enter a serial number above or click the <strong>PFS</strong> button on any defect record to view passed, failed, active, and remaining route operations.
          </div>
          ${!creds ? `<button type="button" class="btn btn-primary btn-sm" style="margin-top:1rem;" onclick="window.mainPanel.openPfsLoginModal()">Sign In to PFS</button>` : ''}
        </div>
      `;
    }

    const data = this.currentData;
    if (!data.found) {
      return `
        <div class="pfs-alert-banner warn" style="margin-top:0.5rem;">
          <div class="pfs-alert-title">Serial Number Not Found in ${this.escapeHtml(data.database || 'PFS')}</div>
          <div class="pfs-alert-item">
            SN: <code class="mono">${this.escapeHtml(data.serialNumber)}</code><br/>
            ${this.escapeHtml(data.error || 'No Production Order or route history matched this serial number.')}
          </div>
          <div style="display:flex; gap:0.5rem; margin-top:0.75rem;">
            <button type="button" class="btn btn-sm" onclick="window.mainPanel.openPfsLoginModal()">Switch Site / DB</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="window.mainPanel.pfsRouteDrawer.refreshCurrent()">Retry Live</button>
          </div>
        </div>
      `;
    }

    const s = data.summary || {};
    const po = data.poInfo || {};
    const pos = data.productionOrders || [];
    const statusMeta = this._getStatusBadgeMeta(data.overallStatus);
    const hasLinkedContext = Boolean(
      this.currentContext &&
      this.currentContext.serialNo &&
      this.currentContext.serialNo.trim().toUpperCase() === (data.serialNumber || '').trim().toUpperCase()
    );

    const contextBarHtml = hasLinkedContext ? `
      <div class="pfs-defect-context-bar">
        <div class="pfs-defect-context-info">
          <strong>Linked Record:</strong>
          <span>${this.escapeHtml(this.currentContext.parentPartNo || 'N/A')} &middot; ${this.escapeHtml(this.currentContext.processRecorded || 'N/A')} &middot; ${this.escapeHtml(this.currentContext.refDes || 'N/A')}</span>
        </div>
        <div class="pfs-defect-context-actions">
          <button type="button" class="btn btn-sm" onclick="window.mainPanel.pfsRouteDrawer.copySummary()" title="Copy one-line PFS summary">Copy Summary</button>
          <button type="button" class="btn btn-sm pfs-btn-append-memo" onclick="window.mainPanel.pfsRouteDrawer.appendSummaryToMemo()" title="Append PFS route summary to this defect record's Solution Memo">+ Solution Memo</button>
        </div>
      </div>
    ` : '';

    const poSelectorHtml = pos.length > 1
      ? `<select class="pfs-po-select mono" onchange="window.mainPanel.pfsRouteDrawer.switchProductionOrder(this.value)">
          ${pos.map(p => `<option value="${this.escapeHtml(p.PRODUCTION_ORDER)}" ${p.PRODUCTION_ORDER === data.selectedProductionOrder ? 'selected' : ''}>${this.escapeHtml(p.PRODUCTION_ORDER)} (${this.escapeHtml(p.COMP_ITEM_NUMBER || 'Item')})</option>`).join('')}
         </select>`
      : `<span class="mono" style="font-weight:700; color:var(--accent-blue);">${this.escapeHtml(data.selectedProductionOrder || 'N/A')}</span>`;

    const fetchedDate = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    const cacheTag = this.currentFromCache
      ? '<span class="pfs-cache-pill cached">Cached</span>'
      : `<span class="pfs-cache-pill live">Live${data.cacheBypassed ? ' (Fresh)' : ''}</span>`;

    const remSub = (s.remainingOptionalCount || 0) > 0
      ? `${s.remainingRequiredCount || 0} req + ${s.remainingOptionalCount} opt`
      : `${s.remainingRequiredCount || 0} required`;

    let tabBodyHtml = '';
    if (this.activeTab === 'route') {
      tabBodyHtml = this._renderRouteTabHtml(data);
    } else if (this.activeTab === 'history') {
      tabBodyHtml = this._renderHistoryTabHtml(data);
    } else {
      tabBodyHtml = this._renderDefectsTabHtml(data);
    }

    return `
      ${contextBarHtml}

      <div class="pfs-unit-summary-card">
        <div class="pfs-unit-top-row">
          <div>
            <div class="pfs-unit-sn-row">
              <span class="pfs-unit-sn mono">${this.escapeHtml(data.serialNumber)}</span>
              ${data.resolvedSerialNumber && data.resolvedSerialNumber !== data.serialNumber
                ? `<span class="tag" title="Resolved PFS Serial Number">PFS SN: ${this.escapeHtml(data.resolvedSerialNumber)}</span>` : ''}
            </div>
            <div class="pfs-unit-item-row">
              <span>Item: <strong class="mono">${this.escapeHtml(data.itemNumber || 'N/A')}</strong></span>
              ${po.CUST_ITEM_REV ? `<span>Rev: <strong>${this.escapeHtml(po.CUST_ITEM_REV)}</strong></span>` : ''}
            </div>
          </div>
          <div style="display:flex; flex-direction:column; align-items:flex-end; gap:0.35rem;">
            <span class="pfs-overall-badge ${statusMeta.cls}">${this.escapeHtml(statusMeta.label)}</span>
            <div style="display:flex; align-items:center; gap:0.35rem; font-size:0.72rem; color:var(--text-muted);">
              ${cacheTag}
              ${fetchedDate ? `<span>${this.escapeHtml(fetchedDate)}</span>` : ''}
              ${!hasLinkedContext ? `<button type="button" class="pfs-inline-copy-btn" onclick="window.mainPanel.pfsRouteDrawer.copySummary()" title="Copy PFS Summary">Copy</button>` : ''}
            </div>
          </div>
        </div>

        <div class="pfs-po-row">
          <div><strong>PO:</strong> ${poSelectorHtml}</div>
          ${po.WORK_ORDER ? `<div><strong>WO:</strong> <span class="mono">${this.escapeHtml(po.WORK_ORDER)}</span></div>` : ''}
          ${po.QUANTITY ? `<div><strong>Qty:</strong> ${this.escapeHtml(po.QUANTITY)}</div>` : ''}
          ${po.RELEASE_DATE ? `<div><strong>Rel:</strong> ${this.escapeHtml(po.RELEASE_DATE)}</div>` : ''}
        </div>
      </div>

      ${this._renderAlertsHtml(data)}
      ${this._renderActiveCalloutHtml(data)}

      <div class="pfs-kpi-grid">
        <button type="button" class="pfs-kpi-card passed ${this.stepFilter === 'passed' && this.activeTab === 'route' ? 'selected' : ''}" onclick="window.mainPanel.pfsRouteDrawer.setStepFilter('passed')">
          <div class="pfs-kpi-val">${s.passedCount || 0}</div>
          <div class="pfs-kpi-lbl">Passed</div>
        </button>
        <button type="button" class="pfs-kpi-card failed ${this.stepFilter === 'failed' && this.activeTab === 'route' ? 'selected' : ''}" onclick="window.mainPanel.pfsRouteDrawer.setStepFilter('failed')">
          <div class="pfs-kpi-val">${s.failedCount || 0}</div>
          <div class="pfs-kpi-lbl">Failed</div>
        </button>
        <button type="button" class="pfs-kpi-card active ${this.stepFilter === 'active' && this.activeTab === 'route' ? 'selected' : ''}" onclick="window.mainPanel.pfsRouteDrawer.setStepFilter('active')">
          <div class="pfs-kpi-val">${s.activeCount || 0}</div>
          <div class="pfs-kpi-lbl">Active</div>
        </button>
        <button type="button" class="pfs-kpi-card remaining ${this.stepFilter === 'remaining' && this.activeTab === 'route' ? 'selected' : ''}" onclick="window.mainPanel.pfsRouteDrawer.setStepFilter('remaining')">
          <div class="pfs-kpi-val">${s.remainingRequiredCount || 0}</div>
          <div class="pfs-kpi-lbl">Remaining</div>
          <div class="pfs-kpi-sub">${this.escapeHtml(remSub)}</div>
        </button>
      </div>

      <div class="pfs-subtabs">
        <button type="button" class="pfs-subtab-btn ${this.activeTab === 'route' ? 'active' : ''}" onclick="window.mainPanel.pfsRouteDrawer.setSubTab('route')">
          Route Steps (${s.totalSteps || 0})
        </button>
        <button type="button" class="pfs-subtab-btn ${this.activeTab === 'history' ? 'active' : ''}" onclick="window.mainPanel.pfsRouteDrawer.setSubTab('history')">
          History (${(data.history || []).length})
        </button>
        <button type="button" class="pfs-subtab-btn ${this.activeTab === 'defects' ? 'active' : ''}" onclick="window.mainPanel.pfsRouteDrawer.setSubTab('defects')">
          PFS Defects (${s.openDefectCount || 0} open / ${s.totalDefectCount || 0})
        </button>
      </div>

      <div class="pfs-subtab-content">${tabBodyHtml}</div>
    `;
  }

  render() {
    const drawer = document.getElementById('pfs-route-drawer');
    if (!drawer) return;

    const cfg = this.getConfig();
    const creds = this.getSessionCreds();
    const activeSnValue = (this.currentData && this.currentData.serialNumber) || this.loadingSerial || '';

    drawer.innerHTML = `
      <div class="pfs-drawer-header">
        <div class="pfs-drawer-title-bar">
          <div style="display:flex; align-items:center; gap:0.5rem; min-width:0;">
            <span class="pfs-drawer-icon">&#9095;</span>
            <div>
              <h3 class="pfs-drawer-title">PFS Route Inspector</h3>
              <div class="pfs-drawer-subtitle">${this.escapeHtml(cfg.database)} &middot; ${creds ? this.escapeHtml(creds.userId) : 'Not signed in'}</div>
            </div>
          </div>
          <div class="pfs-drawer-actions">
            <button type="button" class="icon-btn" onclick="window.mainPanel.openPfsLoginModal()" title="PFS Login &amp; Site Settings">&#9881;</button>
            <button type="button" class="icon-btn" onclick="window.mainPanel.pfsRouteDrawer.refreshCurrent()" title="Refresh Live from PFS (Bypass Cache)" ${!(this.currentData || this.loadingSerial) ? 'disabled' : ''}>&#8635;</button>
            <button type="button" class="icon-btn" onclick="window.mainPanel.closePfsDrawer()" title="Close Drawer (ESC)">&times;</button>
          </div>
        </div>

        <form class="pfs-manual-search-form" onsubmit="window.mainPanel.pfsRouteDrawer.handleManualSubmit(event)">
          <input type="text" id="pfs-manual-sn-input" class="input-field pfs-manual-input mono" value="${this.escapeHtml(activeSnValue)}" placeholder="Enter Serial Number to query PFS..." />
          <button type="submit" class="btn btn-primary btn-sm">Lookup</button>
        </form>
      </div>

      <div class="pfs-drawer-body">
        ${this.renderBodyHtml()}
      </div>
    `;

    if (window.lucide) window.lucide.createIcons({ el: drawer });
  }
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.PfsRouteDrawer = PfsRouteDrawer;
