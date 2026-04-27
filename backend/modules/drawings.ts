// ═════════════════════════════════════════════════════════════════════
// Module: Drawing / Document Revision Control
//
// Drawings with rev letters, revision history, "locked when issued",
// surfaced as the current rev on job travelers. Required for any
// ISO-9001 / AS-9100 / ITAR / medical work.
//
// Key rules:
//   • A drawing has many revisions. Only ONE is "current" at a time.
//   • Once marked "issued" (superseded by a newer rev), prior revs are
//     LOCKED — no edits. They stay viewable for audit.
//   • Each job stamps which specific rev it's built to. If the rev
//     changes mid-job, the app warns before silently swapping.
//
// Phase: dormant. Types only.
// ═════════════════════════════════════════════════════════════════════

/** A drawing = "the current specification for this part". */
export interface DrawingDefinition {
  id: string;
  tenantId: string;
  partNumber: string;
  customer?: string;
  /** Currently active revision id — points into `revisions[]`. */
  currentRevisionId: string;
  revisions: DrawingRevision[];
  /** Tags for categorization — "aerospace", "safety-critical", etc. */
  tags?: string[];
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DrawingRevision {
  id: string;
  /** "A", "B", "C", or numeric — shop preference. */
  revLabel: string;
  /** Uploaded PDF / DWG / image — base64 or Firebase Storage URL. */
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** What changed in this rev. */
  changeNotes: string;
  issuedAt: number;                 // when this rev went "active"
  issuedBy: string;
  issuedByName?: string;
  /** When the rev was superseded by a newer one. After this timestamp
   *  the rev is read-only — its data is frozen for audit. */
  supersededAt?: number;
  /** Approval metadata — some shops require eng + quality sign-off. */
  approvals?: DrawingApproval[];
  /** Raw upload metadata — originating PO, email, etc. */
  receivedFrom?: string;
  receivedVia?: 'email' | 'portal' | 'manual-upload' | 'import';
}

export interface DrawingApproval {
  role: 'engineering' | 'quality' | 'manager' | 'customer' | 'other';
  byUid?: string;
  byName: string;
  at: number;
  note?: string;
}

/** Link between a job and the specific drawing revision it was built to.
 *  This is what prints on the traveler + what Customer Portal displays. */
export interface JobDrawingStamp {
  jobId: string;
  tenantId: string;
  drawingId: string;                // → DrawingDefinition
  revisionId: string;               // → DrawingRevision.id
  revLabel: string;                 // denormalized for display
  stampedAt: number;
  stampedBy: string;
  /** When true, the rev changed after this stamp was applied. App warns
   *  the operator "newer rev available — should we switch?". */
  supersededSinceStamp?: boolean;
}
