// MovieBox (AOneRoom) API client — H5 web API variant.
//
// Why H5: the mobile BFF hosts (api3..api8.aoneroom.com) drop connections
// from datacenter IPs (Render Frankfurt gets "fetch failed" on all of them),
// while the H5 website API (h5-api.aoneroom.com) answers fine.
//
// Auth: an anonymous token is minted via GET /wefeed-h5api-bff/home?host=moviebox.ph
// — the `x-user` response header carries {"token":"eyJ..."}. It is sent back as
// `Authorization: Bearer <token>`. No request signing is needed for H5.

const H5_BASE = "https://h5-api.aoneroom.com";
const BFF = `${H5_BASE}/wefeed-h5api-bff`;

const H5_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
  Referer: "https://moviebox.ph/",
  Origin: "https://moviebox.ph",
  "X-Client-Info": '{"timezone":"Asia/Tehran"}',
  "X-Request-Lang": "en",
  Accept: "application/json",
  "Content-Type": "application/json",
};

let sessionToken = process.env.MB_TOKEN || null; // optional override
let playerDomain = null;
let domainExpires = 0;





























function extractToken(xuser) {
  if (!xuser) return null;
  let v = String(xuser).trim();
  if (v.startsWith("{")) {
    try {
      const o = JSON.parse(v);
      v = o.token || o.accessToken || o.access_token || (o.data && o.data.token) || "";
    } catch {
      return null;
    }
  }
  v = String(v).trim().replace(/^Bearer\s+/i, "");
  return v.startsWith("eyJ") ? v : null;
}

async function ensureToken() {
  if (sessionToken) return;
  const res = await fetch(`${BFF}/home?host=moviebox.ph`, {
    headers: H5_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`BOOTSTRAP_HTTP_${res.status}`);
  const t = extractToken(res.headers.get("x-user"));
  if (!t) throw new Error("BOOTSTRAP_NO_TOKEN");
  sessionToken = t;
}
async function api(method, path, payload, opts = {}) {
  await ensureToken();
  const base = opts.base || BFF;
  const extraHeaders = opts.headers || {};
  const attempt = () =>
    fetch(base + path, {
      method,
      headers: { ...H5_HEADERS, Authorization: `Bearer ${sessionToken}`, ...extraHeaders },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  let res = await attempt();
  const rotated = extractToken(res.headers.get("x-user"));
  if (rotated) sessionToken = rotated;
  if (res.status === 401 || res.status === 441) {
    // Token expired/invalid → mint a fresh one and retry once.
    sessionToken = null;
    await ensureToken();
    res = await attempt();
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("BAD_JSON");
  }
  if (json.code !== 0) throw new Error(`API error ${json.code}: ${json.message || ""}`);
  return json.data;
}

async function getPlayerDomain() {
  if (playerDomain && Date.now() < domainExpires) return playerDomain;
  const d = await api("GET", "/media-player/get-domain");
  playerDomain = (typeof d === "string" ? d : d.domain || "").replace(/\/+$/, "");
  if (!playerDomain) throw new Error("NO_PLAYER_DOMAIN");
  domainExpires = Date.now() + 5 * 60 * 1000;
  return playerDomain;
}

// Home sections (Popular Movie / Popular Series / ...) — the browse catalogs.
async function homeSections() {
  const data = await api("GET", "/home?host=moviebox.ph");
  return data.operatingList || [];
}

function subjectsOfType(sections, wantMovie) {
  const out = [];
  for (const op of sections) {
    if (op.type !== "SUBJECTS_MOVIE" && op.type !== "SUBJECTS_TV") continue;
    for (const s of op.subjects || []) {
      if (!s || !s.subjectId || !s.detailPath) continue;
      const isMovie = s.subjectType === 1;
      if (isMovie === wantMovie) out.push(s);
    }
  }
  // de-dupe by subjectId, keep order
  const seen = new Set();
  return out.filter((s) => (seen.has(s.subjectId) ? false : (seen.add(s.subjectId), true)));
}





module.exports = {
  // Search → { results: [{ topicType, subjects }] } (same shape as before)
  search: (keyword, page = 1, perPage = 20) =>
    api("POST", "/subject/search", { keyword, page, perPage }).then((data) => ({
      results: [{ topicType: 0, subjects: data.items || data.list || [] }],
      pager: data.pager,
    })),

  // Movies catalog: "Popular Movie"-style home sections (subjectType 1)
  dailyRec: (page = 1, perPage = 20) =>
    homeSections().then((sections) => ({
      subjects: subjectsOfType(sections, true),
    })),

  // Series catalog (subjectType 2) — shaped like the old trending()
  trending: (page = 1, perPage = 20) =>
    homeSections().then((sections) => ({
      items: subjectsOfType(sections, false).map((s) => ({ subject: s })),
    })),

  // Full subject metadata, looked up by detail slug (detailPath)
  getSubject: (slug) =>
    api("GET", `/detail?detailPath=${encodeURIComponent(slug)}`).then((data) => data.subject),

  // Seasons → { seasons: [{ season, episodeCount }] }
  seasonInfo: (slug) =>
    api("GET", `/detail?detailPath=${encodeURIComponent(slug)}`).then((data) => ({
      seasons: ((data.resource || {}).seasons || []).map((sn) => ({
        season: sn.se,
        episodeCount: sn.maxEp,
      })),
    })),

  // Episode list derived from seasons (H5 exposes no per-episode resource list)
  resources: (slug, se) =>
    module.exports.seasonInfo(slug).then((info) => {
      const sn = (info.seasons || []).find((x) => x.season === Number(se));
      const n = sn ? sn.episodeCount || 0 : 0;
      return {
        resources: Array.from({ length: n }, (_, i) => ({
          resourceId: `${se}-${i + 1}`,
          episode: i + 1,
          title: `Episode ${i + 1}`,
        })),
      };
    }),

  // Streams. Movies use se=0/ep=0, series use their season/episode numbers.
  playInfo: (subjectId, slug, se, ep) =>
    getPlayerDomain()
      .then((domain) => {
        const bff = `${domain}/wefeed-h5api-bff`;
        const ref =
          `${domain}/spa/videoPlayPage/movies/${slug}` +
          `?id=${subjectId}&type=/movie/detail&detailSe=${se}&detailEp=${ep}&lang=en`;
        return api(
          "GET",
          `/subject/play?subjectId=${subjectId}&se=${se}&ep=${ep}&detailPath=${encodeURIComponent(slug)}`,
          null,
          { base: bff, headers: { Referer: ref } }
        );
      })
      .then((data) => ({
        streams: [...(data.streams || []), ...(data.hls || []), ...(data.dash || [])],
        hasResource: data.hasResource,
      })),

  // Subtitle tracks for one stream
  streamCaptions: (subjectId, slug, streamId, format) =>
    api(
      "GET",
      `/subject/caption?format=${encodeURIComponent(format || "MP4")}` +
        `&id=${encodeURIComponent(streamId)}&subjectId=${subjectId}` +
        `&detailPath=${encodeURIComponent(slug)}`
    ).then((data) => (data && data.captions) || (Array.isArray(data) ? data : [])),
};




















