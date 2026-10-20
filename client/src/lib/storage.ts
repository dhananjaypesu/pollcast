// localStorage can throw (private mode, blocked storage), so every access is guarded.

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not fatal: the app still works for this tab.
  }
}

let memoryParticipantId: string | null = null;

/** A random, anonymous ID that lets someone keep their vote across reloads. */
export function participantId(): string {
  const existing = read("pollcast:participant") ?? memoryParticipantId;
  if (existing) return existing;
  const id = crypto.randomUUID().replace(/-/g, "");
  memoryParticipantId = id;
  write("pollcast:participant", id);
  return id;
}

export const hostToken = {
  get: (code: string) => read(`pollcast:host:${code.toUpperCase()}`),
  set: (code: string, token: string) => write(`pollcast:host:${code.toUpperCase()}`, token),
};

export const displayName = {
  get: () => read("pollcast:name") ?? "",
  set: (name: string) => write("pollcast:name", name),
};
