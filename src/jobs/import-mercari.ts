import { importMercari } from '../packages/listing-import/import-mercari.js';

const filePath = process.argv[2] || 'data/product and listings/mercari shop4 listing.csv';
const shopCode = process.argv[3] || 'shop4';

importMercari(filePath, shopCode)
  .then(() => { console.log('Done.'); process.exit(0); })
  .catch((err) => { console.error('Import failed:', err); process.exit(1); });
