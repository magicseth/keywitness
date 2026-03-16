import { useState, useRef, useEffect } from "react";

const links = [
  { href: "/verify", label: "Verify" },
  { href: "/manifesto", label: "Humanifesto" },
  { href: "/how", label: "How It Works" },
  { href: "/developers", label: "Developers" },
  { href: "https://github.com/magicseth/keywitness", label: "GitHub", external: true },
];

function TestFlightPopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-medium transition-colors text-gray-500 hover:text-gray-300"
      >
        TestFlight
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-[#141414] border border-gray-700 rounded-lg p-4 shadow-xl z-50">
          <p className="text-sm text-gray-300 leading-relaxed">
            DM{" "}
            <a
              href="https://x.com/magicseth"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline font-medium"
            >
              @magicseth
            </a>{" "}
            on X with:
          </p>
          <p className="text-white font-medium text-sm mt-2 bg-[#0a0a0a] border border-gray-800 rounded-md px-3 py-2">
            "I'm a human"
          </p>
          <p className="text-gray-500 text-xs mt-2">
            You'll get a TestFlight invite link back.
          </p>
        </div>
      )}
    </div>
  );
}

export default function Nav() {
  const path = window.location.pathname;

  return (
    <nav className="border-b border-gray-800 bg-[#0a0a0a]">
      <div className="max-w-3xl mx-auto px-4 flex items-center justify-between h-12">
        <a href="/" className="text-white font-bold text-sm tracking-tight">
          KeyWitness
        </a>
        <div className="flex items-center gap-6">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              {...("external" in link ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className={`text-xs font-medium transition-colors ${
                path === link.href
                  ? "text-white"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {link.label}
            </a>
          ))}
          <TestFlightPopover />
        </div>
      </div>
    </nav>
  );
}
