import type { ConnectionStatus } from "../lib/useSession";

export function ConnectionNotice({ status }: { status: ConnectionStatus }) {
  if (status !== "reconnecting") return null;
  return (
    <div className="connection-notice" role="status">
      Connection lost. Reconnecting…
    </div>
  );
}

export function LiveDot({ count }: { count: number }) {
  return (
    <span className="live-count">
      <span className="live-count__dot" aria-hidden="true" />
      {count} {count === 1 ? "person" : "people"} here
    </span>
  );
}
