import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  preview: {
    functions: {
      torusapi: {
        name: "Torus compatibility API",
        source: "./functions/api.ts",
      },
    },
  },
});
