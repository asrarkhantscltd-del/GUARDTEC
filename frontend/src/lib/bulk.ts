import { toast } from "sonner"

export interface BulkResult<T> {
  /** Ids whose operation succeeded — safe to remove from local state. */
  succeeded: T[]
  /** Ids whose operation failed — these are still on the server. */
  failed: T[]
}

/**
 * Runs a per-id operation across a selection and reports how many succeeded.
 *
 * Deliberately sequential: these operations rewrite the same JSON file on the
 * server (deployment-sites.json / staff folders), so firing them concurrently
 * would make the last write win and silently drop the others.
 *
 * `op` should throw on failure — api.* already throws on a non-ok response.
 */
export async function runBulk<T>(ids: T[], op: (id: T) => Promise<void>): Promise<BulkResult<T>> {
  const succeeded: T[] = []
  const failed: T[] = []
  for (const id of ids) {
    try {
      await op(id)
      succeeded.push(id)
    } catch {
      failed.push(id)
    }
  }
  return { succeeded, failed }
}

/**
 * Standard toast summary for a bulk run.
 * `noun` is singular — the plural "s" is appended automatically.
 */
export function reportBulk<T>(result: BulkResult<T>, verb: string, noun = "staff member") {
  const { succeeded, failed } = result
  if (succeeded.length > 0) {
    const plural = succeeded.length > 1 ? "s" : ""
    toast.success(`${succeeded.length} ${noun}${plural} ${verb}`)
  }
  if (failed.length > 0) {
    toast.error(`${failed.length} could not be ${verb} — check your permissions`)
  }
}
