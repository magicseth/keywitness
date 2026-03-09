import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/embed/sdk.ts"),
      name: "KeyWitness",
      formats: ["iife"],
      fileName: () => "embed.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});
