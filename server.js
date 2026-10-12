// Starts the MovieBox Stremio addon HTTP server.
//   PORT=7000 node server.js
// Then add this manifest URL in Nuvio/Stremio:
//   http://<server-ip>:7000/manifest.json

const { serveHTTP } = require("stremio-addon-sdk");
const addon = require("./src/addon");

const PORT = Number(process.env.PORT || 7000);
serveHTTP(addon, { port: PORT });
console.log(`MovieBox Stremio addon listening on http://0.0.0.0:${PORT}/manifest.json`);
console.log("Using the MovieBox H5 web API (no datacenter IP block observed).");
