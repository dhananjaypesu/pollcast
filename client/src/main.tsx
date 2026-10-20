import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Audience } from "./pages/Audience";
import { Home } from "./pages/Home";
import { Host } from "./pages/Host";
import { Screen } from "./pages/Screen";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "./styles.css";

function NotFound() {
  return (
    <main className="message-page">
      <h1>This page doesn't exist</h1>
      <Link className="button" to="/">
        Go to Pollcast
      </Link>
    </main>
  );
}

/** Codes are case-insensitive; keep URLs canonical. */
function Canonical({ prefix, children }: { prefix: string; children: React.ReactNode }) {
  const code = useParams().code ?? "";
  if (code !== code.toUpperCase()) return <Navigate replace to={`${prefix}/${code.toUpperCase()}${window.location.hash}`} />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/j" element={<Navigate replace to="/" />} />
        <Route path="/j/:code" element={<Canonical prefix="/j"><Audience /></Canonical>} />
        <Route path="/host/:code" element={<Canonical prefix="/host"><Host /></Canonical>} />
        <Route path="/screen/:code" element={<Canonical prefix="/screen"><Screen /></Canonical>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
