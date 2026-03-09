import Verify from "./pages/Verify";
import HowItWorks from "./pages/HowItWorks";
import Developers from "./pages/Developers";
import Manifesto from "./pages/Manifesto";
import BLEDemo from "./pages/BLEDemo";

export default function App() {
  const path = window.location.pathname;

  if (path === "/how") {
    return <HowItWorks />;
  }

  if (path === "/developers") {
    return <Developers />;
  }

  if (path === "/manifesto") {
    return <Manifesto />;
  }

  if (path === "/demo") {
    return <BLEDemo />;
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

  return <Verify />;
}
