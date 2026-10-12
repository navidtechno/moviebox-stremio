// Stremio addon powered by the MovieBox (AOneRoom) backend.
// Install in Nuvio / Stremio via the manifest URL:  http://<host>:<port>/manifest.json

const { addonBuilder } = require("stremio-addon-sdk");
const mb = require("./moviebox");

const PREFIX = "mb:";
const PER_PAGE = 20; const PUBLIC_URL = (process.env.PUBLIC_URL || "https://moviebox-stremio-2gi8.onrender.com").replace(/\/+$/, ""); const proxyUrl = (u) => `${PUBLIC_URL}/proxy/${Buffer.from(u, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;

// ---- tiny TTL cache ---------------------------------------------------------
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const p = fn().then((v) => {
    cache.set(key, { t: Date.now(), v });
    return v;
  });
  p.catch(() => cache.delete(key));
  return p;
}

// ---- mapping ----------------------------------------------------------------
function img(url) {
  if (!url) return undefined;
  return url.startsWith("http") ? url : `https://pbcdn.aoneroom.com/${url}`;
}

function toMetaPreview(s) {
  if (!s || !s.subjectId || !s.detailPath) return null;
  return {
    id: `${PREFIX}${s.subjectId}:${s.detailPath}`,
    type: s.subjectType === 1 ? "movie" : "series",
    name: s.title || "Unknown",
    poster: img(s.cover && s.cover.url),
    background: img(s.stills && s.stills.url),
    description: s.description,
    releaseInfo: s.releaseDate ? s.releaseDate.slice(0, 4) : undefined,
    imdbRating: s.imdbRatingValue ? String(s.imdbRatingValue) : undefined,
    genres: s.genre ? s.genre.split(",").map((g) => g.trim()).filter(Boolean) : undefined,
    runtime: s.duration,
  };
}

function parseId(id) {
  // mb:<subjectId>:<slug>            → meta
  // mb:<subjectId>:<slug>:<se>:<ep>   → episode / stream
  const parts = id.replace(PREFIX, "").split(":");
  return {
    subjectId: parts[0],
    slug: parts[1] || "",
    se: parts[2] ? Number(parts[2]) : 0,
    ep: parts[3] ? Number(parts[3]) : 0,
  };
}




















// ---- manifest ---------------------------------------------------------------
const manifest = {
  id: "community.moviebox",
  version: "1.0.0",
  name: "MovieBox",
  description: "Movies & series from the MovieBox catalog (unofficial addon).",
  resources: ["catalog", "meta", "stream"],
  types: ["movie", "series"],
  idPrefixes: [PREFIX],
  catalogs: [
    {
      type: "movie",
      id: "moviebox-movies",
      name: "MovieBox Movies",
      extra: [{ name: "search" }, { name: "skip" }],
    },
    {
      type: "series",
      id: "moviebox-series",
      name: "MovieBox Series",
      extra: [{ name: "search" }, { name: "skip" }],
    },
  ],
};

const builder = new addonBuilder(manifest);

