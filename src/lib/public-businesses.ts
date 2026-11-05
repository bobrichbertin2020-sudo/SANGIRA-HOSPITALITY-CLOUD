import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";

export type { PublicBusiness } from "@/lib/public-businesses/types";

export function createPublicClient() {
  const { url, key } = getSupabaseConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function searchPublicBusinesses(query: string | null, limit: number) {
  return createPublicClient().rpc("search_public_businesses", {
    p_query: query,
    p_limit: limit,
  });
}
