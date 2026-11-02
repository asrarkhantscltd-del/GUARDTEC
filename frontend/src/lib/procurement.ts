import { ApiError } from "@/lib/api"

// Mirrors SECTIONS in procurement.js — keep the two in step.
export const EVAL_SECTIONS = [
  { key: "A", title: "Performance & Quality", questions: [
    "Is the service or product provided within the agreed time frame?",
    "Does the service or product meet the agreed requirements?",
    "Does the Supplier hold a valid ISO 9001:2015 certification?" ] },
  { key: "B", title: "Environmental", questions: [
    "Does the supplier have a suitable environmental policy in place?",
    "Does the supplier operate within the company's environmental objectives?",
    "Does the supplier hold a valid ISO 14001:2015 certification?" ] },
  { key: "C", title: "Health & Safety", questions: [
    "Does the supplier have a suitable Health & Safety Policy in place?",
    "Does the supplier operate within the company's Health & Safety objectives?",
    "Does the Supplier hold a valid ISO 45001:2018 or OHSAS certification?" ] },
  { key: "D", title: "Ethical Purchasing", questions: [
    "Does the supplier have an ethical purchasing policy?",
    "Does the company have an anti-slavery policy?",
    "Does the company have an anti-bribery policy?" ] },
  { key: "E", title: "Data Handling", questions: [
    "Does the supplier hold any sensitive information?",
    "Does the supplier have an ICO certificate?",
    "Does the supplier have a GDPR Policy in place?" ] },
] as const

export type SectionKey = (typeof EVAL_SECTIONS)[number]["key"]
export type YesNo = "yes" | "no" | ""
export type Grade = "acceptable" | "unacceptable" | "under_review" | ""
export type Answers = Record<SectionKey, YesNo[]>
export type Grades = Record<SectionKey, Grade>

export const REVIEW_TYPES = [
  { value: "standard", label: "Standard" },
  { value: "specific", label: "Specific" },
  { value: "performance", label: "Performance related" },
] as const

export const GRADE_META: Record<Exclude<Grade, "">, { label: string; cls: string }> = {
  acceptable:   { label: "Acceptable",   cls: "bg-success/15 text-success border-success/30" },
  unacceptable: { label: "Unacceptable", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  under_review: { label: "Under Review", cls: "bg-warning/15 text-warning border-warning/30" },
}

export const SUPPLIER_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:      { label: "Pending",      cls: "bg-muted text-muted-foreground border-border" },
  approved:     { label: "Approved",     cls: "bg-success/15 text-success border-success/30" },
  under_review: { label: "Under Review", cls: "bg-warning/15 text-warning border-warning/30" },
  rejected:     { label: "Rejected",     cls: "bg-destructive/15 text-destructive border-destructive/30" },
}

export function blankAnswers(): Answers {
  return { A: ["", "", ""], B: ["", "", ""], C: ["", "", ""], D: ["", "", ""], E: ["", "", ""] }
}
export function blankGrades(): Grades {
  return { A: "", B: "", C: "", D: "", E: "" }
}

export function reviewTypeLabel(v: string) {
  return REVIEW_TYPES.find(r => r.value === v)?.label ?? "Standard"
}

export function fmtMoney(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(n) || 0)
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const UPLOAD_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt"

// Raw-body upload (server has no multipart parser). octet-stream so the JSON
// body parser never swallows it; the global fetch patch adds the CSRF header.
export async function uploadFile<T>(url: string, file: File, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name), ...headers },
    body: file,
  })
  if (res.status === 413) throw new ApiError(413, "That file is too large (max 15 MB).")
  const data = await res.json().catch(() => ({} as { error?: string }))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || `Upload failed (${res.status})`)
  return data as T
}

export function openBlobInNewTab(blob: Blob | null) {
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank", "noopener")
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return true
}