// ---- catalog ----------------------------------------------------------------
builder.defineCatalogHandler(async ({ type, extra }) => {
  try {
    const skip = Number(extra && extra.search ? 0 : (extra && extra.skip) || 0);
    const page = Math.floor(skip / PER_PAGE) + 1;
    let subjects = [];
    if (extra && extra.search) {
      const data = await mb.search(extra.search, page, PER_PAGE);
      const groups = data.results || [];
      subjects = groups.flatMap((g) => g.subjects || []);
    } else if (type === "movie") {
      const data = await cached("rec", 10 * 60 * 1000, () => mb.dailyRec(1, 200));
      subjects = (data.subjects || []).slice(skip, skip + PER_PAGE);
    } else {
      const data = await cached("trend", 10 * 60 * 1000, () => mb.trending(1, 200));
      subjects = (data.items || [])
        .map((i) => i.subject)
        .filter(Boolean)
        .slice(skip, skip + PER_PAGE);
    }
    const wantMovie = type === "movie";
    const metas = subjects
      .filter((s) => (s.subjectType === 1) === wantMovie || (extra && extra.search))
      .map(toMetaPreview)
      .filter(Boolean)
      // when searching, keep only matching type
      .filter((m) => m.type === type);
    return { metas };
  } catch (e) {
    console.error("[catalog]", e.message);
    return { metas: [] };
  }
});
// ---- meta -------------------------------------------------------------------
builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const { subjectId, slug } = parseId(id);
    const s = await cached(`meta:${subjectId}`, 30 * 60 * 1000, () => mb.getSubject(slug));
    const meta = toMetaPreview(s) || { id, type, name: "Unknown" };
    meta.id = id;
    meta.type = type;

    if (type === "series") {
      const info = await cached(`seasons:${subjectId}`, 30 * 60 * 1000, () => mb.seasonInfo(slug));
      const videos = [];
      for (const sn of info.seasons || []) {
        const se = sn.season;
        if (!se) continue; // se=0 is the movie placeholder
        let eps = sn.episodeCount;
        if (!eps) {
          try {
            const r = await mb.resources(slug, se);
            eps = Math.max(0, ...(r.resources || []).map((x) => x.episode || 0));
          } catch { eps = 0; }
        }
        for (let ep = 1; ep <= (eps || 0); ep++) {
          videos.push({
            id: `${PREFIX}${subjectId}:${slug}:${se}:${ep}`,
            title: `Episode ${ep}`,
            season: se,
            episode: ep,
            released: sn.releaseDate ? new Date(sn.releaseDate).toISOString() : undefined,
          });
        }
      }
      meta.videos = videos;
    }
    return { meta };
  } catch (e) {
    console.error("[meta]", id, e.message);
    return { meta: { id, type, name: "Unavailable" } };
  }
});
// ---- stream -----------------------------------------------------------------
const QUALITY_RANK = { "1080p": 4, "1080": 4, "720p": 3, "720": 3, "480p": 2, "480": 2, "360p": 1, "360": 1 };

builder.defineStreamHandler(async ({ type, id }) => {
  try {
    const { subjectId, slug, se, ep } = parseId(id);
    // H5 play API: movies use se=0/ep=0, series use their season/episode.
    const SE = type === "movie" ? 0 : se || 1;
    const EP = type === "movie" ? 0 : ep || 1;

    const info = await mb.playInfo(subjectId, slug, SE, EP);
    const raw = [...(info.streams || []), ...(info.hls || [])].filter((s) => s && s.url);
    if (!raw.length) return { streams: [] };

    raw.sort(
      (a, b) =>
        (QUALITY_RANK[String(b.resolutions || b.quality)] || 0) -
        (QUALITY_RANK[String(a.resolutions || a.quality)] || 0)
    );

    const streams = raw.map((s) => ({
      url: s.url,
      title: `MovieBox ${s.resolutions || s.quality || ""}`.trim(),
      behaviorHints: { notWebReady: false },
    }));

    // Subtitles (best effort)
    const firstId = raw[0].id || raw[0].resourceId;
    let subtitles;
    if (firstId) {
      try {
        const caps = await mb.streamCaptions(subjectId, slug, String(firstId), raw[0].format);
        const list = Array.isArray(caps) ? caps : caps.captions || caps.subtitles || [];
        subtitles = list
          .filter((c) => c && c.url)
          .map((c) => ({ url: c.url, lang: c.language || c.lang || "en" }));
      } catch { /* subtitles optional */ }
    }

    if (subtitles && subtitles.length) streams.forEach((st) => (st.subtitles = subtitles));
    return { streams };
  } catch (e) {
    console.error("[stream]", id, e.message);
    return { streams: [] };
  }
});

module.exports = builder.getInterface();




















