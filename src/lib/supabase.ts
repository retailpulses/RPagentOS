import { createClient } from '@supabase/supabase-js';

const url = process.env['SUPABASE_URL'];
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!url) {
  console.error('ERROR: SUPABASE_URL is not set. Check your .env.local file.');
  process.exit(1);
}
if (!key) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY is not set. Check your .env.local file.');
  process.exit(1);
}

export const supabase = createClient(url, key);
