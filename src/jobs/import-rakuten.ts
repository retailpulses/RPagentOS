import { importRakuten } from '../packages/listing-import/import-rakuten.js';

const filePath = process.argv[2] || 'data/product and listings/export - Rakuten listings - Grid (1).csv';
const shopCode = process.argv[3] || 'homebliss';

importRakuten(filePath, shopCode)
  .then(() => { console.log('Done.'); process.exit(0); })
  .catch((err) => { console.error('Import failed:', err); process.exit(1); });
