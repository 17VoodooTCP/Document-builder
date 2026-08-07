import type { LineItem } from './money';

/**
 * The Billing & Invoice Studio's document model.
 *
 * Twelve document types over one layout. The same argument that gave the Letter
 * Builder a single sheet applies here with more force: a proforma and a
 * commercial invoice differ by a title, a couple of labels and which totals are
 * shown, and building them as separate templates guarantees that in six months
 * only some of them will have the new tax-breakdown block.
 *
 * So a `BillingKind` is a small declaration — what it is called, what its
 * reference is prefixed with, which parties it names, which blocks it draws —
 * and the renderer reads it.
 *
 * Nothing here touches the Letter Builder. It shares the sheet furniture
 * (guilloché, foil, seal, microtext, QR) and the register it issues into, and
 * has its own state, its own page and its own draft payloads.
 */

export type BillingKind =
  | 'INVOICE' | 'PROFORMA' | 'COMMERCIAL_INVOICE' | 'TAX_INVOICE'
  | 'QUOTATION' | 'ESTIMATE' | 'PURCHASE_ORDER' | 'RECEIPT'
  | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'STATEMENT' | 'PAYMENT_REQUEST';

export interface BillingTemplate {
  kind: BillingKind;
  title: string;
  /** Reference prefix, so a quotation and an invoice never share a number. */
  prefix: string;
  /** What the recipient block is called on this document. */
  partyLabel: string;
  /** One line explaining what the document is for, shown in the picker. */
  note: string;
  /** Whether money is owed. A quotation has no balance due; an invoice does. */
  showsBalance: boolean;
  /** Whether payment instructions are printed. */
  showsPayment: boolean;
  /** Whether a due date is meaningful. */
  showsDueDate: boolean;
  /** Standing wording at the foot, stating what the document is not. */
  footerNote: string;
  /** The line printed under the totals. */
  closingNote: string;
}

export const BILLING_TEMPLATES: BillingTemplate[] = [
  {
    kind: 'INVOICE', title: 'Invoice', prefix: 'INV', partyLabel: 'Bill to',
    note: 'A demand for payment against goods or services already supplied.',
    showsBalance: true, showsPayment: true, showsDueDate: true,
    footerNote: 'Invoice · Payable in accordance with the terms below',
    closingNote: 'Please quote the invoice number with your payment.',
  },
  {
    kind: 'PROFORMA', title: 'Proforma Invoice', prefix: 'PRO', partyLabel: 'Bill to',
    note: 'Issued before supply. Not a demand for payment and not a tax document.',
    showsBalance: true, showsPayment: true, showsDueDate: false,
    /* Stated plainly because a proforma presented as an invoice is a customs
       and tax problem for the person receiving it, not for the issuer. */
    footerNote: 'Proforma · Not a tax invoice · No payment is due on this document',
    closingNote: 'This proforma is issued for information and does not constitute a demand for payment.',
  },
  {
    kind: 'COMMERCIAL_INVOICE', title: 'Commercial Invoice', prefix: 'CIN', partyLabel: 'Consignee',
    note: 'For export and customs clearance. Names consignor, consignee and terms of sale.',
    showsBalance: true, showsPayment: true, showsDueDate: true,
    footerNote: 'Commercial Invoice · For customs purposes',
    closingNote: 'The particulars given above are true and correct to the best of our knowledge.',
  },
  {
    kind: 'TAX_INVOICE', title: 'Tax Invoice', prefix: 'TAX', partyLabel: 'Bill to',
    note: 'Carries the tax breakdown by rate, as a registered supplier must.',
    showsBalance: true, showsPayment: true, showsDueDate: true,
    footerNote: 'Tax Invoice · Retain for your records',
    closingNote: 'Tax shown is charged on the discounted value of each line.',
  },
  {
    kind: 'QUOTATION', title: 'Quotation', prefix: 'QUO', partyLabel: 'Prepared for',
    note: 'A priced offer, open for acceptance until it expires.',
    showsBalance: false, showsPayment: false, showsDueDate: false,
    footerNote: 'Quotation · Not an invoice · No payment is due',
    closingNote: 'This quotation is valid until the date shown and is subject to acceptance in writing.',
  },
  {
    kind: 'ESTIMATE', title: 'Estimate', prefix: 'EST', partyLabel: 'Prepared for',
    note: 'An indicative figure. Explicitly not a fixed price.',
    showsBalance: false, showsPayment: false, showsDueDate: false,
    footerNote: 'Estimate · Indicative only · Not a fixed price or an invoice',
    closingNote: 'Figures are an estimate and may vary with the work actually required.',
  },
  {
    kind: 'PURCHASE_ORDER', title: 'Purchase Order', prefix: 'PO', partyLabel: 'Supplier',
    note: 'An instruction to a supplier to deliver against agreed prices.',
    showsBalance: false, showsPayment: false, showsDueDate: true,
    footerNote: 'Purchase Order · Quote this number on all correspondence and invoices',
    closingNote: 'Delivery and invoicing must reference this purchase order number.',
  },
  {
    kind: 'RECEIPT', title: 'Receipt', prefix: 'REC', partyLabel: 'Received from',
    note: 'Acknowledges money actually received.',
    showsBalance: true, showsPayment: false, showsDueDate: false,
    footerNote: 'Receipt · Acknowledgement of payment received',
    closingNote: 'Received with thanks.',
  },
  {
    kind: 'CREDIT_NOTE', title: 'Credit Note', prefix: 'CRN', partyLabel: 'Credit to',
    note: 'Reduces what a customer owes. Amounts are credits, not charges.',
    showsBalance: true, showsPayment: false, showsDueDate: false,
    footerNote: 'Credit Note · Reduces the balance owed · Not a demand for payment',
    closingNote: 'This credit note may be set against the invoice referenced above.',
  },
  {
    kind: 'DEBIT_NOTE', title: 'Debit Note', prefix: 'DBN', partyLabel: 'Debit to',
    note: 'Increases what is owed, usually after an undercharge.',
    showsBalance: true, showsPayment: true, showsDueDate: true,
    footerNote: 'Debit Note · Increases the balance owed',
    closingNote: 'This debit note is raised in addition to the invoice referenced above.',
  },
  {
    kind: 'STATEMENT', title: 'Statement of Account', prefix: 'STA', partyLabel: 'Account of',
    note: 'A position at a date, not a demand. Lists documents rather than goods.',
    showsBalance: true, showsPayment: true, showsDueDate: false,
    footerNote: 'Statement of Account · Position as at the date shown',
    closingNote: 'This statement reflects the position on our ledger at the date shown.',
  },
  {
    kind: 'PAYMENT_REQUEST', title: 'Payment Request', prefix: 'PRQ', partyLabel: 'Payable by',
    note: 'Requests a payment — a deposit, a milestone, a stage.',
    showsBalance: true, showsPayment: true, showsDueDate: true,
    footerNote: 'Payment Request · Payable in accordance with the terms below',
    closingNote: 'Please quote the reference above with your payment.',
  },
];

