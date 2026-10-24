import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { loadEnv } from '@field-sales/shared';

import type { SalaryLineDetailView } from './salary-run.service';

/** Matches `files.service.ts`'s window — long enough to open, short enough not to be a shareable link. */
const TOKEN_TTL_SECONDS = 600;

/**
 * `Rs.`, not `₹`.
 *
 * pdfkit's built-in Helvetica is WinAnsi-encoded and has no rupee glyph: U+20B9
 * silently renders as `¹`, which on a pay document is worse than not showing a
 * symbol at all. Found by extracting the text of a generated payslip rather
 * than by reading the code.
 *
 * The fix that keeps the real symbol is embedding a Unicode TTF, which means
 * shipping a font file for one glyph. `Rs.` is unambiguous in the pilot's own
 * market and costs nothing.
 */
const CURRENCY = 'Rs.';

export interface PayslipTokenClaims {
  runId: string;
  userId: string;
  companyId: string;
}

/**
 * The payslip document, and the signed URL that serves it
 * (012-monthly-salary-run, US4).
 *
 * **This file holds the only `pdfkit` import in the codebase, deliberately.**
 * A document format changes independently of money, so the calculation in
 * `salary-run.service.ts` has no opinion about PDFs — which is also what lets
 * a payslip be re-rendered from a frozen line years later without re-entering
 * the calculation path at all.
 *
 * **Rendered from the STORED line, never from live attendance or rates**, so
 * the same request a month apart produces the same document. That is what
 * makes a payslip a record rather than a snapshot of today.
 *
 * The token scheme mirrors `files.service.ts`: an HMAC of
 * `runId|userId|companyId|exp`, not a JWT. The reason it exists at all is
 * that the device hands the URL to Android's own browser via `Linking`, and a
 * browser carries no `Authorization` header — which is what keeps the mobile
 * app free of `react-native-fs`, `react-native-share` and a native rebuild.
 */
@Injectable()
export class PayslipService {
  /**
   * Mints the short-lived URL the detail screen hands to the OS.
   *
   * Scoped to one run and one user: a token for October's payslip cannot be
   * replayed against November's, or against a colleague's.
   */
  signUrl(runId: string, userId: string, companyId: string): string {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const payload = `${runId}|${userId}|${companyId}|${exp}`;
    const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
    const token = `${payloadB64}.${this.hmac(payload)}`;
    return `/api/v1/salary-runs/${runId}/payslip/${userId}.pdf?token=${token}`;
  }

  /** Inverse of {@link signUrl}. `null` for anything malformed, signature-invalid or expired — the caller maps every case to one error without saying which. */
  verifyToken(token: string): PayslipTokenClaims | null {
    if (!token) return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, signature] = parts;

    let payload: string;
    try {
      payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    if (!this.safeEqual(signature, this.hmac(payload))) return null;

    const segments = payload.split('|');
    if (segments.length !== 4) return null;
    const [runId, userId, companyId, expStr] = segments;
    const exp = Number(expStr);
    if (!runId || !userId || !companyId || !Number.isFinite(exp)) return null;
    if (Math.floor(Date.now() / 1000) > exp) return null;

    return { runId, userId, companyId };
  }

  /**
   * The download's filename, e.g. `payslip-krishna-2026-09.pdf`.
   *
   * **Sanitising the name is a security concern here, not a cosmetic one.**
   * `employeeName` is admin-entered free text and it is about to go into an
   * HTTP *header*: a name carrying a double quote would end the quoted
   * string early, and one carrying CR/LF could inject a header outright.
   * Only `[a-z0-9-]` survives, so neither is representable.
   */
  fileName(detail: SalaryLineDetailView): string {
    const period = `${detail.period.year}-${String(detail.period.month).padStart(2, '0')}`;
    const slug = detail.employeeName
      .normalize('NFKD')
      // Strip combining marks, so "José" slugs to "jose" rather than "jos".
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '');

