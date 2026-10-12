// Minimal MovieBox (AOneRoom) API client.
// Hosts and protocol reverse-engineered from the MovieBox Android APK
// (package com.community.oneroom) and verified against the live API:
// every endpoint below answers with MovieBox JSON (or a region 403)
// instead of 404, which confirms the paths.

const { sign, clientToken } = require("./sign");

const HOSTS = [
  "https://api6.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api7.aoneroom.com",
  "https://api8.aoneroom.com",
  "https://api.inmoviebox.com",
];

const CLIENT_INFO = JSON.stringify({
  package_name: "com.community.oneroom",
  version_name: "4.0.01.0813.03",
  version_code: 50020121,
  os: "android",
  os_version: "14",
  install_ch: "google-play",
  device_id: "2634a18e740b105fa3d032f2a0f9a568",
  install_store: "gp",
  brand: "Redmi",
  model: "23106RN0DA",
  system_language: "en",
  net: "NETWORK_WIFI",
  region: "US",
  timezone: "America/New_York",
  sp_code: "62120",
  "X-Child-UID": "",
  "X-Play-Mode": "2",
  "X-Idle-Data": "1",
  "X-Family-Mode": "0",
  "X-Content-Mode": "0",
});

let sessionToken = process.env.MB_TOKEN || null; // optional override
let hostIndex = 0;

function headers(method, url, body) {
  const ct = method === "POST" ? "application/json; charset=utf-8" : "";
  const h = {
    "x-tr-signature": sign(url, { method, contentType: ct, body: body || "" }),
    "x-client-token": clientToken(),
    "x-client-info": CLIENT_INFO,
    "user-agent": "okhttp/4.9.3",
    accept: "application/json",
  };
  if (ct) h["content-type"] = ct;
  if (sessionToken) h["authorization"] = `Bearer ${sessionToken}`;
  return h;
}

async function request(method, path, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  let lastErr = null;
  for (let i = 0; i < HOSTS.length; i++) {
    const host = HOSTS[(hostIndex + i) % HOSTS.length];
    const url = host + path;
    try {
      const res = await fetch(url, {
        method,
        headers: headers(method, url, body),
        body: method === "POST" ? body : undefined,
        signal: AbortSignal.timeout(20000),
      });
      // Capture session token from the x-user response header when present.
      const xuser = res.headers.get("x-user");
      if (xuser && xuser.startsWith("Bearer ")) {
        sessionToken = xuser.slice(7);
      }
      const text = await res.text();
      if (res.status === 403 && text.includes("current region")) {
        const e = new Error("REGION_BLOCKED");
        e.regionBlocked = true;
        throw e;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      if (json.code !== 0)
        throw new Error(`API error ${json.code}: ${json.message}`);
      hostIndex = (hostIndex + i) % HOSTS.length; // stick to working host
      return json.data;
    } catch (e) {
      lastErr = e;
      if (e.regionBlocked) throw e; // region block is IP-based; other hosts won't help
    }
  }
  throw lastErr;
}

const get = (path) => request("GET", path);
const post = (path, body) => request("POST", path, body);
const qs = (o) => new URLSearchParams(o).toString();

module.exports = {
  // Search movies & shows. Returns { results: [{ topicType, subjects: [...] }], pager }
  search: (keyword, page = 1, perPage = 20) =>
    post("/wefeed-mobile-bff/subject-api/search/v2", { keyword, page, perPage }),

  // Full metadata for a title. se = season number for series (omit for movies).
  getSubject: (subjectId, se) =>
    get(`/wefeed-mobile-bff/subject-api/get?${qs(se ? { subjectId, se } : { subjectId })}`),

  // Seasons of a series: { seasons: [{ season, subjectId, title, episodeCount, cover }] }
  seasonInfo: (subjectId) =>
    get(`/wefeed-mobile-bff/subject-api/season-info?${qs({ subjectId })}`),

  // Episode list of a season: { resources: [{ resourceId, episode, title, hasSource }] }
  resources: (subjectId, se, page = 1, perPage = 50) =>
    get(
      `/wefeed-mobile-bff/subject-api/resource?${qs({
        subjectId, se: String(se), page: String(page),
        perPage: String(perPage), all: "1", pagerMode: "0", resolution: "0",
      })}`
    ),

  // Stream URLs for one episode: { streams: [{ url, resolutions|quality, format, signCookie }], subtitles? }
  playInfo: (subjectId, se, ep) =>
    get(`/wefeed-mobile-bff/subject-api/play-info?${qs({ subjectId, se: String(se), ep: String(ep) })}`),

  // Embedded subtitle tracks of a stream (streamId from play-info).
  streamCaptions: (subjectId, streamId) =>
    get(`/wefeed-mobile-bff/subject-api/get-stream-captions?${qs({ subjectId, streamId })}`),

  // Trending / everyone's searches: { items: [{ subject }] }
  trending: (everyoneSearch = 2) =>
    get(`/wefeed-mobile-bff/subject-api/search-rank?${qs({ everyoneSearch: String(everyoneSearch) })}`),

  // Daily movie recommendations: { subjects: [...] }
  dailyRec: (page = 1, perPage = 20) =>
    post("/wefeed-mobile-bff/subject-api/daily-movie-rec", { page, perPage }),
};
