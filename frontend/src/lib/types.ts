/** Shapes as the API returns them. Kept flat and boring on purpose. */

export type Role = 'VIEWER' | 'ISSUER' | 'OWNER';

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
  createdAt?: string;
}

/** An organisation as it appears in the caller's own list, with their role. */
export interface Membership {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  accentColor: string;
  role: Role;
}

export interface Organisation {
  id: string;
  slug: string;
  name: string;
  legalName: string;
  addressLine1: string;
  addressLine2: string;
  country: string;
  supportEmail: string;
  website: string;
  logo: string | null;
  watermark: string | null;
  seal: string | null;
  accentColor: string;
  inkColor: string;
  referencePrefix: string;
}

/** What /verify returns. A subset — the portal never receives the body. */
export type PortalOrganisation = Omit<Organisation, 'id' | 'watermark' | 'referencePrefix'>;

export type DocumentKind = 'LETTER' | 'CERTIFICATE' | 'NOTICE' | 'STATEMENT';
export type DocumentStatus = 'ACTIVE' | 'PENDING' | 'EXPIRED' | 'REVOKED';

export interface IssuedDocument {
  id: string;
  reference: string;
  verificationId: string;
  fingerprint: string;
  kind: DocumentKind;
  documentTitle: string;
  recipientName: string;
  subject: string;
  department: string;
  classification: string;
  signerName: string;
  signerTitle: string;
  authorizationId: string;
  issuedOn: string;
  status: DocumentStatus;
  statusReason: string | null;
  generatedAt: string;
  lastVerifiedAt: string | null;
  verifyCount: number | null;
  createdAt: string;
}

export interface Signatory {
  id: string;
  name: string;
  title: string;
  department: string;
  prefix: string | null;
  signature: string | null;
  isActive: boolean;
}

export interface Draft {
  id: string;
  title: string;
  kind: DocumentKind;
  payload: string;
  reference: string;
  updatedAt: string;
}

/** Which blocks the renderer draws. Mirrors DocumentTemplate.features. */
export interface Features {
  seal: boolean;
  watermark: boolean;
  qr: boolean;
  microtext: boolean;
  frame: boolean;
  /** The guilloché rosette — drawn from the reference, so no two documents
      carry the same one. Stands in as the watermark when none is uploaded. */
  guilloche: boolean;
  /** The vertical classification strip down the left margin. */
  marginRule: boolean;
  /** The foil band under the letterhead, with the issuer struck into it. */
  holoStrip: boolean;
}

/** The whole builder state. Serialised wholesale into Draft.payload. */
export interface DocumentDraft {
  kind: DocumentKind;
  reference: string;
  documentTitle: string;
  recipientName: string;
  recipientAddress: string;
  subject: string;
  body: string;
  department: string;
  classification: string;
  signerName: string;
  signerTitle: string;
  issuedOn: string;

  /** Printed top-right, above the reference block. */
  headerLabel: string;
  /** Sits beside the classification, saying who the document is for. */
  addresseeNote: string;
  /** Foot of the page. States what the document is not, which on anything
      touching money is the line that stops it being waved at a bank. */
  footerNote: string;
  version: string;
  revision: string;

  /** Key into TYPEFACES. Local families only — see lib/typefaces. */
  typeface: string;
  /** Key into FOILS. Drives the strip and the furniture that echoes it. */
  foil: string;

  features: Features;
}
