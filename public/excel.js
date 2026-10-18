// Excel 2003 XML (SpreadsheetML) keeps the export dependency-free in the browser.
// Excel opens this as a native workbook and numeric cells remain numeric.
const xml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const safeSheetName = (name) => String(name || 'Export').replace(/[\\/:?*\[\]]/g, ' ').slice(0, 31) || 'Export';

export function excelXml({ sheetName = 'Export', columns = [], rows = [] } = {}) {
  const cell = (value, numeric = false) => {
    const n = Number(value);
    const isNumber = numeric && Number.isFinite(n);
    return `<Cell><Data ss:Type="${isNumber ? 'Number' : 'String'}">${xml(isNumber ? n : value)}</Data></Cell>`;
  };
  const header = `<Row>${columns.map(c => cell(c.label)).join('')}</Row>`;
  const body = rows.map(row => `<Row>${columns.map(c => cell(row[c.key], c.num)).join('')}</Row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles><Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Arial" ss:Size="10"/></Style></Styles>
  <Worksheet ss:Name="${xml(safeSheetName(sheetName))}"><Table>
    ${header}${body}
  </Table></Worksheet>
</Workbook>`;
}

export function downloadExcel(options, filename) {
  const blob = new Blob([excelXml(options)], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
