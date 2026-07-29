// Renders Blanton's Standardized QC Report HTML from the review JSON, embedding
// the referenced plate + evidence images as base64. Matches the skill template.
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function img(images, idx) {
  if (idx == null || !images || !images[idx]) return "";
  return `<img class="ev" src="data:image/jpeg;base64,${images[idx].b64}">`;
}

export function buildReport(d) {
  const images = d._images || [];
  const c = d.counts || {};
  const eq = d.equipment || {};
  const rows = (eq.rows || []).map((r) => `<div class="kv">${esc(r[0])}</div><div>${esc(r[1])}</div>`).join("");
  const plates = (eq.plate_image_indexes || []).map((i) => img(images, i)).join("");
  const cleared = (d.cleared || []).map((x) => `<li>${esc(x)}</li>`).join("") || "<li>—</li>";
  const present = (d.checklist && d.checklist.present || []).map((x) => `<div class="ok">✓ ${esc(x)}</div>`).join("") || "<div class='kv'>—</div>";
  const needed = (d.checklist && d.checklist.needed || []).map((x) => `<div class="no">• ${esc(x)}</div>`).join("") || "<div class='kv'>—</div>";

  const PATHS = ["Manager can approve remotely", "On-site technician", "Licensed professional", "More documentation can resolve"];
  const findings = (d.findings || []).map((f) => {
    const has = (p) => (f.paths || []).some((x) => String(x).toLowerCase().includes(p.toLowerCase().split(" ")[0]));
    const chips = PATHS.map((p) => `<span class="chip ${has(p) ? "on" : ""}">${p}</span>`).join("");
    const src = f.source_verified
      ? `<div class="src-ok">Rule source: ${esc(f.rule_source || "")}</div>`
      : `<div class="src-no">${esc(f.rule_source || "Source not verified — reviewer to confirm applicable NC edition/section")}</div>`;
    return `<div class="finding"><span class="badge">${esc(f.badge || "")}</span><b>${esc(f.id || "")} ${esc(f.title || "")}</b>
      <p>${esc(f.description || "")}</p>${img(images, f.image_index)}
      <div class="row">
        <div class="kv">Location</div><div>${esc(f.location || "")}</div>
        <div class="kv">Evidence</div><div>${esc(f.evidence || "")}</div>
        <div class="kv">AI confidence</div><div>${esc(f.confidence != null ? f.confidence + "%" : "—")} <span class="kv">(concern present; not a compliance determination)</span></div>
        <div class="kv">Category</div><div>${esc(f.category || "")}</div>
        <div class="kv">Why it matters</div><div>${esc(f.why || "")}</div>
        <div class="kv">Required correction</div><div>${esc(f.correction || "")}</div>
      </div>${src}
      <div class="chips">${chips}</div></div>`;
  }).join("") || "<p class='kv'>No open findings.</p>";

  const nextActions = (d.next_actions || defaultActions(d)).map((a) => `<li>${esc(a)}</li>`).join("");
  const audioNote = d.audio && d.audio.present
    ? (d.audio.transcribed
        ? `<div class="imp" style="margin-top:10px">Audio was present and <b>transcribed</b> — the technician's narration was read as part of this review.</div>`
        : `<div class="imp" style="margin-top:10px">Audio was present but <b>not transcribed</b> — a reviewer should listen to the clip(s) for any narrated measurements or model numbers.</div>`) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
 body{font-family:'Segoe UI',Arial,sans-serif;color:#1f2430;margin:0;background:#f4f6f8}
 .wrap{max-width:820px;margin:0 auto;padding:20px}
 .band{background:#16233a;color:#fff;padding:16px 22px;border-radius:8px 8px 0 0}
 .band .k{font-size:11px;letter-spacing:.5px;opacity:.8}.band h1{margin:4px 0 0;font-size:18px}
 .card{background:#fff;border:1px solid #e3e7ee;border-radius:8px;padding:18px 22px;margin:14px 0}
 .status{display:inline-block;background:#efe7fb;color:#6b3fa0;font-weight:700;padding:4px 12px;border-radius:20px;font-size:13px}
 .imp{background:#fdf6e3;border:1px solid #eadfb8;border-radius:8px;padding:12px 16px;font-size:13px;color:#5c5330}
 .counts{display:flex;gap:12px;flex-wrap:wrap}.count{flex:1;min-width:120px;border:1px solid #e3e7ee;border-radius:8px;padding:12px}
 .count .n{font-size:26px;font-weight:800}.count .l{font-size:12px;color:#6b7280}
 h2{font-size:15px;margin:0 0 10px;border-bottom:1px solid #eee;padding-bottom:6px}
 .kv{color:#6b7280}.ok{color:#1a8f4c;font-weight:600}.no{color:#c0392b}
 .row{display:grid;grid-template-columns:150px 1fr;gap:4px 12px;font-size:13px;margin-top:8px}
 .finding{border-left:4px solid #d9534f;border:1px solid #e3e7ee;border-radius:8px;padding:14px 16px;margin:12px 0}
 .badge{float:right;font-size:12px;font-weight:700;color:#b45309;background:#fef3e2;padding:2px 10px;border-radius:16px}
 .src-no{background:#fdeaea;color:#a12a2a;border-radius:6px;padding:8px 12px;font-weight:700;font-size:12px;margin-top:10px}
 .src-ok{background:#eaf7ef;color:#1a6b3b;border-radius:6px;padding:8px 12px;font-size:12px;margin-top:10px}
 .chips{margin-top:10px;font-size:12px}.chip{border:1px solid #e3e7ee;border-radius:16px;padding:3px 10px;margin-right:6px;color:#9aa2ad}.chip.on{color:#c0392b;border-color:#f0c9c4}
 img.ev{max-width:230px;border-radius:6px;margin:8px 8px 0 0}
 .foot{color:#6b7280;font-size:12px;margin-top:10px}
</style></head><body><div class="wrap">
 <div class="band"><div class="k">BLANTON'S AIR, PLUMBING &amp; ELECTRIC · HVAC QC &amp; INSPECTION READINESS</div><h1>Standardized QC Report</h1></div>
 <div class="card"><h1 style="margin:0">Job ${esc(d.job)}</h1><div class="kv">Generated from submitted photos &amp; video · reviewed with AI assist</div>
   <span class="status">${esc(d.status || "Ready for Manager Review")}</span>
   <div class="imp" style="margin-top:12px"><b>Important:</b> Reflects the photos and videos submitted for this job, reviewed with AI assist. It does <b>not</b> guarantee the installation will pass inspection. Uncertain, high-risk, and non-visible items are routed to qualified people. Final QC approval is made by an authorized manager, not by the AI.</div>${audioNote}
 </div>
 <div class="card"><div class="counts">
   <div class="count"><div class="n">${c.open || 0}</div><div class="l">Open findings</div></div>
   <div class="count"><div class="n">${c.el || 0}</div><div class="l">Electrical — licensed review</div></div>
   <div class="count"><div class="n">${c.doc || 0}</div><div class="l">Documentation</div></div>
   <div class="count"><div class="n">${c.cleared || 0}</div><div class="l">Cleared on review</div></div>
 </div></div>
 <div class="card"><h2>Equipment &amp; job data (read from data plates)</h2><div class="row">${rows}</div><div>${plates}</div>
   ${eq.match != null ? `<div style="margin-top:8px" class="ok">Indoor/outdoor ${eq.match ? "match ✓" : "MATCH NOT CONFIRMED — reviewer to verify"}</div>` : ""}</div>
 <div class="card"><h2>Reviewed on closer video review — cleared / no action</h2><ul>${cleared}</ul></div>
 <div class="card"><h2>Documentation completeness</h2><div class="row"><div><b>PRESENT</b>${present}</div><div><b>STILL NEEDED</b>${needed}</div></div></div>
 <div class="card"><h2>Open findings (${c.open || 0})</h2>${findings}</div>
 <div class="card"><h2>Recommended next actions</h2><ol>${nextActions}</ol>
   <div class="foot">Status: <b>${esc(d.status || "Ready for Manager Review")}</b> — not a prediction of the inspection outcome. Generated from submitted evidence for job ${esc(d.job)}.</div>
 </div>
</div></body></html>`;
}

function defaultActions(d) {
  const a = [];
  (d.findings || []).forEach((f) => { if (f.correction) a.push(`${f.id}: ${f.correction}`); });
  if (d.blocker) a.push(`Manager decision: hold at "${d.status}" until "${d.blocker}" is cleared; do not mark QC Approved while that item is open.`);
  else a.push(`Manager decision: review the open items above, then approve or hold. QC approval is the manager's call, not the AI's.`);
  return a;
}
