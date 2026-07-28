import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function StaffPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Staff Management</h2>
        <p className="text-muted-foreground">
          View and manage staff across your departments.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Staff Directory</CardTitle>
          <CardDescription>
            Staff list will be populated once the API endpoints are built.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  )
}
