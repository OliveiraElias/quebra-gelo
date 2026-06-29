import { createClient } from "@supabase/supabase-js";

const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const rawKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// Check if a string is a valid HTTP/HTTPS URL
const isValidUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

let supabaseUrl = rawUrl || "http://127.0.0.1:54321";
let supabasePublishableKey = rawKey || "";

// Validate the URL if it was provided
if (rawUrl && !isValidUrl(rawUrl)) {
  console.warn("⚠️ [Supabase] NEXT_PUBLIC_SUPABASE_URL is not a valid HTTP/HTTPS URL:", rawUrl);
  
  if (rawUrl.startsWith("sb_publishable_") || (rawKey && isValidUrl(rawKey))) {
    console.error(
      "\n❌ [Supabase] ERROR: It looks like NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are SWAPPED in your environment variables!\n" +
      "Please swap them in your Vercel project settings:\n" +
      "  - NEXT_PUBLIC_SUPABASE_URL should be the URL (starts with https://)\n" +
      "  - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY should be the key (starts with sb_publishable_ or eyJ...)\n"
    );
  } else {
    console.error("❌ [Supabase] ERROR: NEXT_PUBLIC_SUPABASE_URL is invalid.");
  }

  // Fallback to a valid placeholder URL during build time to prevent compilation failure
  supabaseUrl = "https://placeholder-project.supabase.co";
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);

