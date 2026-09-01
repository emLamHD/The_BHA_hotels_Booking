import path from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Stubs `*.svg` imports (handled by @svgr/webpack under Next.js, which does
 * not run under Vitest/Vite) with a minimal `<svg {...props} />` component,
 * so `@/icons` — imported throughout the Reservation Board — resolves under
 * test without pulling in an extra SVGR dependency just for Vitest.
 */
function svgStub(): Plugin {
  const virtualId = "\0virtual:svg-stub";
  return {
    name: "svg-stub",
    enforce: "pre",
    resolveId(source) {
      return source.endsWith(".svg") ? virtualId : null;
    },
    load(id) {
      if (id !== virtualId) return null;
      return `
        import React from "react";
        const SvgMock = React.forwardRef(function SvgMock(props, ref) {
          return React.createElement("svg", Object.assign({ ref }, props));
        });
        export default SvgMock;
      `;
    },
  };
}

export default defineConfig({
  plugins: [react(), svgStub()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
