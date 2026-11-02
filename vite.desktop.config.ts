// Build tylko dla aplikacji na Maca: tryb SPA (bez serwera), ładowany lokalnie w Electronie.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    spa: { enabled: true },
  },
});
