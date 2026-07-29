import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  ArrowLeft, Phone, Mail, User, ShieldCheck, CreditCard,
  FileText, Loader2,
} from "lucide-react"

interface StaffMember {
  id: string
  name: string
  overall: string
  email?: string
  phone?: string
  nationality?: string
  gender?: string
  dateOfBirth?: string
  deployStatus?: string
  sia?: { number?: string; expiry?: string }
  cscs?: { number?: string; expiry?: string }
  visa?: { type?: string; expiry?: string }
}

function fmtDate(iso?: string) {
  if (!iso) return "Not on file"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000)
}

function ComplianceRow({
  icon,
  label,
  number,
  expiry,
}: {
  icon: React.ReactNode
  label: string
  number?: string
  expiry?: string
}) {
  const days = daysUntil(expiry)
  const statusColour =
    !expiry ? "text-muted-foreground"
    : days !== null && days < 0 ? "text-destructive"
    : days !== null && days < 91 ? "text-warning"
    : "text-success"

  const expiryLabel =
    !expiry ? "Not on file"
    : days === null ? fmtDate(expiry)
    : days < 0 ? `Expired ${Math.abs(days)} days ago`
    : days === 0 ? "Expires today"
    : days < 91 ? `${fmtDate(expiry)} — ${days} days left`
    : fmtDate(expiry)

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </p>
        <p className="text-sm font-medium mt-0.5">{number || "Not on file"}</p>
        <p className={`text-xs mt-0.5 ${statusColour}`}>{expiryLabel}</p>
      </div>
    </div>
  )
}

export default function StaffDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [staff, setStaff] = useState<StaffMember | null>(null)
  const [loading, setLoading] = useState(true)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/staff", { credentials: "include" })
      .then((r) => r.json())
      .then((data: StaffMember[]) => {
        const found = data.find((s) => s.id === id) ?? null
        setStaff(found)
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    fetch(`/api/staff/${id}/photo`, { credentials: "include" })
      .then((r) => {
        if (r.ok) return r.blob()
        return null
      })
      .then((blob) => {
        if (blob) setPhotoUrl(URL.createObjectURL(blob))
      })
      .catch(() => {})
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading profile...</span>
      </div>
    )
  }

  if (!staff) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/staff")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Staff
        </Button>
        <p className="text-muted-foreground">Staff member not found.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Button variant="ghost" size="sm" onClick={() => navigate("/staff")}>
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Staff
      </Button>

      {/* Header card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={staff.name}
                className="h-16 w-16 rounded-full object-cover border"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
                <User className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1">
              <h2 className="text-xl font-bold">{staff.name}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <StatusBadge status={staff.overall} />
                {staff.deployStatus && (
                  <span className="text-xs text-muted-foreground capitalize">
                    {staff.deployStatus}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-1">
            {staff.phone && (
              <a
                href={`tel:${staff.phone}`}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <Phone className="h-3.5 w-3.5" />
                {staff.phone}
              </a>
            )}
            {staff.email && (
              <a
                href={`mailto:${staff.email}`}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <Mail className="h-3.5 w-3.5" />
                {staff.email}
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Compliance card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Compliance Documents</CardTitle>
        </CardHeader>
        <CardContent className="divide-y px-4">
          <ComplianceRow
            icon={<ShieldCheck className="h-4 w-4" />}
            label="SIA Licence"
            number={staff.sia?.number}
            expiry={staff.sia?.expiry}
          />
          <ComplianceRow
            icon={<CreditCard className="h-4 w-4" />}
            label="CSCS Card"
            number={staff.cscs?.number}
            expiry={staff.cscs?.expiry}
          />
          <ComplianceRow
            icon={<FileText className="h-4 w-4" />}
            label="Right to Work"
            number={staff.visa?.type || (staff.visa ? undefined : "British — No visa required")}
            expiry={staff.visa?.expiry}
          />
        </CardContent>
      </Card>

      {/* Personal details card */}
      {(staff.nationality || staff.gender || staff.dateOfBirth) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Personal Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {staff.dateOfBirth && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Date of Birth</p>
                <p className="mt-0.5">{fmtDate(staff.dateOfBirth)}</p>
              </div>
            )}
            {staff.nationality && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Nationality</p>
                <p className="mt-0.5">{staff.nationality}</p>
              </div>
            )}
            {staff.gender && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Gender</p>
                <p className="mt-0.5">{staff.gender}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
