import { STAGES, computeStats, eventDates, fmtMoney, num, todayIso, topServices, type CrmEvent, type CrmLead } from "@/lib/crm"

// One-page PDF lead report (KPIs, pipeline by stage, top services, hot leads).
// jsPDF is loaded on demand so it never weighs down the main bundle.
export async function savePdfReport(event: CrmEvent, leads: CrmLead[]) {
  const { jsPDF } = await import("jspdf")
  const doc = new jsPDF({ unit: "pt", format: "a4" })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 40
  let y = 0

  const s = computeStats(leads)
  const closed = s.won + s.lost
  const winRate = closed ? Math.round((s.won / closed) * 100) : 0

  doc.setFillColor(10, 11, 14); doc.rect(0, 0, W, 74, "F")
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(16)
  doc.text("GuardTec", M, 36)
  doc.setTextColor(255, 122, 30); doc.setFontSize(14)
  doc.text(event.name, W - M, 34, { align: "right" })
  doc.setTextColor(180, 187, 196); doc.setFont("helvetica", "normal"); doc.setFontSize(10)
  doc.text(`Lead report — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, W - M, 52, { align: "right" })
  doc.text([event.venue, eventDates(event)].filter(Boolean).join("  ·  "), M, 56)
  y = 104

  const kpis: [string, string][] = [
    ["Total leads", String(s.total)], ["Hot", String(s.hot)], ["Quotes out", String(s.quotes)], ["Won", String(s.won)],
    ["Open pipeline", fmtMoney(s.openval)], ["Won value", fmtMoney(s.wonval)], ["Win rate", winRate + "%"], ["Follow-ups due", String(s.fudue)],
  ]
  const cols = 4, cw = (W - 2 * M) / cols, ch = 54
  kpis.forEach(([label, value], i) => {
    const cx = M + (i % cols) * cw, cy = y + Math.floor(i / cols) * ch
    doc.setDrawColor(225, 228, 232); doc.setFillColor(248, 249, 250); doc.roundedRect(cx, cy, cw - 8, ch - 8, 5, 5, "FD")
    doc.setTextColor(120, 128, 138); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text(label.toUpperCase(), cx + 10, cy + 18)
    doc.setTextColor(20, 22, 28); doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text(value, cx + 10, cy + 40)
  })
  y += 2 * ch + 14

  const heading = (t: string) => {
    doc.setTextColor(255, 74, 28); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text(t, M, y); y += 8
    doc.setDrawColor(255, 74, 28); doc.setLineWidth(1.5); doc.line(M, y, M + 60, y); y += 16; doc.setLineWidth(0.5)
  }

  heading("Pipeline by stage")
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(40, 44, 52)
  STAGES.forEach((st) => {
    const items = leads.filter((l) => l.stage === st.key)
    const v = items.reduce((a, l) => a + num(l.value), 0)
    doc.text(st.label, M, y)
    doc.text(`${items.length} lead${items.length === 1 ? "" : "s"}`, M + 180, y)
    doc.text(fmtMoney(v), W - M, y, { align: "right" })
    y += 17
  })
  y += 10

  const svc = topServices(leads)
  if (svc.length) {
    heading("Most-wanted services")
    doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(40, 44, 52)
    svc.forEach(([name, n]) => { doc.text(name, M, y); doc.text(String(n), W - M, y, { align: "right" }); y += 17 })
    y += 10
  }

  const hot = leads.filter((l) => l.rating === "hot" && l.stage !== "lost").sort((a, b) => num(b.value) - num(a.value)).slice(0, 15)
  if (hot.length) {
    if (y > 720) { doc.addPage(); y = 50 }
    heading("Hot leads to chase")
    doc.setFontSize(9)
    hot.forEach((l) => {
      if (y > 790) { doc.addPage(); y = 50 }
      doc.setTextColor(20, 22, 28); doc.setFont("helvetica", "bold"); doc.text((l.company || "—").slice(0, 46), M, y)
      doc.setFont("helvetica", "normal"); doc.setTextColor(110, 118, 128)
      const stage = STAGES.find((x) => x.key === l.stage)?.label
      doc.text([l.contact_name, stage, num(l.value) ? fmtMoney(num(l.value)) : ""].filter(Boolean).join("  ·  "), M + 12, y + 13)
      if (l.follow_up) doc.text("f/u " + l.follow_up, W - M, y, { align: "right" })
      y += 30
    })
  }

  doc.setTextColor(150, 157, 166); doc.setFontSize(8)
  doc.text("GuardTec Security & Patrol UK Ltd — confidential", M, H - 24)
  doc.save(`guardtec-crm-${event.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${todayIso()}.pdf`)
}

export function leadsToTsv(leads: CrmLead[]): string {
  const head = ["Company", "Contact", "Job title", "Email", "Phone", "Services", "Region", "Value", "Rating", "Stage", "Follow-up", "Next action", "Owner", "Notes"]
  const rows = leads.map((l) => [
    l.company, l.contact_name, l.job_title, l.email, l.phone, l.services.join("; "), l.region, num(l.value), l.rating,
    STAGES.find((s) => s.key === l.stage)?.label ?? l.stage, l.follow_up ?? "", l.next_action, l.owner, l.notes.replace(/\s+/g, " "),
  ])
  return [head, ...rows].map((r) => r.join("\t")).join("\n")
}
