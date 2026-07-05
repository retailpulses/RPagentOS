import { validateAllImports } from '../packages/listing-import/validation-reports.js';

validateAllImports()
  .then((results) => {
    console.log('\n=== Import Validation Report ===\n');
    const pass = results.filter((r) => r.status === 'PASS');
    const warn = results.filter((r) => r.status === 'WARN');
    const fail = results.filter((r) => r.status === 'FAIL');

    for (const r of results) {
      const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️' : '❌';
      console.log(`${icon} ${r.check}`);
      console.log(`   ${r.detail}`);
    }

    console.log(`\n--- Summary ---`);
    console.log(`✅ ${pass.length} passed`);
    console.log(`⚠️  ${warn.length} warnings`);
    console.log(`❌ ${fail.length} failed\n`);

    process.exit(fail.length > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('Validation failed:', err);
    process.exit(1);
  });
