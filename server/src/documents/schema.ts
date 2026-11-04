// Schemi zod dei payload di sync. "loose": i campi sconosciuti sono conservati (il client può evolvere), ma limiti di dimensione e tipi dei campi chiave sono verificati.
import { z } from 'zod';
import { UNITS } from '../../../shared/types';
import type { AuditEntry, CatalogItem, Profile, QuoteDocument } from '../../../shared/types';

const id = z.string().min(1).max(100);
const ts = z.number().finite().nonnegative();
const money = z.number().finite();
const unit = z.enum(UNITS as [string, ...string[]]);

const customer = z.looseObject({ id: id.optional(), name: z.string().max(300) });
const line = z.looseObject({
  id, description: z.string().max(2000), qty: money, unit, unitPrice: money, vat: money,
  discountPct: z.number().min(0).max(100).optional(),
});
const invoice = z.looseObject({
  tipoDocumento: z.enum(['TD01', 'TD04']),
  year: z.number().int().min(2000).max(2100),
  sectional: z.string().min(1).max(10),
  seq: z.number().int().positive().optional(),
  number: z.string().min(1).max(20).optional(),
  lockedAt: ts.optional(),
  xml: z.string().max(1_000_000).optional(),
  sdiEvents: z.array(z.looseObject({})).max(200).optional(),
  payments: z.array(z.looseObject({})).max(500).optional(),
  paymentStatus: z.enum(['non_pagata', 'parziale', 'pagata']).optional(),
});
const STATUSES = ['bozza', 'inviato', 'accettato', 'rifiutato', 'scaduto', 'convertito', 'emessa', 'inviata', 'consegnata',
  'mancata_consegna', 'scartata', 'stornata', 'pagato'] as const;

export const documentSchema = z.looseObject({
  id, type: z.enum(['preventivo', 'fattura']), number: z.string().max(50), date: z.string().min(8).max(10),
  customer, lines: z.array(line).max(500), notes: z.string().max(10_000).optional(),
  status: z.enum(STATUSES), transcript: z.string().max(10_000).optional(),
  invoice: invoice.optional(), createdAt: ts, updatedAt: ts,
}).refine((d) => d.type !== 'fattura' || d.invoice !== undefined, { message: 'invoice obbligatorio per type=fattura', path: ['invoice'] });

export const catalogSchema = z.looseObject({
  id, name: z.string().min(1).max(300), aliases: z.array(z.string().max(200)).max(100), unit, price: money, vat: money,
  kind: z.enum(['materiale', 'manodopera', 'servizio']), createdAt: ts, updatedAt: ts,
});

export const profileSchema = z.looseObject({
  businessName: z.string().max(300), vatNumber: z.string().max(30),
  logoDataUrl: z.string().max(400_000).optional(),
});

export const auditSchema = z.looseObject({
  id, at: ts, docId: z.string().max(100), action: z.string().max(40), actor: z.literal('user'), detail: z.string().max(2000).optional(),
});

export type { AuditEntry, CatalogItem, Profile, QuoteDocument };
