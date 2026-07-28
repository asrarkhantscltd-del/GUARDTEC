import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function CompliancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Compliance Overview
        </h2>
        <p className="text-muted-foreground">
          SIA licences, CSCS cards, Right to Work, and training status.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Compliance Tracker</CardTitle>
          <CardDescription>
            Compliance data will appear once the API is connected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Coming soon.</p>
        </CardContent>
      </Card>
    </div>
  )
}
