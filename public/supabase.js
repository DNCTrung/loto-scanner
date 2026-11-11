import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://esslwskwwhhefepogucw.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_0wCvhkpo5nRniLgCZA_Gig_Ewfkti7R';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
