import { useEffect, useState } from "react"
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Truck, Plus, Search, Loader2, AlertTriangle } from "lucide-react"

interface Vehicle {
  id: string
  registration: string
  make?: string
  model?: string
  vehicle_type: string
  year?: number
  colour?: string
  status: string
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000)
}

function fmtDate(iso?: string) {
  if (!iso) return "Not on file"
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function ComplianceTag({
  label,
  expiry,
}: {
  label: string
  expiry?: string
}) {
  const days = daysUntil(expiry)
  const colour =
    !expiry ? "bg-muted text-muted-foreground"
    : days !== null && days < 0 ? "bg-destructive/15 text-destructive border border-destructive/30"
    : days !== null && days < 30 ? "bg-warning/15 text-warning border border-warning/30"
    : "bg-success/15 text-success border border-success/30"

  const dateStr =
    !expiry ? "—"
    : days !== null && days < 0 ? `Expired ${Math.abs(days)}d ago`
    : days !== null && days < 30 ? `${days}d left`
    : fmtDate(expiry)

  return (
    <div className={`rounded-md px-2.5 py-1.5 text-xs ${colour}`}>
      <p className="font-medium">{label}</p>
      <p className="mt-0.5 opacity-80">{dateStr}</p>
    </div>
  )
}

export default function FleetPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [apiError, setApiError] = useState(false)

  useEffect(() => {
    fetch("/api/vehicles", { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((data) => setVehicles(data.vehicles ?? []))
      .catch(() => setApiError(true))
      .finally(() => setLoading(false))
  }, [])

  const filtered = vehicles.filter(
    (v) =>
      v.registration.toLowerCase().includes(search.toLowerCase()) ||
      `${v.make} ${v.model}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Fleet</h2>
          <p className="text-muted-foreground text-sm">
            {vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""} in fleet
          </p>
        </div>
        <Button size="sm" disabled>
          <Plus className="mr-2 h-4 w-4" />
          Add Vehicle
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading fleet...</span>
        </div>
      ) : apiError ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Truck className="h-4 w-4" />
              Fleet Tracking
            </CardTitle>
            <CardDescription>
              Vehicle records will appear here once the fleet database is populated.
              Apply <code className="text-xs bg-muted px-1 rounded">schema-phase3.sql</code> to the database to enable this feature.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md bg-warning/10 border border-warning/30 p-4 flex gap-3">
              <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-warning">Database schema not yet applied</p>
                <p className="text-muted-foreground mt-1">
                  Run <code className="text-xs bg-muted px-1 rounded">schema-phase3.sql</code> on your Postgres database,
                  then rebuild the Docker containers.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : vehicles.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <Truck className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">No vehicles yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Add your first vehicle to start tracking compliance.
          </p>
        </div>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by reg or make..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((v) => (
              <Card key={v.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-mono">
                      {v.registration}
                    </CardTitle>
                    <span
                      className={`text-xs rounded-full px-2 py-0.5 font-medium ${
                        v.status === "active"
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {v.status}
                    </span>
                  </div>
                  <CardDescription>
                    {[v.year, v.make, v.model].filter(Boolean).join(" ")}
                    {v.colour ? ` · ${v.colour}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2">
                    <ComplianceTag label="MOT" />
                    <ComplianceTag label="Insurance" />
                    <ComplianceTag label="Road Tax" />
                    <ComplianceTag label="Service" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
