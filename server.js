import http from "node:http";

const PORT = 3000;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  if (parsed.pathname === "/api/deezer") {
    const q = parsed.searchParams.get("q");
    if (!q) { res.writeHead(400); res.end("missing q"); return; }
    try {
      const upstream = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}`);
      const data = await upstream.json();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (parsed.pathname === "/api/youtube") {
    const q = parsed.searchParams.get("q");
    if (!q) { res.writeHead(400); res.end("missing q"); return; }
    try {
      const upstream = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&format=json`);
      // Fallback: return search URL for client-side embed
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ searchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`B-SIDE proxy → http://localhost:${PORT}`));
