import { importAmazonMapping, importAmazon } from '../packages/listing-import/import-amazon.js';

const mappingPath = process.argv[2] || 'data/product and listings/export - Amazon listings mapping.csv';
const listingsPath = process.argv[3] || 'data/product and listings/amazon_open_listings_lite.tsv';

async function main() {
  await importAmazonMapping(mappingPath);
  await importAmazon(listingsPath);
  console.log('Done.');
}

main().catch((err) => { console.error('Import failed:', err); process.exit(1); });
