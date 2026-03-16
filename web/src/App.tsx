import { lazy, Suspense } from "react";
import Verify from "./pages/Verify";

const HowItWorks = lazy(() => import("./pages/HowItWorks"));
const Developers = lazy(() => import("./pages/Developers"));
const Manifesto = lazy(() => import("./pages/Manifesto"));
const BLEDemo = lazy(() => import("./pages/BLEDemo"));
const Landing = lazy(() => import("./pages/Landing"));

function Loading() {
  return <div className="min-h-screen bg-[#0a0a0a]" />;
}

export default function App() {
  const path = window.location.pathname;

  if (path === "/how") {
    return <Suspense fallback={<Loading />}><HowItWorks /></Suspense>;
  }

  if (path === "/developers") {
    return <Suspense fallback={<Loading />}><Developers /></Suspense>;
  }

  if (path === "/manifesto") {
    return <Suspense fallback={<Loading />}><Manifesto /></Suspense>;
  }

  if (path === "/demo") {
    return <Suspense fallback={<Loading />}><BLEDemo /></Suspense>;
  }

  if (path === "/verify") {
    return <Verify />;
  }

  // /v/{shortId} — direct short ID
  const shortIdMatch = path.match(/^\/v\/([a-zA-Z0-9]+)$/);
  if (shortIdMatch) {
    return <Verify shortId={shortIdMatch[1]} />;
  }

  // /{username}/{seq} — typed.by vanity URL
  const vanityMatch = path.match(/^\/([a-zA-Z][a-zA-Z0-9_-]{2,29})\/(\d+)$/);
  if (vanityMatch) {
    return <Verify username={vanityMatch[1]} usernameSeq={parseInt(vanityMatch[2], 10)} />;
  }

  // Existing links use /?a=SHORTID — show Verify if query params present
  const params = new URLSearchParams(window.location.search);
  if (params.has("a")) {
    return <Verify />;
  }

  return <Suspense fallback={<Loading />}><Landing /></Suspense>;
}
