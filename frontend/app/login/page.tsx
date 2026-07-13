"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AuthError, fetchCurrentUser, signOut } from "@/lib/auth";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "not-approved") {
      setError("Seu usuario existe, mas ainda aguarda aprovacao de um administrador.");
    } else if (reason === "session-invalid") {
      setError("Sua sessao expirou ou nao e mais valida. Entre novamente.");
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      try {
        await fetchCurrentUser();
      } catch (validationError) {
        await signOut().catch(() => undefined);
        if (validationError instanceof AuthError && validationError.status === 403) {
          throw new Error("Seu usuario ainda aguarda aprovacao de um administrador.");
        }
        throw validationError;
      }

      router.replace("/");
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-panel" onSubmit={submit}>
        <div>
          <p className="eyebrow">Synapse AI</p>
          <h1>Acesso restrito</h1>
        </div>

        {!isSupabaseConfigured() ? (
          <p className="ops-error">Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.</p>
        ) : null}

        <label className="ops-field">
          <span>Email</span>
          <input
            autoComplete="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="ops-field">
          <span>Senha</span>
          <input
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {error ? <p className="ops-error">{error}</p> : null}

        <button className="ops-button" disabled={loading || !email || !password || !isSupabaseConfigured()} type="submit">
          Entrar
        </button>
      </form>
    </main>
  );
}
