import assert from 'node:assert/strict';
import { excelXml } from './public/excel.js';

const out = excelXml({
  sheetName: 'Creators / test',
  columns: [{ key: 'name', label: 'Creator' }, { key: 'gmv', label: 'Net GMV (Estimated)', num: true }],
  rows: [{ name: '<creator>', gmv: 1234 }],
});

assert.match(out, /Worksheet ss:Name="Creators   test"/);
assert.match(out, /ss:Type="Number">1234/);
assert.match(out, /&lt;creator&gt;/);
assert.doesNotMatch(out, /<creator>/);
console.log('test-excel OK — SpreadsheetML export is valid and escaped');
