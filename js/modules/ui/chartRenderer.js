/**
 * ChartRenderer - Canvas-based Timeline trend and Pareto 80/20 analysis charts.
 * Supports dual metric modes (Defect Quantity vs Unique SNs), hover tooltips, and PNG/clipboard exports.
 */
class ChartRenderer {
  constructor(mainPanel) {
    this.mp = mainPanel;
    this.chartHitboxes = [];
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

  setTimelineMetric(metric) {
    this.mp.timelineMetric = metric === 'uniqueSN' ? 'uniqueSN' : 'defects';
    try {
      localStorage.setItem('DEFECT_APP_TIMELINE_METRIC', this.mp.timelineMetric);
    } catch (e) {}
    const isSN = this.mp.timelineMetric === 'uniqueSN';
    const btnDefects = document.getElementById('timeline-metric-btn-defects');
    const btnSN = document.getElementById('timeline-metric-btn-uniquesn');
    if (btnDefects) btnDefects.classList.toggle('active', !isSN);
    if (btnSN) btnSN.classList.toggle('active', isSN);
    this.renderTimelineChart(window.dataStore ? window.dataStore.getActiveRecords() : []);
  }

  setParetoMetric(metric) {
    this.mp.paretoMetric = metric === 'uniqueSN' ? 'uniqueSN' : 'defects';
    try {
      localStorage.setItem('DEFECT_APP_PARETO_METRIC', this.mp.paretoMetric);
    } catch (e) {}
    const isSN = this.mp.paretoMetric === 'uniqueSN';
    const btnDefects = document.getElementById('pareto-metric-btn-defects');
    const btnSN = document.getElementById('pareto-metric-btn-uniquesn');
    if (btnDefects) btnDefects.classList.toggle('active', !isSN);
    if (btnSN) btnSN.classList.toggle('active', isSN);
    this.renderParetoChart(window.dataStore ? window.dataStore.getActiveRecords() : []);
  }

  setChartMetric(metric) {
    if (this.mp.activeTab === 'pareto') {
      this.setParetoMetric(metric);
    } else {
      this.setTimelineMetric(metric);
    }
  }

  setParetoGrouping(dimension) {
    this.mp.paretoGrouping = dimension || 'defectDescription';
    const map = {
      'defectDescription': 'pareto-grp-defect',
      'refDes': 'pareto-grp-refdes',
      'processRecorded': 'pareto-grp-process',
      'parentPartNo': 'pareto-grp-part'
    };
    Object.keys(map).forEach(dim => {
      const btn = document.getElementById(map[dim]);
      if (btn) btn.classList.toggle('active', this.mp.paretoGrouping === dim);
    });
    this.renderParetoChart(window.dataStore ? window.dataStore.getActiveRecords() : []);
  }

  setChartGranularity(mode) {
    this.mp.chartGranularity = mode || 'auto';
    ['auto', 'daily', 'weekly', 'monthly'].forEach(m => {
      const btn = document.getElementById(`gran-btn-${m}`);
      if (btn) btn.classList.toggle('active', this.mp.chartGranularity === m);
    });
    this.renderTimelineChart(window.dataStore ? window.dataStore.getActiveRecords() : []);
  }

  renderTimelineChart(records) {
    const canvas = document.getElementById('timeline-chart-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('timeline-canvas-wrapper');
    const legendContainer = document.getElementById('timeline-legend-container');
    const heading = document.getElementById('timeline-chart-heading');
    const subheading = document.getElementById('timeline-chart-subheading');

    const isSNMode = this.mp.timelineMetric === 'uniqueSN';
    const btnDefects = document.getElementById('timeline-metric-btn-defects');
    const btnSN = document.getElementById('timeline-metric-btn-uniquesn');
    if (btnDefects) btnDefects.classList.toggle('active', !isSNMode);
    if (btnSN) btnSN.classList.toggle('active', isSNMode);

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

    let mode = this.mp.chartGranularity || 'auto';
    if (mode === 'auto') {
      const timeSpanDays = Math.max(1, (endD.getTime() - startD.getTime()) / (1000 * 3600 * 24));
      if (timeSpanDays <= 31) mode = 'daily';
      else if (timeSpanDays <= 180) mode = 'weekly';
      else mode = 'monthly';
    }

    const pad = n => String(n).padStart(2, '0');
    const getBucketKey = d => {
      const y = d.getFullYear();
      const m = pad(d.getMonth() + 1);
      const day = pad(d.getDate());
      if (mode === 'daily') return `${y}-${m}-${day}`;
      if (mode === 'monthly') return `${y}-${m}`;
      const dayOfWeek = d.getDay();
      const diff = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
    };

    const getBucketLabel = key => {
      if (mode === 'monthly') {
        const parts = key.split('-');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${monthNames[parseInt(parts[1], 10) - 1]} ${parts[0]}`;
      }
      if (mode === 'weekly') {
        const parts = key.split('-');
        return `Wk of ${parts[1]}/${parts[2]}`;
      }
      const parts = key.split('-');
      return `${parts[1]}/${parts[2]}`;
    };

    const bucketKeys = [];
    const curr = new Date(startD);
    curr.setHours(0, 0, 0, 0);
    const endBoundary = new Date(endD);
    endBoundary.setHours(23, 59, 59, 999);

    while (curr <= endBoundary) {
      const k = getBucketKey(curr);
      if (!bucketKeys.includes(k)) bucketKeys.push(k);
      if (mode === 'monthly') curr.setMonth(curr.getMonth() + 1);
      else if (mode === 'weekly') curr.setDate(curr.getDate() + 7);
      else curr.setDate(curr.getDate() + 1);
    }

    if (bucketKeys.length === 0) bucketKeys.push(getBucketKey(startD));

    const buckets = {};
    bucketKeys.forEach(k => {
      buckets[k] = {
        dateLabel: getBucketLabel(k),
        totalQty: 0,
        subBreakdown: {},
        subBreakdownSN: {},
        uniqueSnSet: new Set()
      };
    });

    parsedRecords.forEach(r => {
      const k = getBucketKey(r.date);
      if (!buckets[k]) {
        buckets[k] = {
          dateLabel: getBucketLabel(k),
          totalQty: 0,
          subBreakdown: {},
          subBreakdownSN: {},
          uniqueSnSet: new Set()
        };
        bucketKeys.push(k);
      }
      buckets[k].totalQty += r.qty;
      buckets[k].subBreakdown[r.subName] = (buckets[k].subBreakdown[r.subName] || 0) + r.qty;
      if (r.isValidSn && r.serialNo) {
        buckets[k].uniqueSnSet.add(r.serialNo);
        if (!buckets[k].subBreakdownSN[r.subName]) {
          buckets[k].subBreakdownSN[r.subName] = new Set();
        }
        buckets[k].subBreakdownSN[r.subName].add(r.serialNo);
      }
    });

    const orderedBuckets = bucketKeys.map(k => {
      const b = buckets[k];
      const snCounts = {};
      Object.keys(b.subBreakdownSN || {}).forEach(sub => {
        snCounts[sub] = b.subBreakdownSN[sub].size;
      });
      return {
        key: k,
        dateLabel: b.dateLabel,
        totalQty: b.totalQty,
        bucketUniqueSNTotal: b.uniqueSnSet.size,
        subBreakdown: b.subBreakdown,
        subBreakdownSN: snCounts
      };
    });

    const overallMetricTotal = orderedBuckets.reduce((sum, b) => {
      return sum + (isSNMode ? b.bucketUniqueSNTotal : b.totalQty);
    }, 0);

    if (subheading) {
      const countLabel = isSNMode ? 'unique board serial numbers' : 'total defect occurrences';
      subheading.textContent = `Chronological frequency of ${overallMetricTotal.toLocaleString()} ${countLabel} across ${orderedBuckets.length} ${mode} time buckets`;
    }

    const subTotals = {};
    orderedBuckets.forEach(b => {
      const map = isSNMode ? b.subBreakdownSN : b.subBreakdown;
      Object.keys(map).forEach(s => {
        subTotals[s] = (subTotals[s] || 0) + map[s];
      });
    });

    const sortedSubs = Object.keys(subTotals).sort((a, b) => subTotals[b] - subTotals[a]);
    const topSubs = sortedSubs.slice(0, 5);
    const hasOther = sortedSubs.length > 5;

    const palette = ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#f87171', '#94a3b8'];
    const colorMap = {};
    topSubs.forEach((s, idx) => { colorMap[s] = palette[idx % palette.length]; });
    if (hasOther) colorMap['Other'] = '#64748b';

    const paddingLeft = 55;
    const paddingRight = 30;
    const paddingTop = 25;
    const paddingBottom = 45;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridStroke = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
    const axisTextFill = isLight ? '#475569' : '#94a3b8';

    ctx.clearRect(0, 0, width, height);

    let maxVal = Math.max(...orderedBuckets.map(b => (isSNMode ? b.bucketUniqueSNTotal : b.totalQty)), 1);
    const steps = 4;
    maxVal = Math.ceil(maxVal / steps) * steps;

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

    const slotWidth = plotWidth / orderedBuckets.length;
    const barWidth = Math.max(Math.min(slotWidth * 0.65, 42), 4);
    this.chartHitboxes = [];

    const labelFreq = Math.ceil(orderedBuckets.length / 14);

    orderedBuckets.forEach((b, idx) => {
      const slotLeft = paddingLeft + idx * slotWidth;
      const slotRight = slotLeft + slotWidth;
      const xCenter = paddingLeft + (idx + 0.5) * slotWidth;
      const xLeft = xCenter - barWidth / 2;

      let currentY = paddingTop + plotHeight;
      const bucketMetricTotal = isSNMode ? b.bucketUniqueSNTotal : b.totalQty;
      const breakdownMap = isSNMode ? b.subBreakdownSN : b.subBreakdown;

      if (bucketMetricTotal > 0) {
        topSubs.forEach(sub => {
          const val = breakdownMap[sub] || 0;
          if (val > 0) {
            const segH = (val / maxVal) * plotHeight;
            currentY -= segH;
            ctx.fillStyle = colorMap[sub];
            ctx.fillRect(xLeft, currentY, barWidth, segH);
          }
        });

        if (hasOther) {
          let otherVal = 0;
          sortedSubs.slice(5).forEach(sub => { otherVal += (breakdownMap[sub] || 0); });
          if (otherVal > 0) {
            const segH = (otherVal / maxVal) * plotHeight;
            currentY -= segH;
            ctx.fillStyle = colorMap['Other'];
            ctx.fillRect(xLeft, currentY, barWidth, segH);
          }
        }
      }

      const totalH = (bucketMetricTotal / maxVal) * plotHeight;
      const barTop = paddingTop + plotHeight - totalH;

      this.chartHitboxes.push({
        slotLeft: slotLeft,
        slotRight: slotRight,
        xLeft: xLeft,
        xRight: xLeft + barWidth,
        xCenter: xCenter,
        yTop: barTop,
        yBottom: paddingTop + plotHeight,
        bucket: b
      });

      if (idx % labelFreq === 0 || idx === orderedBuckets.length - 1) {
        ctx.fillStyle = axisTextFill;
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(b.dateLabel, xCenter, paddingTop + plotHeight + 8);
      }
    });

    if (legendContainer) {
      let legendHtml = '';
      topSubs.forEach(s => {
        legendHtml += `
          <div class="chart-legend-item">
            <span class="chart-legend-color" style="background:${colorMap[s]};"></span>
            <span>${this.escapeHtml(s)}</span>
          </div>
        `;
      });
      if (hasOther) {
        legendHtml += `
          <div class="chart-legend-item">
            <span class="chart-legend-color" style="background:${colorMap['Other']};"></span>
            <span>Other Categories</span>
          </div>
        `;
      }
      legendContainer.innerHTML = legendHtml;
    }

    this.bindChartHover(container, canvas);
  }

  bindChartHover(container, canvas) {
    const tooltip = document.getElementById('timeline-chart-tooltip') || document.getElementById('chart-tooltip');
    if (!tooltip || !canvas) return;

    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const mouseX = e.clientX - rect.left;
      if (!this.chartHitboxes || this.chartHitboxes.length === 0) {
        tooltip.style.display = 'none';
        return;
      }

      const hit = this.chartHitboxes.find(hb => mouseX >= hb.slotLeft && mouseX <= hb.slotRight);

      if (hit) {
        const b = hit.bucket;
        const isSN = this.mp.timelineMetric === 'uniqueSN';
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
    const canvas = document.getElementById('pareto-chart-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('pareto-canvas-wrapper');
    const legendContainer = document.getElementById('pareto-legend-container');
    const heading = document.getElementById('pareto-chart-heading');
    const subheading = document.getElementById('pareto-chart-subheading');

    const isSNMode = this.mp.paretoMetric === 'uniqueSN';
    const btnDefects = document.getElementById('pareto-metric-btn-defects');
    const btnSN = document.getElementById('pareto-metric-btn-uniquesn');
    if (btnDefects) btnDefects.classList.toggle('active', !isSNMode);
    if (btnSN) btnSN.classList.toggle('active', isSNMode);

    const dim = this.mp.paretoGrouping || 'defectDescription';
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

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

    categories.sort((a, b) => b.count - a.count);
    const totalOverallMetric = categories.reduce((sum, c) => sum + c.count, 0);

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

    const rotationAngle = -Math.PI / 2.8;
    const cosA = Math.cos(Math.abs(rotationAngle));
    const sinA = Math.sin(Math.abs(rotationAngle));

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

    let maxVal = Math.max(...displayCategories.map(c => c.count), 1);
    const steps = 4;
    maxVal = Math.ceil(maxVal / steps) * steps;

    ctx.strokeStyle = gridStroke;
    ctx.fillStyle = axisTextFill;
    ctx.font = '12px Inter, sans-serif';

    for (let i = 0; i <= steps; i++) {
      const yPos = paddingTop + plotHeight - (i / steps) * plotHeight;
      ctx.beginPath();
      ctx.moveTo(paddingLeft, yPos);
      ctx.lineTo(width - paddingRight, yPos);
      ctx.stroke();

      const val = Math.round((maxVal / steps) * i);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(val.toLocaleString(), paddingLeft - 10, yPos);

      const pctVal = Math.round((100 / steps) * i);
      ctx.textAlign = 'left';
      ctx.fillText(`${pctVal}%`, width - paddingRight + 10, yPos);
    }

    const y80 = paddingTop + plotHeight - (80 / 100) * plotHeight;
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = cutoffColor;
    ctx.lineWidth = 1.8;
    ctx.moveTo(paddingLeft, y80);
    ctx.lineTo(width - paddingRight, y80);
    ctx.stroke();

    ctx.fillStyle = cutoffColor;
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('80% Pareto Cutoff', width - paddingRight - 10, y80 - 4);
    ctx.restore();

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

      const grad = ctx.createLinearGradient(0, barY, 0, paddingTop + plotHeight);
      if (idx < vitalFewCount && !cat.isOther) {
        grad.addColorStop(0, isLight ? '#0284c7' : '#38bdf8');
        grad.addColorStop(1, isLight ? 'rgba(3, 105, 161, 0.85)' : 'rgba(2, 132, 199, 0.65)');
      } else {
        grad.addColorStop(0, isLight ? '#64748b' : '#64748b');
        grad.addColorStop(1, isLight ? 'rgba(71, 85, 105, 0.85)' : 'rgba(51, 65, 85, 0.65)');
      }
      ctx.fillStyle = grad;

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

      ctx.strokeStyle = idx < vitalFewCount && !cat.isOther 
        ? (isLight ? 'rgba(2, 132, 199, 0.9)' : 'rgba(56, 189, 248, 0.8)') 
        : (isLight ? 'rgba(100, 116, 139, 0.6)' : 'rgba(148, 163, 184, 0.4)');
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = barCountFill;
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(cat.count.toLocaleString(), xCenter, barY - 4);

      const pointY = paddingTop + plotHeight - (cat.cumPct / 100) * plotHeight;
      curvePoints.push({ x: xCenter, y: pointY, cat: cat });

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

      curvePoints.forEach(pt => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = curveStroke;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = dotBorder;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.fillStyle = pointTextFill;
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${pt.cat.cumPct.toFixed(1)}%`, pt.x, pt.y - 7);
      });
      ctx.restore();
    }

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
    const tooltip = document.getElementById('pareto-chart-tooltip') || document.getElementById('chart-tooltip');
    if (!tooltip || !canvas) return;

    canvas.onmousemove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const mouseX = e.clientX - rect.left;
      if (!this.chartHitboxes || this.chartHitboxes.length === 0) {
        tooltip.style.display = 'none';
        return;
      }

      const hit = this.chartHitboxes.find(hb => mouseX >= hb.slotLeft && mouseX <= hb.slotRight);

      if (hit && hit.paretoCat) {
        const cat = hit.paretoCat;
        const isSN = this.mp.paretoMetric === 'uniqueSN';
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

  generateExportCanvas(requestedMode) {
    const mode = requestedMode || (this.mp.activeTab === 'pareto' ? 'pareto' : 'timeline');
    const isPareto = mode === 'pareto';
    const mainCanvas = document.getElementById(isPareto ? 'pareto-chart-canvas' : 'timeline-chart-canvas');
    if (!mainCanvas) return null;

    const exportCanvas = document.createElement('canvas');
    const width = 1600;
    const height = 960;
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');

    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isDark = currentTheme === 'dark';

    ctx.fillStyle = isDark ? '#0f172a' : '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, '#0284c7');
    grad.addColorStop(0.5, '#38bdf8');
    grad.addColorStop(1, '#818cf8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, 5);

    ctx.fillStyle = isDark ? '#ffffff' : '#0f172a';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleText = isPareto
      ? 'Benchmark Electronics - Defect Pareto 80/20 Analysis' 
      : 'Benchmark Electronics - Defect Timeline Trend Analysis';
    ctx.fillText(titleText, 40, 24);

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
    const currentMetric = isPareto ? this.mp.paretoMetric : this.mp.timelineMetric;
    const metricLabel = currentMetric === 'uniqueSN' ? 'Metric: Unique Board SNs' : 'Metric: Defect Quantity';
    const dateRange = (window.dataStore && window.dataStore.startDate && window.dataStore.endDate) 
      ? `Date Range: ${window.dataStore.startDate} to ${window.dataStore.endDate}` 
      : 'Date Range: All Time';
    ctx.fillText(`${trail}  |  ${metricLabel}  |  ${dateRange}`, 40, 58);

    ctx.fillStyle = isDark ? '#64748b' : '#94a3b8';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'right';
    const nowStr = new Date().toLocaleString();
    ctx.fillText(`Generated: ${nowStr}`, width - 40, 32);

    const chartX = 40;
    const chartY = 95;
    const chartW = width - 80;
    const chartH = height - 125;

    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(chartX, chartY, chartW, chartH);
    ctx.drawImage(mainCanvas, chartX, chartY, chartW, chartH);

    return exportCanvas;
  }

  exportChartPNG(requestedMode) {
    const mode = requestedMode || (this.mp.activeTab === 'pareto' ? 'pareto' : 'timeline');
    const exportCanvas = this.generateExportCanvas(mode);
    if (!exportCanvas) return;

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
      if (typeof this.mp.showToast === 'function') {
        this.mp.showToast(`📊 Exported ${filename}`);
      }
    }, 'image/png');
  }

  async copyChartClipboard(requestedMode) {
    const mode = requestedMode || (this.mp.activeTab === 'pareto' ? 'pareto' : 'timeline');
    const exportCanvas = this.generateExportCanvas(mode);
    if (!exportCanvas) return;

    if (!navigator.clipboard || !navigator.clipboard.write) {
      if (typeof this.mp.showToast === 'function') {
        this.mp.showToast('⚠️ Clipboard image write not supported in this browser. Please use Download PNG.');
      }
      return;
    }

    try {
      exportCanvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
          ]);
          if (typeof this.mp.showToast === 'function') {
            this.mp.showToast('📋 Chart image copied to clipboard! (Ready to paste into PowerPoint, Word, or Teams)');
          }
        } catch (err) {
          console.warn('Clipboard write failed:', err);
          if (typeof this.mp.showToast === 'function') {
            this.mp.showToast('⚠️ Could not copy image to clipboard. Downloading PNG instead.');
          }
          this.exportChartPNG(mode);
        }
      }, 'image/png');
    } catch (e) {
      this.exportChartPNG(mode);
    }
  }
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.ChartRenderer = ChartRenderer;
