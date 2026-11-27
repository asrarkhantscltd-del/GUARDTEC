import { motion } from "framer-motion"
import type { StaffMember } from "@/types/staff"
import { fmtDate } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Phone, ShieldCheck, CreditCard, FileText, Contact, Landmark } from "lucide-react"
import { ComplianceRow } from "./shared"

export default function OverviewTab({ staff }: { staff: StaffMember }) {
  const dob = staff.dob || staff.dateOfBirth

  return (
    <motion.div key="overview" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Compliance Documents</CardTitle></CardHeader>
        <CardContent className="divide-y px-4">
          <ComplianceRow icon={<ShieldCheck className="h-4 w-4" />} label="SIA Licence"
            number={staff.sia?.number ? `${staff.sia.number}${staff.sia.type ? ` — ${staff.sia.type}` : ""}` : undefined}
            expiry={staff.sia?.expiry} />
          <ComplianceRow icon={<CreditCard className="h-4 w-4" />} label="CSCS Card"
            number={staff.cscs?.number} expiry={staff.cscs?.expiry} />
          <ComplianceRow icon={<FileText className="h-4 w-4" />} label="Right to Work"
            number={staff.visa?.type ?? "British (no visa required)"} expiry={staff.visa?.expiry} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Personal Details</CardTitle></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
          {[
            { label: "Date of Birth",     val: dob ? fmtDate(dob) : null },
            { label: "Nationality",        val: staff.nationality },
            { label: "Gender",             val: staff.gender },
            { label: "Place of Birth",     val: staff.placeOfBirth },
            { label: "NI Number",          val: staff.ni },
            { label: "UTR",                val: staff.utrNotApplicable ? "Not applicable" : staff.uniqueTaxpayerReference },
            { label: "Previous Names",     val: staff.previousNames },
            { label: "Driving Licence",    val: staff.drivingLicence },
            { label: "Address",            val: staff.address },
            { label: "Years at Address",   val: staff.yearsAtCurrentAddress != null ? String(staff.yearsAtCurrentAddress) : null },
            { label: "Contract",           val: staff.contract },
          ].filter((r) => r.val).map(({ label, val }) => (
            <div key={label}>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{label}</p>
              <p className="mt-0.5">{val}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {staff.emergencyContact?.name && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Contact className="h-4 w-4" />Emergency Contact
            </CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Name</p>
              <p className="mt-0.5">{staff.emergencyContact.name}</p>
            </div>
            {staff.emergencyContact.relationship && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Relationship</p>
                <p className="mt-0.5">{staff.emergencyContact.relationship}</p>
              </div>
            )}
            {staff.emergencyContact.phone && (
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Phone</p>
                <a href={`tel:${staff.emergencyContact.phone}`} className="mt-0.5 flex items-center gap-1 hover:text-foreground text-muted-foreground">
                  <Phone className="h-3 w-3" />{staff.emergencyContact.phone}
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4" />Bank Details
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3 text-sm">
          {staff.bankDetails?.accountNumber ? (
            <>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Account Holder</p>
                <p className="mt-0.5">{staff.bankDetails.accountHolderName || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Bank</p>
                <p className="mt-0.5">{staff.bankDetails.bankName || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Sort Code</p>
                <p className="mt-0.5 font-mono">{staff.bankDetails.sortCode || "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Account Number</p>
                <p className="mt-0.5 font-mono">{staff.bankDetails.accountNumber}</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground italic sm:col-span-2">Not provided yet — staff can add this from their own portal.</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
