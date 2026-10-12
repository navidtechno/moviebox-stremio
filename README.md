# MovieBox Stremio Addon

Unofficial Stremio addon for the MovieBox catalog. Install in Nuvio/Stremio via the manifest URL.

## Deploy (Render, free)

1. Push this repo to GitHub.
2. On render.com: New > Web Service > select this repo.
3. Build Command: `npm install`, Start Command: `node server.js`, Instance Type: Free.
4. Add `https://<your-service>.onrender.com/manifest.json` in Nuvio > Addons.

## Note

The MovieBox API geo-blocks some regions (incl. Iran). Host this addon on a server outside the blocked region.
