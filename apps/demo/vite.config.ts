import { defineConfig, type Plugin } from "vite";

/**
 * Development CORS proxy.
 *
 * Most national geoportals answer without `Access-Control-Allow-Origin`, so a
 * browser cannot fetch their tiles directly. This middleware forwards
 * `/cors-proxy?url=<encoded>` server side, which is exactly what the
 * `proxyUrl` option of `@orthogea/client` is designed for.
 *
 * Only hosts that appear in the catalogue are forwarded, so the dev server
 * cannot be used as an open relay.
 */
function corsProxy(allowedHosts: () => Promise<Set<string>>): Plugin {
  return {
    name: "orthogea-cors-proxy",
    configureServer(server) {
      let hosts: Set<string> | undefined;

      server.middlewares.use("/cors-proxy", async (request, response) => {
        const target = new URL(request.url ?? "", "http://localhost").searchParams.get("url");
        if (!target) {
          response.statusCode = 400;
          response.end("Missing url parameter");
          return;
        }

        let upstream: URL;
        try {
          upstream = new URL(target);
        } catch {
          response.statusCode = 400;
          response.end("Malformed url parameter");
          return;
        }

        hosts ??= await allowedHosts();
        if (!hosts.has(upstream.hostname)) {
          response.statusCode = 403;
          response.end(`Host ${upstream.hostname} is not part of the OrthoGea catalogue`);
          return;
        }

        try {
          const proxied = await fetch(upstream, {
            headers: { Accept: request.headers.accept ?? "*/*" },
            redirect: "follow"
          });
          const body = Buffer.from(await proxied.arrayBuffer());
          response.statusCode = proxied.status;
          response.setHeader(
            "content-type",
            proxied.headers.get("content-type") ?? "application/octet-stream"
          );
          response.setHeader("access-control-allow-origin", "*");
          response.setHeader("cache-control", "public, max-age=600");
          response.end(body);
        } catch (error) {
          response.statusCode = 502;
          response.end(`Upstream request failed: ${(error as Error).message}`);
        }
      });
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [
    corsProxy(async () => {
      const { catalog } = await import("@orthogea/catalog");
      const hosts = new Set<string>();
      for (const layer of catalog) {
        hosts.add(new URL(layer.service.url).hostname);
        if (layer.service.type === "XYZ") {
          hosts.add(new URL(layer.service.options.urlTemplate.replace(/\{[^}]+\}/g, "0")).hostname);
        }
        if (layer.service.type === "WMTS" && layer.service.options.urlTemplate) {
          hosts.add(
            new URL(layer.service.options.urlTemplate.replace(/\{[^}]+\}/g, "0")).hostname
          );
        }
      }
      return hosts;
    })
  ],
  server: {
    port: 5173,
    open: false
  },
  build: {
    target: "es2022",
    sourcemap: true
  }
});
