import { resolvePlatformLinks } from '../packages/listing-import/resolve-platform-links.js';

resolvePlatformLinks()
  .then((result) => {
    console.log('Links created:', result);
    console.log('Done.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Link resolution failed:', err);
    process.exit(1);
  });
