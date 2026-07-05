import { importProductMaster } from '../packages/listing-import/import-product-master.js';

const filePath = process.argv[2] || 'data/product and listings/export - Products - Grid.csv';

console.log(`Importing product master from: ${filePath}`);

importProductMaster(filePath)
  .then(() => {
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  });
