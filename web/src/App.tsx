import Verify from "./pages/Verify";
import HowItWorks from "./pages/HowItWorks";

export default function App() {
  const path = window.location.pathname;

  if (path === "/how") {
    return <HowItWorks />;
  }

  const match = path.match(/^\/v\/([a-zA-Z0-9]+)$/);
  const shortId = match ? match[1] : undefined;

  return <Verify shortId={shortId} />;
}
