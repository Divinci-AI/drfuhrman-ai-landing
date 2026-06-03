import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// 36 advertised languages — kept in sync with src/i18n/locales.ts.
// (Plain array here because astro.config can't import the TS module's
// types cleanly at config-eval time; the source of truth is locales.ts
// and a unit guard asserts these two lists match.)
const LOCALES = [
  "en", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "uk", "cs", "ro",
  "el", "tr", "ar", "he", "hi", "bn", "ta", "te", "mr", "gu", "pa", "ur",
  "fa", "th", "vi", "id", "ms", "fil", "ja", "ko", "zh-hans", "zh-hant",
  "sw", "zu",
];

export default defineConfig({
  site: "https://drfuhrman.ai",
  integrations: [react()],
  i18n: {
    defaultLocale: "en",
    locales: LOCALES,
    routing: {
      // English stays at "/"; other locales get a "/es/", "/zh-hans/" prefix.
      prefixDefaultLocale: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
