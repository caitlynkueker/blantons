// The review pipeline: unzip -> ffmpeg frames+audio -> Claude review against the
// NC residential checklist -> standardized report -> POST back to the hub.
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
import { buildReport } from "./report.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const FRAME_FPS = process.env.FRAME_FPS || "0.5";
const MAX_IMAGES = parseInt(process.env.MAX_IMAGES || "42", 10);
const HUB_SUBMIT_URL = process.env.HUB_SUBMIT_URL || "https://qcinstall.netlify.app/.netlify/functions/qc-submit";
const HUB_LESSONS_URL = process.env.HUB_LESSONS_URL || HUB_SUBMIT_URL.replace(/qc-submit\/?$/, "qc-lessons");

// Pull the labeled inspection outcomes managers have taught, so the review weights
// real pass/fail patterns. Best-effort — never blocks the review if it fails.
async function fetchLessons() {
  try {
    const r = await fetch(HUB_LESSONS_URL, { headers: { "X-QC-Key": process.env.QC_SUBMIT_KEY || "" } });
    if (!r.ok) return "";
    const j = await r.json();
    const ls = (j.lessons || []).slice(0, 40);
    if (!ls.length) return "";
    const lines = ls.map((l) => `- Job ${l.job}: inspection ${String(l.outcome).toUpperCase()}${l.why ? " — " + l.why : ""}`);
    return `\n\nLEARNED FROM BLANTON'S INSPECTORS (real outcomes managers labeled — weight these patterns; a repeat of a past FAILED reason should be flagged, a past PASSED pattern should not be over-flagged):\n${lines.join("\n")}`;
  } catch { return ""; }
}

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
const isImg = (f) => /\.(jpe?g|png|heic|heif|webp)$/i.test(f);
const isVid = (f) => /\.(mp4|mov|m4v|avi|3gp)$/i.test(f);
const isAud = (f) => /\.(wav|m4a|aac|mp3|caf)$/i.test(f);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "__MACOSX") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

// Shrink to <=1200px, jpeg q72 — keeps plates legible while cutting token cost.
function toJpeg(src, dst) {
  try { sh("convert", [src + "[0]", "-auto-orient", "-resize", "1200x1200>", "-quality", "72", dst]); return fs.existsSync(dst); }
  catch { return false; }
}

export async function reviewJob({ job, zipPath, name }) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `qc_${job}_`));
  const media = path.join(work, "media"); fs.mkdirSync(media, { recursive: true });
  const prep = path.join(work, "prep"); fs.mkdirSync(prep, { recursive: true });

  try {
  try { sh("unzip", ["-o", zipPath, "-d", media]); }
  catch (e) { throw new Error("unzip failed: " + e.message); }

  const files = walk(media);
  const photos = files.filter(isImg);
  const videos = files.filter(isVid);
  const audios = files.filter(isAud);

  // Prep images: originals first (they hold the data plates), then sampled frames.
  const prepped = []; let n = 0;
  for (const p of photos) { const dst = path.join(prep, `p_${n++}.jpg`); if (toJpeg(p, dst)) prepped.push({ path: dst, kind: "photo", src: path.basename(p) }); }
  let vi = 0, audioDecoded = 0, audioFailed = 0;
  for (const v of videos) {
    vi++; const fdir = path.join(prep, `v${vi}`); fs.mkdirSync(fdir, { recursive: true });
    try { sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", v, "-vf", `fps=${FRAME_FPS}`, path.join(fdir, "f_%03d.jpg")]); } catch {}
    // extract audio (best-effort; transcription not done here — reviewer listens)
    try { sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", v, "-vn", "-ac", "1", "-ar", "16000", path.join(prep, `a${vi}.wav`)]); audioDecoded++; } catch { audioFailed++; }
    for (const f of (fs.existsSync(fdir) ? fs.readdirSync(fdir) : [])) prepped.push({ path: path.join(fdir, f), kind: "frame", src: `${path.basename(v)}` });
  }
  audioFailed += audios.length ? 0 : 0; // standalone audio files just count as present
  const audioPresent = audios.length + videos.length > 0;

  // Cap total images: keep ALL photos, fill the rest with evenly-sampled frames.
  const photoImgs = prepped.filter((x) => x.kind === "photo");
  const frameImgs = prepped.filter((x) => x.kind === "frame");
  const room = Math.max(0, MAX_IMAGES - photoImgs.length);
  const step = frameImgs.length > room && room > 0 ? Math.ceil(frameImgs.length / room) : 1;
  const chosenFrames = room > 0 ? frameImgs.filter((_, i) => i % step === 0).slice(0, room) : [];
  const chosen = [...photoImgs, ...chosenFrames];

  const images = chosen.map((x, i) => ({ index: i, kind: x.kind, src: x.src, b64: fs.readFileSync(x.path).toString("base64") }));

  // ---- Claude review ----
  const anthropic = new Anthropic();
  const content = [];
  images.forEach((im) => {
    content.push({ type: "text", text: `Image ${im.index} (${im.kind}${im.kind === "frame" ? " from " + im.src : ""}):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: im.b64 } });
  });
  const lessonsText = await fetchLessons();
  content.push({ type: "text", text:
    `JOB NUMBER: ${job}\n` +
    `MEDIA: ${photos.length} photos, ${videos.length} videos (${images.filter(i=>i.kind==="frame").length} frames sampled), audio ${audioPresent ? "present (not transcribed — reviewer to listen)" : "none"}.` +
    lessonsText + `\n\n` +
    `Review this completed NC residential HVAC install per your instructions. Return ONLY the JSON object described in your instructions — no prose, no markdown fences.` });

  const msg = await anthropic.messages.create({
    model: MODEL, max_tokens: 4096, system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  const raw = (msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const data = parseJson(raw);
  if (!data) throw new Error("model did not return parseable JSON");

  // Attach referenced images (plates + finding evidence) for the report.
  data._images = images;
  data.job = job;
  data.audio = { present: audioPresent, failed: audioFailed };

  const html = buildReport(data);
  const counts = data.counts || {};
  const payload = {
    job, status: data.status || "Ready for Manager Review",
    reviewer: "AI QC (engine)", equipment: shortEquip(data.equipment),
    counts: { open: counts.open || (data.findings || []).length, el: counts.el || 0, doc: counts.doc || 0, cleared: counts.cleared || 0 },
    blocker: data.blocker || "", findings: (data.findings || []).map(stripImg), reportHtml: html,
  };

  const r = await fetch(HUB_SUBMIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-QC-Key": process.env.QC_SUBMIT_KEY || "" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`hub rejected post: HTTP ${r.status} ${await r.text().catch(() => "")}`);
  return { status: payload.status };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

function shortEquip(e) {
  if (!e) return "";
  if (e.system || e.refrigerant) return [e.system, e.refrigerant].filter(Boolean).join(" · ");
  return "";
}
function stripImg(f) { const { image_index, ...rest } = f || {}; return rest; }

function parseJson(s) {
  if (!s) return null;
  let t = s.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}
