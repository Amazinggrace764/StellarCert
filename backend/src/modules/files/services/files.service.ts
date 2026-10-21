import { Injectable } from '@nestjs/common';
import { StorageService } from './storage.service';
import { PdfService, CertificateData } from './pdf.service';
import { QrCodeService } from './qrcode.service';
import { LoggingService } from '../../../common/logging/logging.service';

/**
 * Default TTL for pre-signed URLs returned to clients.
 * URLs are generated on-demand and never persisted.
 */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

@Injectable()
export class FilesService {
  constructor(
    private readonly storageService: StorageService,
    private readonly pdfService: PdfService,
    private readonly qrCodeService: QrCodeService,
    private readonly logger: LoggingService,
  ) {}

  /**
   * Uploads a QR code and returns both the persistable object key and a
   * short-lived pre-signed URL for immediate client use. Callers that
   * persist a reference must store the key, not the URL.
   */
  async generateAndUploadQrCode(
    text: string,
    filenamePrefix = 'qr',
  ): Promise<{ qrUrl: string; qrKey: string; qrBuffer: Buffer }> {
    const qrBuffer = await this.qrCodeService.generateQrCode(text);
    const qrUpload = await this.storageService.uploadFile(
      qrBuffer,
      `${filenamePrefix}.png`,
      'image/png',
    );

    return {
      qrUrl: qrUpload.url,
      qrKey: qrUpload.key,
      qrBuffer,
    };
  }

  async generateAndUploadCertificate(data: CertificateData): Promise<{
    pdfUrl: string;
    pdfKey: string;
    qrUrl?: string;
    qrKey?: string;
  }> {
    // 1. Generate QR Code
    // The QR code usually points to a verification URL
    let qrBuffer: Buffer | undefined;
    let qrKey: string | undefined;
    let qrUrl: string | undefined;

    if (data.verificationUrl) {
      try {
        const qrUpload = await this.generateAndUploadQrCode(
          data.verificationUrl,
          `qr-${data.tokenId || Date.now()}`,
        );
        qrBuffer = qrUpload.qrBuffer;
        qrKey = qrUpload.qrKey;
        qrUrl = qrUpload.qrUrl;
      } catch (error) {
        this.logger.error(
          `Error generating/uploading QR code: ${error.message}`,
        );
        // Proceed without QR if it fails? Or throw?
        // Requirements say "Create QR codes", so probably should fail if it fails.
        throw error;
      }
    }

    // 2. Generate PDF with QR Code
    const pdfBuffer = await this.pdfService.generateCertificate({
      ...data,
      qrCodeBuffer: qrBuffer,
    });

    // 3. Upload PDF
    const pdfUpload = await this.storageService.uploadFile(
      pdfBuffer,
      `cert-${data.tokenId || Date.now()}.pdf`,
      'application/pdf',
    );

    return {
      pdfUrl: pdfUpload.url,
      pdfKey: pdfUpload.key,
      qrUrl,
      qrKey,
    };
  }

  /**
   * Resolves a stored object key to a fresh pre-signed URL. This is the
   * only supported way to obtain a readable URL for a persisted key;
   * stored URLs will expire.
   */
  async getFileUrl(
    key: string,
    expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
  ): Promise<string> {
    return this.storageService.getSignedUrl(key, expiresInSeconds);
  }

  /**
   * Buld resolver for lists of stored keys (e.g. profile pictures).
   * Returns a key -> URL map, skipping null/undefined keys.
   */
  async getFileUrlsBulk(
    keys: Array<string | null | undefined>,
    expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
  ): Promise<Record<string, string>> {
    const uniqueKeys = Array.from(
      new Set(keys.filter((key): key is string => !!key)),
    );
    const entries = await Promise.all(
      uniqueKeys.map(async (key) => {
        const url = await this.getFileUrl(key, expiresInSeconds);
        return [key, url] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  async deleteFile(key: string): Promise<void> {
    return this.storageService.deleteFile(key);
  }
}
