import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { joinUrl } from "../lib/api";

interface Props {
  code: string;
  size?: "regular" | "screen";
}

/** The join code styled like a ticket stub, with a QR code people can scan from their seats. */
export function JoinTicket({ code, size = "regular" }: Props) {
  const [qr, setQr] = useState<string | null>(null);
  const url = joinUrl(code);
  const host = url.replace(/^https?:\/\//, "").replace(/\/j\/.*$/, "");

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 480, color: { dark: "#1B1F3B", light: "#FFFFFF" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  return (
    <div className={`ticket ticket--${size}`}>
      <div className="ticket__main">
        <p className="ticket__how">
          Go to <strong>{host}/j</strong> and enter
        </p>
        <p className="ticket__code">
          {/* Read letter by letter so screen readers don't try to pronounce the code as a word. */}
          <span className="visually-hidden">Join code {code.split("").join(" ")}</span>
          {code.split("").map((ch, i) => (
            <span key={i} aria-hidden="true">
              {ch}
            </span>
          ))}
        </p>
      </div>
      <div className="ticket__stub">
        {qr ? <img src={qr} alt={`QR code to join session ${code}`} /> : <div className="ticket__qr-placeholder" />}
        <p>or scan</p>
      </div>
    </div>
  );
}
