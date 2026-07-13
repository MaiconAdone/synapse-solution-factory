"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CurrentUser, fetchCurrentUser, signOut } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase";

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void fetchCurrentUser().then(setUser).catch(() => setUser(null));
  }, []);

  if (!isSupabaseConfigured()) {
    return <span className="auth-mode">Modo local</span>;
  }

  return (
    <div className="user-menu">
      <div>
        <strong>{user?.role ?? "usuario"}</strong>
        <span>{user?.is_admin ? "Administrador" : "Acesso aprovado"}</span>
      </div>
      <button
        aria-label="Sair"
        className="icon-button"
        title="Sair"
        type="button"
        onClick={async () => {
          await signOut();
          router.replace("/login");
        }}
      >
        <LogOut aria-hidden="true" size={18} />
      </button>
    </div>
  );
}
