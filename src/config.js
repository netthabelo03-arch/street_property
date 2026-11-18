// Where Street Property's accounts and data live (Supabase).
// The publishable key is meant to be public: it only reaches what the
// database's row-level security rules allow. Never put a secret key here.
//
// Fill these in from Supabase: Project Settings, API Keys (and the Project URL).
// While they are empty the app opens, and the account screens say that
// accounts are not switched on yet.

export const SUPABASE_URL = '';
export const SUPABASE_PUBLISHABLE_KEY = '';

/** Whether the app has been connected to its Supabase project yet. */
export function isConfigured() {
  return /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(SUPABASE_URL) && SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_');
}
