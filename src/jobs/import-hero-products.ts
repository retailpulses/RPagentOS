import { importHeroProducts } from '../packages/listing-import/import-hero-products.js';

importHeroProducts()
  .then((result) => {
    console.log('\n=== Hero Products Import Complete ===');
    console.log(`Rows: ${result.rows}`);
    console.log(`Matched: ${result.matched}`);
    console.log(`Inserted: ${result.inserted}`);
    if (result.unmatched.length > 0) {
      console.log(`Unmatched: ${result.unmatched.length}`);
      console.log(result.unmatched);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('Hero import failed:', err);
    process.exit(1);
  });
