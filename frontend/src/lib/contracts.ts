/**
 * Agreement Studio.
 *
 * Eight contract types over one sheet, on the same argument that gave the
 * letters and the invoices one each: an employment agreement and a consulting
 * agreement differ by which clauses they open with, not by how a page is built.
 *
 * A contract is a list of numbered sections and a set of signature blocks. That
 * is the whole model — everything else (which sections a template starts with,
 * how many parties sign) is a declaration the renderer reads.
 */

export type ContractKind =
  | 'CONTRACTOR' | 'SERVICE' | 'EMPLOYMENT' | 'PURCHASE'
  | 'EQUIPMENT_RENTAL' | 'CONSULTING' | 'PARTNERSHIP' | 'GENERAL';

/**
 * A labelled fill-in row: `CONTRACT VALUE: ____________`.
 *
 * The rule runs whether or not a value is typed, so the same clause serves as
 * a completed record and as a form to be filled in by hand — which is what a
 * printed agreement is usually doing on the day it is signed.
 */
export interface FieldRow {
  id: string;
  label: string;
  value: string;
}

/** One clause. `heading` is numbered by position, never stored. */
export interface Section {
  id: string;
  heading: string;
  /** Prose above the particulars — what is being agreed. */
  body: string;
  /** Particulars, printed between the two bodies as labelled rules. */
  fields?: FieldRow[];
  /**
   * Prose below the particulars.
   *
   * A clause is rarely heading-then-rows-then-stop. It usually opens with a
   * sentence, sets out the specifics, then closes with the conditions attached
   * to them — and without somewhere to put that closing paragraph the document
   * reads as a form rather than as an agreement.
   */
  bodyAfter?: string;
  /** Blank ruled lines, for anything completed by hand. */
  ruledLines?: number;
  /**
   * Ink for this clause's heading, as a hex colour.
   *
   * Blank inherits the organisation's accent, which is the sane default — a
   * document where every clause was coloured separately would be a ransom note.
   * It is here because some agreements genuinely do colour-code sections, and
   * the alternative was everything on the page being one flat black.
   */
  color?: string;
}

/** A party to the agreement, and the block they sign in. */
export interface ContractParty {
  id: string;
  role: string;
  name: string;
  company: string;
  title: string;
  department: string;
  addressLines: string;
  /** Printed under the rule, so a countersignature can be dated by hand. */
  dateLine: boolean;
}

export interface ContractTemplate {
  kind: ContractKind;
  title: string;
  prefix: string;
  note: string;
  /** Section headings this type opens with. */
  sections: string[];
  partyRoles: string[];
}

/*
 * The clause spine every commercial agreement shares. Templates below extend
 * it rather than restate it, so adding "Data Protection" to the standard set is
 * one edit instead of eight.
 */
const CORE = [
  'Recitals',
  'Scope of Work',
  'Responsibilities',
  'Contract Value',
  'Payment Terms',
  'Duration',
  'Confidentiality',
  'Intellectual Property',
  'Termination',
  'Force Majeure',
  'Dispute Resolution',
  'Governing Law',
];