    // A name written wholly in a non-Latin script slugs to nothing. Fall
    // back to the period alone rather than emitting `payslip--2026-09.pdf`;
    // `filename*` below still carries the real name for clients that read it.
    return slug ? `payslip-${slug}-${period}.pdf` : `payslip-${period}.pdf`;
  }

  /**
   * The full `Content-Disposition` value.
   *
   * Two filenames on purpose (RFC 6266): the quoted `filename=` is the
   * ASCII slug every client understands, and `filename*=UTF-8''…` carries
   * the employee's name as actually written — which matters for a Tamil or
   * Devanagari name that the slug cannot represent at all. Clients that
   * understand the second prefer it; the rest fall back to the first.
   *
   * Percent-encoding makes the header injection-proof a second time over.
   */
  contentDisposition(detail: SalaryLineDetailView): string {
    const period = `${detail.period.year}-${String(detail.period.month).padStart(2, '0')}`;
    const full = `payslip-${detail.employeeName}-${period}.pdf`;
    const encoded = encodeURIComponent(full)
      // encodeURIComponent leaves these, and RFC 5987's attr-char does not
      // allow them.
      .replace(
        /['()!*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      );
    return `attachment; filename="${this.fileName(detail)}"; filename*=UTF-8''${encoded}`;
  }

  /**
   * Renders the payslip.
   *
   * **Carries exactly what the detail screen shows and no figure that is not
   * visible there** (FR-041). A draft is watermarked, because a draft handed
   * to an employee must not read as a final statement of pay (FR-042).
   */
  render(detail: SalaryLineDetailView, companyName: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const isDraft = detail.run.status === 'DRAFT';

      // The draft watermark goes down FIRST, so the content sits over it and
      // stays readable. A draft payslip must be unmistakable at a glance.
      if (isDraft) {
        doc.save();
        doc
          .fontSize(72)
          .fillColor('#E6EAF1')
          .rotate(-35, { origin: [300, 400] })
          .text('DRAFT', 80, 360, { align: 'center' });
        doc.restore();
      }

      doc.fillColor('#141A26').fontSize(18).text(companyName);
      doc
        .fontSize(13)
        .fillColor('#5A6474')
        .text(`Payslip · ${detail.period.label}`);
      doc.moveDown(1);

      doc.fontSize(16).fillColor('#141A26').text(detail.employeeName);
      doc
        .fontSize(10)
        .fillColor('#5A6474')
        .text(`${isDraft ? 'Draft' : 'Finalised'} · v${detail.run.version}`);
      doc.moveDown(1);

      doc
        .fontSize(11)
        .fillColor('#141A26')
        .text('salary = payable half-days × half-day rate');
      doc.moveDown(0.5);

      for (const entry of detail.breakdown) {
        const rate =
          entry.rate === null ? 'no rate on file' : `${CURRENCY}${entry.rate}`;
        doc
          .fontSize(10)
          .fillColor(entry.rate === null ? '#6B3904' : '#3A4353')
          .text(
            `${entry.from} – ${entry.to}  ·  ${entry.units} half-days × ${rate} = ${CURRENCY}${entry.amount}`,
          );
      }

      doc.moveDown(0.5);
      doc
        .fontSize(14)
        .fillColor('#141A26')
        .text(`Total  ${CURRENCY}${detail.amount}`, { align: 'right' });
      doc.moveDown(1);

      this.section(doc, 'Unpaid sessions', detail.unpaidSessions.length);
      for (const row of detail.unpaidSessions) {
        doc
          .fontSize(10)
          .fillColor('#3A4353')
          .text(`${row.businessDate} · ${row.session} · ${row.status}`);
      }

      this.section(doc, 'Paid non-working', detail.paidNonWorking.length);
      for (const row of detail.paidNonWorking) {
        doc
          .fontSize(10)
          .fillColor('#3A4353')
          .text(`${row.businessDate} · ${row.session} · ${row.status} (paid)`);
      }

      this.section(doc, 'Unmarked sessions', detail.unmarkedSessions.length);
      for (const row of detail.unmarkedSessions) {
        doc
          .fontSize(10)
          .fillColor('#3A4353')
          .text(`${row.businessDate} · ${row.session} · not marked`);
      }

      if (detail.lateSessions.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(11).fillColor('#6B3904').text('Late arrivals');
        for (const row of detail.lateSessions) {
          doc
            .fontSize(10)
            .fillColor('#3A4353')
            .text(`${row.businessDate} · ${row.session} · ${row.latenessFlag}`);
        }
        // LOAD-BEARING, not a nicety. This is the one document an employee
        // reads unaided, and seeing a lateness flag beside a pay figure
        // invites exactly the wrong inference (BUS-18, OD-01, FR-018).
        doc
          .fontSize(10)
          .fillColor('#6B3904')
          .text('Lateness is recorded for review and does not reduce pay.');
      }

      doc.end();
    });
  }

  private section(doc: PDFKit.PDFDocument, title: string, count: number): void {
    doc.moveDown(0.5);
    doc
      .fontSize(11)
      .fillColor('#141A26')
      .text(count === 0 ? `${title}: none` : `${title} (${count})`);
  }

  private hmac(payload: string): string {
    const secret = loadEnv().FILE_URL_SECRET;
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }

  /** Constant-time comparison — a timing side-channel would otherwise leak how many leading bytes of a forged signature are right. */
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
