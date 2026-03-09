import express from "express";
import cors from "cors";
import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const DATA_DIR = join(__dirname, "data");
const DATA_FILE = join(DATA_DIR, "attestations.json");

// ── Helpers ─────────────────────────────────────────────────────────────────

function ensureDataFile(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify({}), "utf-8");
  }
}

function readAttestations(): Record<string, string> {
  ensureDataFile();
  return JSON.parse(readFileSync(DATA_FILE, "utf-8"));
}

function writeAttestations(data: Record<string, string>): void {
  ensureDataFile();
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(10);
  let id = "";
  for (let i = 0; i < 10; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ── API routes ──────────────────────────────────────────────────────────────

app.post("/api/attestations", (req, res) => {
  const { attestation } = req.body;

  if (!attestation || typeof attestation !== "string") {
    res.status(400).json({ error: "Missing or invalid 'attestation' field." });
    return;
  }

  const id = generateId();
  const store = readAttestations();
  store[id] = attestation;
  writeAttestations(store);

  res.status(201).json({
    id,
    url: `https://keywitness.io/v/${id}`,
  });
});

app.get("/api/attestations/:id", (req, res) => {
  const store = readAttestations();
  const attestation = store[req.params.id];

  if (!attestation) {
    res.status(404).json({ error: "Attestation not found." });
    return;
  }

  res.json({ attestation });
});

// ── Static files (Vite build output) ───────────────────────────────────────

const distPath = join(__dirname, "dist");
if (existsSync(distPath)) {
  app.use(express.static(distPath));

  // SPA fallback: serve index.html for any non-API route
  app.get("*", (_req, res) => {
    res.sendFile(join(distPath, "index.html"));
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`KeyWitness server listening on http://0.0.0.0:${PORT}`);
});
