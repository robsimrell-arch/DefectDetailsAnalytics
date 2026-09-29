/**
 * ExportService - Generates CSV, Excel, and JSON dataset exports with safe Blob & URL encoding.
 */
class ExportService {
  static sanitizeCsvCell(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val).replace(/"/g, '""');
    // Prevent Excel formula injection
    if (/^[=\+\-\@\t\r]/.test(str)) {
      str = "'" + str;
    }
    return `"${str}"`;
  }

  static exportCSV(records, requestedFilename) {
    if (!records || records.length === 0) {
      alert('No data to export.');
      return;
    }

    const headers = [
      'Customer', 'Parent Part No.', 'Serial No.', 'F.A. Date', 'Process Recorded',
      'Defect Description', 'Defect Code', 'Ref Des', 'Defect Quantity',
      'Solution Confirmed', 'Solution Memo', 'Failure Comment', 'Defect Comment', 'Debug Tech', 'Repair Description', 'Repair Comment'
    ];

    const rows = records.map(r => [
      ExportService.sanitizeCsvCell(r.customer),
      ExportService.sanitizeCsvCell(r.parentPartNo),
      ExportService.sanitizeCsvCell(r.serialNo),
      ExportService.sanitizeCsvCell(r.faDate),
      ExportService.sanitizeCsvCell(r.processRecorded),
      ExportService.sanitizeCsvCell(r.defectDescription),
      ExportService.sanitizeCsvCell(r.defectCode),
      ExportService.sanitizeCsvCell(r.refDes),
      parseInt(r.defectQuantity, 10) || 1,
      ExportService.sanitizeCsvCell(r.confirmedFix || 'Pending'),
      ExportService.sanitizeCsvCell(r.fixComment),
      ExportService.sanitizeCsvCell(r.failureComment),
      ExportService.sanitizeCsvCell(r.defectComment),
      ExportService.sanitizeCsvCell(r.debugTech),
      ExportService.sanitizeCsvCell(r.repairDescription),
      ExportService.sanitizeCsvCell(r.repairComment)
    ]);

    const csvString = [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const filename = requestedFilename || `DefectDetails_Export_${new Date().toISOString().slice(0, 10)}.csv`;

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 200);

    return records.length;
  }

  static async exportDatasetFile(rawRecords, filename = 'defect_details.json') {
    const jsonStr = JSON.stringify(rawRecords, null, 2);

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{
            description: 'JSON Defect Dataset File',
            accept: { 'application/json': ['.json'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(jsonStr);
        await writable.close();
        return true;
      } catch (err) {
        if (err.name === 'AbortError') return false;
      }
    }

    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  }
}

window.DefectApp = window.DefectApp || {};
window.DefectApp.ExportService = ExportService;
