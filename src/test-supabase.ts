import { createClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!url) {
  console.error('ERROR: SUPABASE_URL is not set. Please check your .env.local file.');
  process.exit(1);
}
if (!key) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY is not set. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase
    .from('platform_listings')
    .select(`
      *,
      variant:variant_id (
        *,
        product:product_id (*)
      )
    `)
    .eq('platform', 'mercari')
    .eq('shop_code', 'shop4');

  if (error) {
    console.error('ERROR: Supabase query failed');
    console.error(error);
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
}

main();
