import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // móvil: no queremos parsear URL como web
  },
});

export const STORAGE_BUCKET_VENUE_PHOTOS = "venue-photos";

/**
 * Para piloto: lo más simple es bucket público (lectura).
 * Si más adelante quieres privacidad, cambia a signed URLs.
 */
export function storagePublicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl ?? null;
}

export function venueCoverUrl(path?: string | null, cacheBust?: string | number) {
  const raw = (path ?? "").trim();
  if (!raw) return null;

  // Si por error guardaran una URL completa, la respetamos
  if (/^https?:\/\//i.test(raw)) {
    const safe = raw.replace(/\s/g, "%20");
    const sep = safe.includes("?") ? "&" : "?";
    return cacheBust ? `${safe}${sep}t=${encodeURIComponent(String(cacheBust))}` : safe;
  }

  // Normalizamos barras iniciales
  const p = raw.replace(/^\/+/, "");

  // Compatibilidad: si viene sin "venues/", probamos también con "venues/"
  const candidates = p.startsWith("venues/")
    ? [p, p.replace(/^venues\//, "")]
    : [p, `venues/${p}`];

  for (const cand of candidates) {
    const url = storagePublicUrl(STORAGE_BUCKET_VENUE_PHOTOS, cand);
    if (url) {
      const safe = url.replace(/\s/g, "%20");
      const sep = safe.includes("?") ? "&" : "?";
      return cacheBust ? `${safe}${sep}t=${encodeURIComponent(String(cacheBust))}` : safe;
    }
  }

  return null;
}
