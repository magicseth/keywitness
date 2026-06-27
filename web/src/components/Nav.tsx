const links = [
  { href: "/verify", label: "Verify" },
  { href: "/manifesto", label: "Humanifesto" },
  { href: "/how", label: "How It Works" },
  { href: "/developers", label: "Developers" },
  { href: "https://github.com/magicseth/keywitness", label: "GitHub", external: true },
];

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
          <a
            href="https://apps.apple.com/us/app/keywitness/id6760276383"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white text-black hover:bg-gray-200 transition-colors"
          >
            Download
          </a>
        </div>
      </div>
    </nav>
  );
}
