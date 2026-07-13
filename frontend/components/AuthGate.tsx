"use client";

import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

import { AuthError, fetchCurrentUser, signOut } from "@/lib/auth";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(!isSupabaseConfigured());

  useEffect(() => {
    if (!isSupabaseConfigured() || pathname === "/login") {
      setReady(true);
      return;
    }

    let active = true;
    const supabase = getSupabaseClient();

    async function validateSession() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          router.replace("/login");
          return;
        }
        await fetchCurrentUser();
        if (active) setReady(true);
      } catch (error) {
        await signOut().catch(() => undefined);
        const reason =
          error instanceof AuthError && error.status === 403
            ? "not-approved"
            : "session-invalid";
        router.replace(`/login?reason=${reason}`);
      }
    }

    void validateSession();

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        router.replace("/login");
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        void validateSession();
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (!ready) {
    return <main className="auth-screen" />;
  }

  return <>{children}</>;
}
