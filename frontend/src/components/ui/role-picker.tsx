/**
 * Job roles are stored as a single comma-separated string on `staff.jobRole`
 * rather than a real array, so that existing records (and the Excel export)
 * keep working unchanged. These helpers are the only place that encoding is
 * interpreted — do not split/join `jobRole` inline anywhere else.
 */
export const JOB_ROLES = [
  "Security Officer", "Door Supervisor", "CCTV Operator", "Patrol Officer",
  "Mobile Patrol", "Supervisor", "Team Leader", "Key Holder",
  "Receptionist / Concierge", "Gatesman / Banksman",
]

export function parseRoles(str?: string): string[] {
  return str ? str.split(",").map(r => r.trim()).filter(Boolean) : []
}

export function joinRoles(arr: string[]): string {
  return arr.join(", ")
}

/** Multi-select role chips. A staff member can hold several roles at once. */
export function RoleChipPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const selected = parseRoles(value)

  function toggle(role: string) {
    const next = selected.includes(role)
      ? selected.filter(r => r !== role)
      : [...selected, role]
    onChange(joinRoles(next))
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {JOB_ROLES.map(role => (
        <button
          key={role}
          type="button"
          onClick={() => toggle(role)}
          aria-pressed={selected.includes(role)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            selected.includes(role)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
          }`}
        >
          {role}
        </button>
      ))}
    </div>
  )
}

/** Read-only display of a staff member's roles as small badges. */
export function RoleBadges({ jobRole, size = "sm" }: { jobRole?: string; size?: "xs" | "sm" }) {
  const roles = parseRoles(jobRole)
  if (roles.length === 0) return null
  const cls = size === "xs" ? "text-[10px]" : "text-xs"
  return (
    <>
      {roles.map(r => (
        <span
          key={r}
          className={`rounded-full border border-border bg-muted/50 px-2 py-0.5 font-medium text-muted-foreground ${cls}`}
        >
          {r}
        </span>
      ))}
    </>
  )
}
