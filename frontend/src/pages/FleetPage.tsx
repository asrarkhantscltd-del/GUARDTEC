import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function FleetPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Fleet Management</h2>
        <p className="text-muted-foreground">
          Track vehicles, MOT, insurance, and driver compliance.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Vehicle Fleet</CardTitle>
          <CardDescription>
            Fleet data will appear once the database tables and API are ready.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  )
}
