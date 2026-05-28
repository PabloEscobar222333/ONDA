import PDFDocument from 'pdfkit';
import type { InferSelectModel } from 'drizzle-orm';
import type { payments as paymentsTable } from '../db/schema.js';
import { putObject } from './storage.js';
import { env } from '../lib/env.js';
import { newId } from '../lib/id.js';

export async function buildTransactionPdf(
  businessName: string,
  rows: InferSelectModel<typeof paymentsTable>[]
): Promise<string> {
  const buffers: Buffer[] = [];
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  doc.on('data', (chunk: Buffer) => buffers.push(chunk));

  doc.fontSize(20).text('ONDA — Transaction Report', { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(12).text(businessName, { align: 'center' });
  doc.moveDown(1);

  doc.fontSize(10);
  doc.text('Date', 50, doc.y, { continued: true, width: 110 });
  doc.text('Method', 160, doc.y, { continued: true, width: 100 });
  doc.text('Status', 260, doc.y, { continued: true, width: 90 });
  doc.text('Amount (GHS)', 350, doc.y, { align: 'right' });
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(0.5);

  let total = 0;
  for (const row of rows) {
    const amt = Number(row.amount);
    if (row.status === 'confirmed') total += amt;
    doc.text(row.createdAt.toISOString().slice(0, 10), 50, doc.y, { continued: true, width: 110 });
    doc.text(row.method, 160, doc.y, { continued: true, width: 100 });
    doc.text(row.status, 260, doc.y, { continued: true, width: 90 });
    doc.text(amt.toFixed(2), 350, doc.y, { align: 'right' });
  }
  doc.moveDown(1);
  doc.fontSize(12).text(`Total confirmed: GHS ${total.toFixed(2)}`, { align: 'right' });

  doc.end();

  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  const buffer = Buffer.concat(buffers);
  const key = `${newId('rpt')}.pdf`;
  return await putObject(env.SUPABASE_BUCKET_REPORTS, key, buffer, 'application/pdf');
}
