"use client";

import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

export type CurrentUser = {
  authenticated: boolean;
  mode: string;
  user_id: string | null;
  role: string | null;
  is_admin: boolean;
};

export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error) throw error;
  return data.session?.access_token ?? null;
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const token = await getAccessToken();
  if (!token) throw new AuthError("Sua sessao expirou.", 401);

  const response = await fetch("/api/synapse/auth/me", {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  const payload = (await response.json()) as CurrentUser & {
    detail?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new AuthError(
      payload.detail ?? payload.error ?? `Falha de autenticacao (${response.status}).`,
      response.status,
    );
  }
  return payload;
}

export async function signOut(): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await getSupabaseClient().auth.signOut();
  if (error) throw error;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
