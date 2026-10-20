export interface CreatedSession {
  code: string;
  title: string;
  hostToken: string;
}

export interface SessionLookup {
  code: string;
  title: string;
  endedAt: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Can't reach Pollcast. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  createSession: (title: string) =>
    request<CreatedSession>("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
  lookup: (code: string) => request<SessionLookup>(`/api/sessions/${encodeURIComponent(code)}`),
};

export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

export const joinUrl = (code: string) => `${window.location.origin}/j/${code}`;
