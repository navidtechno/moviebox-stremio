// Starts the MovieBox Stremio addon HTTP server.
//   PORT=7000 node server.js
// Then add this manifest URL in Nuvio/Stremio:
//   http://<server-ip>:7000/manifest.json

const express = require("express");
const { getRouter } = require("stremio-addon-sdk");
const addonInterface = require("./src/addon");

const PORT = Number(process.env.PORT || 7000);
const app = express();

// ---------------------------------------------------------------------------
// Video/subtitle proxy: Nuvio -> this server -> MovieBox CDN.
//
// Needed because the MovieBox CDN (hakunaymatata.com) blocks many client IPs
// outright (HTTP 429 / geo-block), and the signed stream URLs may be locked
// to the IP that requested them from the play API (this server). Proxying
// keeps the whole chain on one IP.
// Only *.hakunaymatata.com targets are allowed (no open proxy).
// ---------------------------------------------------------------------------
const CDN_RE = /^https:\/\/[a-z0-9.-]*hakunaymatata\.com\//i;

function decodeTarget(token) {
  const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

app.get("/proxy/:token", async (req, res) => {
  let target;
  try {
    target = decodeTarget(req.params.token);
  } catch {
    return res.status(400).send("bad token");
  }
  if (!CDN_RE.test(target)) return res.status(400).send("bad host");

  try {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    };
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await fetch(target, {
      headers,
      signal: AbortSignal.timeout(30000),
      redirect: "follow",
    });
    if (upstream.status !== 200 && upstream.status !== 206) {
      return res.status(upstream.status).send(`upstream ${upstream.status}`);
    }
    res.status(upstream.status);
    for (const [k, v] of upstream.headers) {
      const kl = k.toLowerCase();
      if (["content-type", "content-length", "content-range", "accept-ranges"].includes(kl)) {
        res.setHeader(k, v);
      }
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) await new Promise((r) => res.once("drain", r));
      }
    }
    res.end();
  } catch (e) {
    console.error("[proxy]", e.message);
    if (!res.headersSent) res.status(502).send("proxy failed");
    else res.end();
  }
});

// Stremio addon routes (manifest, catalog, meta, stream)
app.use(getRouter(addonInterface));

app.listen(PORT, () => {
  console.log(`MovieBox Stremio addon listening on http://0.0.0.0:${PORT}/manifest.json`);
  console.log("Using the MovieBox H5 web API (no datacenter IP block observed).");
});
