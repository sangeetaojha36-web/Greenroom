import app from "../server.js";

export default function handler(req, res) {
  try {
    const rawUrl = req.url || "/";
    const parsed = new URL(rawUrl, "http://localhost");
    const queryPath = parsed.searchParams.get("path");
    const matchedPath = req.headers["x-matched-path"] || req.headers["x-vercel-matched-path"];

    if (queryPath && queryPath.startsWith("/api")) {
      parsed.searchParams.delete("path");
      const rest = parsed.searchParams.toString();
      req.url = queryPath + (rest ? `?${rest}` : "");
    } else if (matchedPath && matchedPath.startsWith("/api")) {
      parsed.searchParams.delete("path");
      const rest = parsed.searchParams.toString();
      req.url = matchedPath + (rest ? `?${rest}` : "");
    } else if (req.query && req.query.slug) {
      const slugPath = Array.isArray(req.query.slug) ? req.query.slug.join("/") : req.query.slug;
      delete req.query.slug;
      parsed.searchParams.delete("slug");
      const rest = parsed.searchParams.toString();
      req.url = `/api/${slugPath}` + (rest ? `?${rest}` : "");
    } else if (req.url.startsWith("/api/index.js") || req.url.startsWith("/api/index")) {
      req.url = req.url.replace(/^\/api\/index(\.js)?/, "/api") || "/api";
    }
  } catch (e) {
    // ignore
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    return res.status(204).end();
  }

  return app(req, res);
}
