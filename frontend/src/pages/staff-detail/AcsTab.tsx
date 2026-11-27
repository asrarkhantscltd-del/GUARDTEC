import { motion } from "framer-motion"
import type { StaffMember, TrainingRecord } from "@/types/staff"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AcsCheckRow, type AcsChecks } from "./shared"

export default function AcsTab({ staffId: id, staff, training, acs, contractExists, setTab }: {
  staffId: string
  staff: StaffMember
  training: TrainingRecord
  acs: AcsChecks
  contractExists: boolean
  setTab: (tab: "overview" | "vetting") => void
}) {
  const docs = staff.documents ?? {}
  const isOfficeExempt = !!staff.officeExempt
  const acsScore = Object.values(acs).filter(Boolean).length
  const acsTotal = Object.values(acs).length

  return (
    <motion.div key="acs" className="space-y-4" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">ACS Readiness Score</p>
          <p className="text-xs text-muted-foreground">Based on key audit checkpoints</p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold ${acsScore >= acsTotal * 0.8 ? "text-success" : acsScore >= acsTotal * 0.6 ? "text-warning" : "text-destructive"}`}>
            {acsScore}/{acsTotal}
          </p>
          <p className="text-xs text-muted-foreground">{Math.round((acsScore / acsTotal) * 100)}%</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Licensing</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 px-3 pb-3">
          <AcsCheckRow label="Valid SIA licence held"           done={acs.siaValid}       note="Must be in-date and active" exempt={isOfficeExempt}
            viewUrl={docs.siaPhysical?.uploaded ? `/api/staff/${id}/documents/siaPhysical` : undefined} onGo={() => setTab("overview")} />
          <AcsCheckRow label="SIA licence type recorded"        done={acs.siaType}        note="Door Supervisor / Security Guard / CCTV / Close Protection" exempt={isOfficeExempt}
            onGo={() => setTab("overview")} />
          <AcsCheckRow label="Physical SIA copy on file"        done={acs.siaPhysicalCopy} note="Scanned front and back of badge" exempt={isOfficeExempt}
            viewUrl={docs.siaPhysical?.uploaded ? `/api/staff/${id}/documents/siaPhysical` : undefined} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Identity &amp; Right to Work</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 px-3 pb-3">
          <AcsCheckRow label="Right to Work verified"           done={acs.rtwVerified}    note="Passport, BRP, or share code confirmed"
            views={[
              { label: "BRP / Share code", url: docs.brpCard?.uploaded ? `/api/staff/${id}/documents/brpCard` : undefined },
              { label: "Passport", url: docs.passport?.uploaded ? `/api/staff/${id}/documents/passport` : undefined },
            ]} />
          <AcsCheckRow label="Passport copy on file"           done={acs.passportOnFile}  note="Required for BS 7858 identity check"
            viewUrl={docs.passport?.uploaded ? `/api/staff/${id}/documents/passport` : undefined} />
          <AcsCheckRow label="Proof of address on file"        done={acs.addressProof}    note="Two documents within last 3 months"
            views={[
              { label: "Doc 1", url: docs.proofOfAddress1?.uploaded ? `/api/staff/${id}/documents/proofOfAddress1` : undefined },
              { label: "Doc 2", url: docs.proofOfAddress2?.uploaded ? `/api/staff/${id}/documents/proofOfAddress2` : undefined },
            ]} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Vetting (BS 7858)</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 px-3 pb-3">
          <AcsCheckRow label="DBS check obtained"              done={acs.dbsChecked}      note="Enhanced DBS recommended for security roles"
            viewUrl={docs.dbsCertificate?.uploaded ? `/api/staff/${id}/documents/dbsCertificate` : undefined} onGo={() => setTab("vetting")} />
          <AcsCheckRow label="BS 7858 screening complete"      done={acs.bs7858}          note="Full 5-year employment history + references verified"
            onGo={() => setTab("vetting")} />
          <AcsCheckRow label="Two satisfactory references"     done={acs.twoRefs}         note="Both references marked Satisfactory"
            onGo={() => setTab("vetting")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Training &amp; Competency</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 px-3 pb-3">
          <AcsCheckRow label="First Aid certificate held"       done={acs.firstAid}       note="Emergency First Aid at Work — valid 3 years" exempt={isOfficeExempt}
            viewUrl={training.firstAid?.certUploaded ? `/api/staff/${id}/training/firstAid/certificate` : undefined} />
          <AcsCheckRow label="Conflict management trained"      done={acs.conflictMgmt}   note="Mandatory for Door Supervisors under SIA guidance" exempt={isOfficeExempt}
            viewUrl={training.conflictManagement?.certUploaded ? `/api/staff/${id}/training/conflictManagement/certificate` : undefined} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Employment &amp; Operations</CardTitle></CardHeader>
        <CardContent className="space-y-1.5 px-3 pb-3">
          <AcsCheckRow label="Employment contract signed"       done={acs.contractSigned}
            note={!contractExists && staff.contract?.toLowerCase() === "signed" ? "Marked “Signed” on profile, but no signed copy uploaded" : "Signed copy on file"}
            viewUrl={contractExists ? `/api/staff/${id}/contract` : undefined} />
          <AcsCheckRow label="Assignment instructions signed"   done={acs.assignmentInstr}  note="Site-specific — legally required by SIA"
            viewUrl={docs.assignmentInstructions?.uploaded ? `/api/staff/${id}/documents/assignmentInstructions` : undefined} />
          <AcsCheckRow label="Emergency contact recorded"       done={acs.emergencyContact} note="Name, phone, and relationship"
            onGo={() => setTab("overview")} />
        </CardContent>
      </Card>
    </motion.div>
  )
}