export const CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    kind: 'CONTRACTOR', title: 'Contractor Agreement', prefix: 'CTR',
    note: 'Engages an independent contractor. Sets scope, rate and the boundary against employment.',
    sections: ['Recitals', 'Scope of Work', 'Responsibilities', 'Contract Value', 'Payment Terms',
      'Milestones', 'Project Location', 'Duration', 'Equipment', 'Insurance',
      'Confidentiality', 'Intellectual Property', 'Termination', 'Force Majeure',
      'Dispute Resolution', 'Governing Law', 'Schedules'],
    partyRoles: ['Client', 'Contractor'],
  },
  {
    kind: 'SERVICE', title: 'Service Agreement', prefix: 'SVC',
    note: 'Ongoing services against a defined scope and service levels.',
    sections: [...CORE, 'Milestones', 'Schedules'],
    partyRoles: ['Client', 'Service Provider'],
  },
  {
    kind: 'EMPLOYMENT', title: 'Employment Agreement', prefix: 'EMP',
    note: 'An employment relationship: role, remuneration, notice and restrictive covenants.',
    sections: ['Recitals', 'Position and Duties', 'Commencement', 'Remuneration', 'Working Hours',
      'Leave and Benefits', 'Confidentiality', 'Intellectual Property',
      'Restrictive Covenants', 'Termination', 'Notice', 'Governing Law'],
    partyRoles: ['Employer', 'Employee'],
  },
  {
    kind: 'PURCHASE', title: 'Purchase Agreement', prefix: 'PUR',
    note: 'Sale and purchase of goods: specification, delivery, title and risk.',
    sections: ['Recitals', 'Goods and Specification', 'Contract Value', 'Payment Terms',
      'Delivery', 'Title and Risk', 'Inspection and Acceptance', 'Warranties',
      'Termination', 'Force Majeure', 'Dispute Resolution', 'Governing Law'],
    partyRoles: ['Buyer', 'Seller'],
  },
  {
    kind: 'EQUIPMENT_RENTAL', title: 'Equipment Rental Agreement', prefix: 'EQR',
    note: 'Hire of plant or equipment: term, condition, insurance and return.',
    sections: ['Recitals', 'Equipment', 'Rental Period', 'Rental Charges', 'Payment Terms',
      'Delivery and Return', 'Condition and Maintenance', 'Insurance', 'Liability',
      'Termination', 'Governing Law', 'Schedules'],
    partyRoles: ['Owner', 'Hirer'],
  },
  {
    kind: 'CONSULTING', title: 'Consulting Agreement', prefix: 'CON',
    note: 'Professional advice: deliverables, fees and ownership of work product.',
    sections: ['Recitals', 'Scope of Work', 'Deliverables', 'Contract Value', 'Payment Terms',
      'Duration', 'Confidentiality', 'Intellectual Property', 'Conflicts of Interest',
      'Termination', 'Dispute Resolution', 'Governing Law'],
    partyRoles: ['Client', 'Consultant'],
  },
  {
    kind: 'PARTNERSHIP', title: 'Partnership Agreement', prefix: 'PTN',
    note: 'A partnership between two or more parties: contributions, shares and exit.',
    sections: ['Recitals', 'Formation', 'Contributions', 'Profit and Loss Sharing',
      'Management and Decisions', 'Duration', 'Admission and Withdrawal',
      'Confidentiality', 'Dissolution', 'Dispute Resolution', 'Governing Law', 'Schedules'],
    partyRoles: ['Partner A', 'Partner B'],
  },
  {
    kind: 'GENERAL', title: 'General Contract', prefix: 'GEN',
    note: 'A neutral starting point carrying the standard commercial clauses.',
    sections: CORE,
    partyRoles: ['Party A', 'Party B'],
  },
];

export const contractTemplate = (kind: ContractKind): ContractTemplate =>
  CONTRACT_TEMPLATES.find((t) => t.kind === kind) || CONTRACT_TEMPLATES[7];

const id = () => Math.random().toString(36).slice(2, 10);

export const blankSection = (heading = ''): Section => ({ id: id(), heading, body: '', bodyAfter: '', fields: [] });

export const blankField = (label = ''): FieldRow => ({ id: id(), label, value: '' });

/**
 * The particulars most agreements state as labelled rows rather than prose.
 * Offered as a one-click block so an author does not type the same six labels
 * into every contract they raise.
 */
export const PARTICULARS: string[] = [
  'Type of contract',
  'Contract reference number',
  'Contract value',
  'Site / location',
  'Date of agreement',
  'Duration',
];

export const blankParty = (role: string): ContractParty => ({
  id: id(), role, name: '', company: '', title: '', department: '',
  addressLines: '', dateLine: true,
});

export type ContractStatus = 'DRAFT' | 'FOR_EXECUTION' | 'EXECUTED' | 'TERMINATED' | 'SUPERSEDED';

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  DRAFT: 'Draft',
  FOR_EXECUTION: 'For execution',
  EXECUTED: 'Executed',
  TERMINATED: 'Terminated',
  SUPERSEDED: 'Superseded',
};

export interface ContractDraft {
  kind: ContractKind;
  reference: string;
  documentTitle: string;
  subtitle: string;
  agreementNumber: string;
  effectiveDate: string;
  issuedOn: string;
  status: ContractStatus;
  classification: string;
  department: string;

  parties: ContractParty[];
  sections: Section[];

  /** Printed above the signatures, immediately before anybody signs. */
  executionNote: string;
  footerNote: string;

  features: {
    seal: boolean;
    watermark: boolean;
    qr: boolean;
    microtext: boolean;
    frame: boolean;
    guilloche: boolean;
    holoStrip: boolean;
    marginRule: boolean;
  };
  typeface: string;
  foil: string;
}

export const newContract = (kind: ContractKind): Omit<ContractDraft, 'reference'> => {
  const t = contractTemplate(kind);
  return {
    kind,
    documentTitle: t.title,
    subtitle: '',
    agreementNumber: '',
    effectiveDate: '',
    issuedOn: new Date().toISOString().slice(0, 10),
    status: 'FOR_EXECUTION',
    classification: 'Private & Confidential',
    department: '',
    parties: t.partyRoles.map(blankParty),
    sections: t.sections.map((h) => blankSection(h)),
    executionNote:
      'The parties have executed this agreement on the dates written beside their signatures.',
    footerNote: 'Agreement · Confidential between the parties named',
    features: {
      seal: true, watermark: true, qr: true, microtext: true,
      frame: true, guilloche: true, holoStrip: true, marginRule: true,
    },
    typeface: 'times',
    foil: 'purple-gold',
  };
};
