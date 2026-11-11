import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [{ name: 'test-browser-cache-versions', enforce: 'pre',
    async resolveId(id, importer) {
      if (/\.js\?v=/.test(id)) return this.resolve(id.split('?')[0], importer, { skipSelf: true });
    },
  }],
  test: { environment: "node" },
});
