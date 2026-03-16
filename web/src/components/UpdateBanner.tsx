import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useEffect, useRef, useState } from "react";

export default function UpdateBanner() {
  const deployment = useQuery(api.selfHosting.getCurrentDeployment);
  const initialDeploymentId = useRef<string | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!deployment?.currentDeploymentId) return;

    if (initialDeploymentId.current === null) {
      // First load — record the deployment we started with
      initialDeploymentId.current = deployment.currentDeploymentId;
    } else if (deployment.currentDeploymentId !== initialDeploymentId.current) {
      // Deployment changed while the page was open
      setShowBanner(true);
    }
  }, [deployment?.currentDeploymentId]);

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white text-sm font-medium px-5 py-2.5 rounded-full shadow-lg flex items-center gap-3 animate-fade-in">
      A new version is available
      <button
        onClick={() => window.location.reload()}
        className="bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full text-xs font-semibold transition-colors"
      >
        Refresh
      </button>
    </div>
  );
}
