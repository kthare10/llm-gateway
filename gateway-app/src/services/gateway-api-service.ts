const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api/v1";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `API error: ${res.status}`);
  }
  return res.json();
}

export interface UserProfile {
  user_id: string;
  email: string | null;
  is_admin: boolean;
}

export interface ModelInfo {
  modelId: string;
  mode: string;
}

export interface ModelsResponse {
  api_host: string;
  models: ModelInfo[];
}

export interface LLMKey {
  key_alias?: string;
  key_name?: string;
  token?: string;
  spend?: number | null;
  max_budget?: number | null;
  created_at?: string;
  expires?: string;
}

export interface CreateKeyRequest {
  name: string;
  comment?: string;
  duration_days?: number;
  models?: string[];
  max_budget?: number;
}

export interface CreateKeyResponse {
  api_key: string;
  key_id: string;
  key_alias: string;
  expires_at: string;
  max_budget: number;
  models: string[];
  config_snippets: {
    curl: string;
    openai_python: string;
    chatbox: object;
    claude_code: object;
    opencode: object;
    openai_python_image?: string;
  };
}

export function getMe(): Promise<UserProfile> {
  return apiFetch("/me");
}

export function getModels(): Promise<ModelsResponse> {
  return apiFetch("/models");
}

export function getKeys(): Promise<{ keys: LLMKey[] }> {
  return apiFetch("/keys");
}

export function createKey(body: CreateKeyRequest): Promise<CreateKeyResponse> {
  return apiFetch("/keys", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteKey(keyId: string): Promise<void> {
  return apiFetch(`/keys/${keyId}`, { method: "DELETE" });
}

// Admin
export function getAdminUsers(): Promise<{ users: unknown[] }> {
  return apiFetch("/admin/users");
}

export function getAdminUsage(): Promise<Record<string, unknown>> {
  return apiFetch("/admin/usage");
}
