import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);

// All tables live in the "yachad" schema, so the app can share a Supabase project with other apps.
export const sb = createClient(url || "http://localhost", key || "missing", {
  db: { schema: "yachad" },
  auth: { persistSession: true, autoRefreshToken: true },
});
