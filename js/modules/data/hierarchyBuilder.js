/**
 * HierarchyBuilder - 5-level drill-down tree construction, multi-target token search, and hierarchy filtering.
 */
class HierarchyBuilder {
  static parseDate(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  static normalizeDateKey(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return String(dateStr).trim().toLowerCase().replace(/:\d{2}(\s*[ap]m)/i, '$1');
  }

  static isValidSerialNo(sn) {
    if (!sn && sn !== 0) return false;
    const str = String(sn).trim().toUpperCase();
    const invalid = new Set(['', '-', 'N/A', 'NA', 'NONE', '[NONE]', 'UNKNOWN', 'NULL', 'UNDEFINED']);
    return !invalid.has(str);
  }

  static deriveCustomer(r, parentPart, serialNo) {
    let c = (r.customer || r['Customer'] || r['Customer Name'] || r['Customer Code'] || '').toString().trim().toUpperCase();
    if (c && c !== 'UNK' && c !== 'UNKNOWN') {
      return c.substring(0, 3);
    }

    const p = (parentPart || '').toString().trim().toUpperCase();
    const s = (serialNo || '').toString().trim().toUpperCase();

    const cleanP = p.replace(/[^A-Z]/g, '');
    if (cleanP.length >= 3) {
      return cleanP.substring(0, 3);
    }

    const matchS = s.match(/[0-9]{2,4}([A-Z]{3})[0-9]/);
    if (matchS) {
      return matchS[1].substring(0, 3);
    }

    if (p.length >= 3) {
      return p.substring(0, 3);
    }

    return 'UNK';
  }

  static buildSearchStr(rec) {
    let fixTerms = 'pending';
    if (rec.confirmedFix === 'Yes') {
      fixTerms = 'yes confirmed solution fix';
    } else if (rec.confirmedFix === 'No') {
      fixTerms = 'no failed fix';
    } else if (rec.confirmedFix === 'False Fail') {
      fixTerms = 'false fail fix';
    } else if (rec.confirmedFix === 'Possible False Fail') {
      fixTerms = 'possible false fail fix';
    }
    return `${rec.customer} ${rec.parentPartNo} ${rec.processRecorded} ${rec.defectDescription} ${rec.refDes} ${rec.serialNo} ${rec.defectComment} ${rec.failureComment} ${rec.failureDescription} ${rec.repairComment} ${rec.repairDescription} ${rec.fixComment} ${rec.whoFailed} ${rec.debugTech} ${rec.repairTech} ${rec.failureCode} ${rec.defectCode} ${rec.repairCode} ${fixTerms}`.toLowerCase();
  }

  static normalizeRecord(r, idx) {
    const parentPart = (r.parentPartNo || r['Parent Part No.'] || r['Parent Part No'] || r['Parent Part Number'] || r['ParentPartNo'] || r['Part Number'] || r['Part No'] || 'UNKNOWN').toString().trim();
    const refDesRaw = (r.refDes || r['Ref Des'] || r['RefDes'] || r['Reference Designator'] || r['Ref_Des'] || '').toString().trim();
    const serialNo = (r.serialNo || r['Serial No.'] || r['Serial No'] || r['Serial Number'] || r['SerialNo'] || r['SN'] || '').toString().trim();
    const faDate = (r.faDate || r['F.A. Date'] || r['FA Date'] || r['Date'] || r['fa_date'] || '').toString().trim();
    const processRecorded = (r.processRecorded || r['Process Recorded'] || r['Process'] || r['Operation'] || 'UNSPECIFIED PROCESS').toString().trim();
    const customer = HierarchyBuilder.deriveCustomer(r, parentPart, serialNo);

    const rec = {
      id: r.id || (idx + 1),
      customer: customer,
      parentPartNo: parentPart,
      processRecorded: processRecorded ? processRecorded : 'UNSPECIFIED PROCESS',
      serialNo: serialNo,
      faDate: faDate,
      whoFailed: (r.whoFailed || r['Who Failed'] || r['Inspector'] || r['Operator'] || '').toString().trim(),
      failureCode: (r.failureCode || r['Failure Code'] || '').toString().trim(),
      failureDescription: (r.failureDescription || r['Failure Description'] || '').toString().trim(),
      failureComment: (r.failureComment || r['Failure Comment'] || '').toString().trim(),
      defectCode: (r.defectCode || r['Defect Code'] || '').toString().trim(),
      defectDescription: (r.defectDescription || r['Defect Description'] || r['Defect'] || 'UNSPECIFIED DEFECT').toString().trim(),
      debugTech: (r.debugTech || r['Debug Tech'] || r['Technician'] || '').toString().trim(),
      defectComment: (r.defectComment || r['Defect Comment'] || r['Comment'] || '').toString().trim(),
      defectQuantity: parseInt(r.defectQuantity || r['Defect Quantity'] || r['Defect Qty'] || r['Qty'] || 1, 10) || 1,
      refDes: refDesRaw ? refDesRaw : '[Unassigned Ref Des]',
      repairCode: (r.repairCode || r['Repair Code'] || '').toString().trim(),
      repairDescription: (r.repairDescription || r['Repair Description'] || '').toString().trim(),
      repairTech: (r.repairTech || r['Repair Tech'] || '').toString().trim(),
      repairComment: (r.repairComment || r['Repair Comment'] || '').toString().trim(),
      confirmedFix: r.confirmedFix || 'Pending',
      fixComment: r.fixComment || '',
      confirmedAt: r.confirmedAt || r.updatedAt || null
    };

    rec._timestamp = HierarchyBuilder.parseDate(rec.faDate);
    rec._confirmedTimestamp = rec.confirmedAt ? HierarchyBuilder.parseDate(rec.confirmedAt) : 0;
    rec._searchStr = HierarchyBuilder.buildSearchStr(rec);

    return rec;
  }

  static parseSearchTokens(query) {
    if (!query || typeof query !== 'string') return [];
    const tokens = [];
    const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
    let match;
    while ((match = regex.exec(query)) !== null) {
      const token = (match[1] || match[2] || match[3] || '').trim().toLowerCase();
      if (token) {
        tokens.push(token);
      }
    }
    return tokens;
  }

  static matchesSearchTokens(rec, target, tokens) {
    if (!tokens || tokens.length === 0) return true;
    let str = '';
    if (target === 'all') {
      str = rec._searchStr || '';
    } else if (target === 'refDes') {
      str = (rec.refDes || '').toLowerCase();
    } else if (target === 'serialNo') {
      str = (rec.serialNo || '').toLowerCase();
    } else if (target === 'defectDescription') {
      str = (rec.defectDescription || '').toLowerCase();
    } else if (target === 'process') {
      str = (rec.processRecorded || '').toLowerCase();
    } else if (target === 'failureComments') {
      str = `${rec.failureComment || ''} ${rec.failureDescription || ''}`.toLowerCase();
    } else if (target === 'comments') {
      str = `${rec.defectComment || ''} ${rec.failureComment || ''} ${rec.repairComment || ''} ${rec.fixComment || ''} ${rec.failureDescription || ''} ${rec.repairDescription || ''}`.toLowerCase();
    } else if (target === 'parts') {
      str = `${rec.parentPartNo || ''} ${rec.customer || ''}`.toLowerCase();
    } else {
      str = rec._searchStr || '';
    }

    for (let i = 0; i < tokens.length; i++) {
      if (!str.includes(tokens[i])) return false;
    }
    return true;
  }

  static buildTree(records, treeMetric = 'records', dateFilterFn = null, fixFilter = 'all', searchQuery = '', searchTarget = 'all') {
    let filtered = records;

    if (typeof dateFilterFn === 'function') {
      filtered = filtered.filter(r => dateFilterFn(r.faDate));
    }

    if (fixFilter !== 'all') {
      filtered = filtered.filter(r => r.confirmedFix === fixFilter);
    }

    if (searchQuery) {
      const tokens = HierarchyBuilder.parseSearchTokens(searchQuery);
      if (tokens.length > 0) {
        filtered = filtered.filter(r => HierarchyBuilder.matchesSearchTokens(r, searchTarget, tokens));
      }
    }

    const custMap = new Map();

    filtered.forEach(rec => {
      const cust = rec.customer;
      const part = rec.parentPartNo;
      const proc = rec.processRecorded || 'UNSPECIFIED PROCESS';
      const desc = rec.defectDescription;
      const ref = rec.refDes;
      const qty = rec.defectQuantity;
      const rawSn = (rec.serialNo || '').toString().trim().toUpperCase();
      const isValidSn = HierarchyBuilder.isValidSerialNo(rawSn);

      if (!custMap.has(cust)) {
        custMap.set(cust, { name: cust, recordCount: 0, totalQty: 0, snSet: new Set(), partsMap: new Map() });
      }
      const custNode = custMap.get(cust);
      custNode.recordCount += 1;
      custNode.totalQty += qty;
      if (isValidSn) custNode.snSet.add(rawSn);

      if (!custNode.partsMap.has(part)) {
        custNode.partsMap.set(part, { name: part, recordCount: 0, totalQty: 0, snSet: new Set(), procMap: new Map() });
      }
      const partNode = custNode.partsMap.get(part);
      partNode.recordCount += 1;
      partNode.totalQty += qty;
      if (isValidSn) partNode.snSet.add(rawSn);

      if (!partNode.procMap.has(proc)) {
        partNode.procMap.set(proc, { name: proc, recordCount: 0, totalQty: 0, snSet: new Set(), descMap: new Map() });
      }
      const procNode = partNode.procMap.get(proc);
      procNode.recordCount += 1;
      procNode.totalQty += qty;
      if (isValidSn) procNode.snSet.add(rawSn);

      if (!procNode.descMap.has(desc)) {
        procNode.descMap.set(desc, { name: desc, recordCount: 0, totalQty: 0, snSet: new Set(), refMap: new Map() });
      }
      const descNode = procNode.descMap.get(desc);
      descNode.recordCount += 1;
      descNode.totalQty += qty;
      if (isValidSn) descNode.snSet.add(rawSn);

      if (!descNode.refMap.has(ref)) {
        descNode.refMap.set(ref, { name: ref, recordCount: 0, totalQty: 0, snSet: new Set(), records: [] });
      }
      const refNode = descNode.refMap.get(ref);
      refNode.recordCount += 1;
      refNode.totalQty += qty;
      if (isValidSn) refNode.snSet.add(rawSn);
      refNode.records.push(rec);
    });

    const isSNMode = treeMetric === 'uniqueSN';
    const alphaSort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    const countSort = isSNMode
      ? (a, b) => (b.uniqueSNCount - a.uniqueSNCount) || (b.recordCount - a.recordCount) || (b.totalQty - a.totalQty) || alphaSort(a, b)
      : (a, b) => (b.recordCount - a.recordCount) || (b.totalQty - a.totalQty) || (b.uniqueSNCount - a.uniqueSNCount) || alphaSort(a, b);

    const tree = Array.from(custMap.values()).map(cust => {
      const parts = Array.from(cust.partsMap.values()).map(part => {
        const procs = Array.from(part.procMap.values()).map(proc => {
          const descs = Array.from(proc.descMap.values()).map(desc => {
            const refs = Array.from(desc.refMap.values()).map(ref => {
              ref.records.sort((a, b) => (b._timestamp || 0) - (a._timestamp || 0));
              ref.uniqueSNCount = ref.snSet ? ref.snSet.size : 0;
              return ref;
            }).sort(countSort);

            return {
              name: desc.name,
              recordCount: desc.recordCount,
              totalQty: desc.totalQty,
              uniqueSNCount: desc.snSet ? desc.snSet.size : 0,
              children: refs
            };
          }).sort(countSort);

          return {
            name: proc.name,
            recordCount: proc.recordCount,
            totalQty: proc.totalQty,
            uniqueSNCount: proc.snSet ? proc.snSet.size : 0,
            children: descs
          };
        }).sort(countSort);

        return {
          name: part.name,
          recordCount: part.recordCount,
          totalQty: part.totalQty,
          uniqueSNCount: part.snSet ? part.snSet.size : 0,
          children: procs
        };
      }).sort(alphaSort);

      return {
        name: cust.name,
        recordCount: cust.recordCount,
        totalQty: cust.totalQty,
        uniqueSNCount: cust.snSet ? cust.snSet.size : 0,
        children: parts
      };
    }).sort(countSort);

    return tree;
  }

  static buildTreeNodeMap(tree) {
    const map = new Map();

    const traverse = (node, level, parentKey, custName, partName, procName, descName) => {
      let key = '';
      let customer = custName;
      let parentPartNo = partName;
      let processRecorded = procName;
      let defectDescription = descName;
      let refDes = '';

      if (level === 1) {
        key = `c:${node.name}`;
        customer = node.name;
      } else if (level === 2) {
        key = `${parentKey}>p:${node.name}`;
        parentPartNo = node.name;
      } else if (level === 3) {
        key = `${parentKey}>pr:${node.name}`;
        processRecorded = node.name;
      } else if (level === 4) {
        key = `${parentKey}>d:${node.name}`;
        defectDescription = node.name;
      } else if (level === 5) {
        key = `${parentKey}>r:${node.name}`;
        refDes = node.name;
      }

      node.key = key;
      node.level = level;
      node.parentKey = parentKey;
      node.customer = customer;
      node.parentPartNo = parentPartNo;
      node.processRecorded = processRecorded;
      node.defectDescription = defectDescription;
      node.refDes = refDes;

      const childKeys = [];
      const allDescendantKeys = [];

      if (Array.isArray(node.children)) {
        node.children.forEach(child => {
          const childInfo = traverse(child, level + 1, key, customer, parentPartNo, processRecorded, defectDescription);
          childKeys.push(childInfo.key);
          allDescendantKeys.push(childInfo.key, ...childInfo.allDescendantKeys);
        });
      }

      const nodeInfo = {
        key,
        level,
        name: node.name,
        customer,
        parentPartNo,
        processRecorded,
        defectDescription,
        refDes,
        parentKey,
        childKeys,
        allDescendantKeys,
        recordCount: node.recordCount,
        totalQty: node.totalQty,
        uniqueSNCount: node.uniqueSNCount
      };

      map.set(key, nodeInfo);
      return nodeInfo;
    };

    if (Array.isArray(tree)) {
      tree.forEach(cust => traverse(cust, 1, null, '', '', '', ''));
    }

    return map;
  }
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.HierarchyBuilder = HierarchyBuilder;
