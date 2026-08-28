export interface EmergencyContact {
  name?: string
  phone?: string
  relationship?: string
  address?: string
}

export interface AddressHistoryEntry {
  id: string
  address: string
  postcode?: string
  fromDate: string
  toDate: string
  monthsAtAddress?: number
  reasonForMoving?: string
}

// Structured, staff-submitted, BS7858 5-year history — distinct from the
// existing `employmentHistory: string[]` freeform notes list managers keep,
// which stays as-is for that separate purpose.
export interface EmploymentHistoryEntry {
  id: string
  companyName: string
  jobTitle: string
  startDate: string
  endDate: string
  reasonForLeaving?: string
  managerName: string
  managerJobTitle: string
  managerPhone: string
  managerEmail: string
  verificationStatus?: "pending" | "verified" | "unable-to-verify"
  permissionToContact?: "yes" | "no" | "phone-only" | "email-only"
}

export interface ReferenceDetail {
  name?: string
  company?: string
  email?: string
  phone?: string
  status?: string
  jobTitle?: string
  companyAddress?: string
  periodKnownFrom?: string
  periodKnownTo?: string
  relationship?: string
  permissionToContact?: "yes" | "no" | "phone-only" | "email-only"
  verificationDate?: string
  verificationNotes?: string
}

export interface CriminalHistoryEntry {
  id: string
  offenseType: string
  date: string
  court?: string
  sentence?: string
  details: string
}

export interface CautionEntry {
  id: string
  type: "caution" | "reprimand" | "investigation"
  date: string
  details: string
  outcome?: string
}

export interface OtherQualification {
  id: string
  qualification: string
  awardingBody: string
  dateAchieved: string
  referenceNumber?: string
}

export interface TrainingItem { completed?: boolean; date?: string; expiry?: string; provider?: string; number?: string; certUploaded?: boolean; certDate?: string }
export interface ExtraTrainingItem { id: string; label: string; completed?: boolean; date?: string; expiry?: string; number?: string; provider?: string }
export interface TrainingRecord {
  siaCertificate?:     TrainingItem
  firstAid?:           TrainingItem
  manualHandling?:     TrainingItem
  fireAwareness?:      TrainingItem
  conflictManagement?: TrainingItem
  bwcTraining?:        TrainingItem
  cscsTest?:           TrainingItem
  extra?:              ExtraTrainingItem[]
}
export interface DbsRecord    { type?: string; checkDate?: string; certificateNo?: string }
export interface Bs7858Record { completed?: boolean; completionDate?: string; reviewer?: string }
export interface BankDetails  { accountHolderName?: string; bankName?: string; sortCode?: string; accountNumber?: string; iban?: string }

// Driver-specific fields, split by who fills them in — same self-service /
// manager-approval split as the rest of the staff record. licenceCategories
// etc. are what the driver already knows on day one; DriverAssignmentInfo is
// company-issued stuff a brand-new driver won't have yet, so it stays
// manager-only (edited via patchField like dbs/bs7858, not self-service).
export interface DriverLicenceInfo {
  licenceNumber?: string
  licenceExpiry?: string
  licenceCategories?: string[]
  cpcCard?: string
  cpcExpiry?: string
  medicalExpiry?: string
}
export interface DriverAssignmentInfo {
  fuelCardNumber?: string
  tachoCard?: string
  tachoExpiry?: string
  dbsNumber?: string
  dbsDate?: string
  lastAssessment?: string
  status?: "active" | "suspended" | "on_leave"
  notes?: string
}

// Legal/compliance acknowledgment checkboxes — Sections 13, 14, 15, 16 of the
// BS7858 onboarding spec. All must be true before the form can be submitted.
export interface OnboardingDeclarations {
  rightToWorkConfirmed?: boolean
  identityDocumentConfirmed?: boolean
  proofOfAddressConfirmed?: boolean
  siaLicenceConfirmed?: boolean
  dbsConsent?: boolean
  creditCheckConsent?: boolean
  socialMediaCheckConsent?: boolean
  criminalHistoryDeclared?: boolean
  vettingAuthorization?: boolean
  bankDetailsConfirmed?: boolean
  trainingCertConfirmed?: boolean
  fraudActAcknowledged?: boolean
  conductPolicyAccepted?: boolean
  dataProtectionAccepted?: boolean
  accuracyDeclared?: boolean
}

