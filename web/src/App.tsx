import Verify from "./pages/Verify";

export default function App() {
  // Simple client-side routing: check for /v/:id pattern
  const path = window.location.pathname;
  const match = path.match(/^\/v\/([a-zA-Z0-9]+)$/);
  const shortId = match ? match[1] : undefined;

  return <Verify shortId={shortId} />;
}