export const template = (kind: BillingKind): BillingTemplate =>
  BILLING_TEMPLATES.find((t) => t.kind === kind) || BILLING_TEMPLATES[0];

/** A party on the document — the issuer's counterparty. */
export interface Party {
  name: string;
  company: string;
  addressLines: string;
  shippingLines: string;
  email: string;
  phone: string;
  taxId: string;
}

/** Bank details. Printed, never stored on the register. */
export interface PaymentDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string;
  swift: string;
  routing: string;
  reference: string;
  notes: string;
}

export type BillingStatus =
  'DRAFT' | 'ISSUED' | 'PAID' | 'PART_PAID' | 'OVERDUE' | 'CANCELLED';

export const STATUS_LABEL: Record<BillingStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PAID: 'Paid in full',
  PART_PAID: 'Part paid',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};

/** The whole editor state. Serialised wholesale into a Draft payload, exactly
    as the Letter Builder does — the shape will keep changing, and migrating a
    collection every time a field is added buys nothing. */
export interface BillingDraft {
  kind: BillingKind;
  reference: string;
  documentTitle: string;
  subtitle: string;

  issuedOn: string;
  dueOn: string;
  status: BillingStatus;
  classification: string;
  department: string;

  party: Party;
  lines: LineItem[];

  currencyCode: string;
  shipping: string;
  other: string;
  paid: string;

  payment: PaymentDetails;

  terms: string;
  paymentTerms: string;
  latePaymentNotice: string;
  notes: string;

  signerName: string;
  signerTitle: string;

  /** Reuses the sheet furniture the Letter Builder already draws. */
  features: {
    seal: boolean;
    watermark: boolean;
    qr: boolean;
    microtext: boolean;
    frame: boolean;
    guilloche: boolean;
    holoStrip: boolean;
    signature: boolean;
  };
  typeface: string;
  foil: string;
}

export const blankLine = (): LineItem => ({
  id: Math.random().toString(36).slice(2, 10),
  description: '',
  qtyMilli: 1000,
  unit: 'ea',
  unitPriceMinor: 0,
  discountBp: 0,
  taxBp: 0,
});