export interface StaffMember {
  id: string
  name: string
  overall: string
  jobRole?: string
  // Login role of the linked user account (director/ops_manager/etc), if any
  // — office-based roles are exempt from SIA/CSCS/training compliance checks.
  linkedRole?: string | null
  email?: string
  phone?: string
  nationality?: string
  gender?: string
  dateOfBirth?: string
  dob?: string
  ni?: string
  placeOfBirth?: string
  address?: string
  drivingLicence?: string
  deployStatus?: string
  currentSite?: string
  sia?:  { number?: string; expiry?: string; type?: string }
  cscs?: { number?: string; expiry?: string; cardType?: string }
  visa?: { type?: string; expiry?: string }
  references?: {
    ref1?: ReferenceDetail
    ref2?: ReferenceDetail
  }
  employmentHistory?: string[]
  contract?: string
  dbs?: DbsRecord
  bs7858?: Bs7858Record
  emergencyContact?: EmergencyContact
  bankDetails?: BankDetails
  training?: TrainingRecord
  driverLicence?: DriverLicenceInfo
  driverAssignment?: DriverAssignmentInfo
  pending_submission?: { driverLicence?: DriverLicenceInfo }
  documents?: {
    siaPhysical?:      { uploaded?: boolean; date?: string }
    cscsCard?:         { uploaded?: boolean; date?: string }
    dbsCertificate?:   { uploaded?: boolean; date?: string }
    passport?:         { uploaded?: boolean; date?: string }
    brpCard?:          { uploaded?: boolean; date?: string }
    drivingLicenceDoc?: { uploaded?: boolean; date?: string }
    nationalIdCard?:   { uploaded?: boolean; date?: string }
    proofOfAddress1?:  { uploaded?: boolean; date?: string; docType?: string }
    proofOfAddress2?:  { uploaded?: boolean; date?: string; docType?: string }
    p45?:              { uploaded?: boolean; date?: string }
    bankLetter?:       { uploaded?: boolean; date?: string }
    application?:      { uploaded?: boolean; date?: string }
    assignmentInstructions?: { uploaded?: boolean; date?: string }
    creditCheckReport?:      { uploaded?: boolean; date?: string; visibleToStaff?: boolean }
    socialMediaCheckReport?: { uploaded?: boolean; date?: string; visibleToStaff?: boolean }
    driverLicenceCopy?:      { uploaded?: boolean; date?: string }
    driverCpcCard?:          { uploaded?: boolean; date?: string }
    driverMedicalCert?:      { uploaded?: boolean; date?: string }
    driverTachoCard?:        { uploaded?: boolean; date?: string; visibleToStaff?: boolean }
    driverDbsCheck?:         { uploaded?: boolean; date?: string; visibleToStaff?: boolean }
    driverAssessmentReport?: { uploaded?: boolean; date?: string; visibleToStaff?: boolean }
  }

  // ── BS7858 onboarding fields new to this form ──
  uniqueTaxpayerReference?: string
  utrNotApplicable?: boolean
  previousNames?: string
  yearsAtCurrentAddress?: number
  addressHistory?: AddressHistoryEntry[]
  employmentHistoryDetail?: EmploymentHistoryEntry[]
  otherQualifications?: OtherQualification[]
  hasCriminalHistory?: boolean
  criminalHistory?: CriminalHistoryEntry[]
  hasCautions?: boolean
  cautionsAndInvestigations?: CautionEntry[]
  declarations?: OnboardingDeclarations

  // Onboarding form progress + lock state — separate from pending_submission
  // (which governs staff edits to an ALREADY-approved live record).
  onboardingStatus?: "not-started" | "in-progress" | "submitted" | "locked"
  onboardingSubmittedAt?: string
  onboardingCurrentPhase?: number
  onboardingCompletedPhases?: number[]
  onboardingUnlockedSections?: string[]
}

export interface DiscRecord {
  id: string
  incident_date: string
  type: string
  description: string
  action_taken?: string
  issued_by_name?: string
  created_at: string
}
