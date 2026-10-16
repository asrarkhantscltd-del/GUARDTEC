// File types a browser can display itself. Keep in step with SITE_DOC_INLINE_TYPES
// in server.js — everything else (PowerPoint, Word, Excel, zip…) is sent as a
// download, so the button should say "Download", not "View".
const PREVIEWABLE = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "txt", "mp4", "mp3"])

export function canPreviewInBrowser(filename: string): boolean {
  const dot = filename.lastIndexOf(".")
  if (dot < 0) return false
  return PREVIEWABLE.has(filename.slice(dot + 1).toLowerCase())
}
