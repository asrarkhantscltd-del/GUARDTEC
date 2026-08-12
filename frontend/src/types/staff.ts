export interface EmergencyContact {
  name?: string
  phone?: string
  relationship?: string
}

export interface TrainingItem { completed?: boolean; date?: string; expiry?: string; provider?: string; number?: string }
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

export interface StaffMember {
  id: string
  name: string
  overall: string
  jobRole?: string
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
  cscs?: { number?: string; expiry?: string }
  visa?: { type?: string; expiry?: string }
  references?: {
    ref1?: { name?: string; company?: string; email?: string; phone?: string; status?: string }
    ref2?: { name?: string; company?: string; email?: string; phone?: string; status?: string }
  }
  employmentHistory?: string[]
  contract?: string
  dbs?: DbsRecord
  bs7858?: Bs7858Record
  emergencyContact?: EmergencyContact
  training?: TrainingRecord
  documents?: {
    siaPhysical?:      { uploaded?: boolean; date?: string }
    passport?:         { uploaded?: boolean; date?: string }
    brpCard?:          { uploaded?: boolean; date?: string }
    proofOfAddress1?:  { uploaded?: boolean; date?: string }
    proofOfAddress2?:  { uploaded?: boolean; date?: string }
    p45?:              { uploaded?: boolean; date?: string }
    bankLetter?:       { uploaded?: boolean; date?: string }
    application?:      { uploaded?: boolean; date?: string }
    assignmentInstructions?: { uploaded?: boolean; date?: string }
  }
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
