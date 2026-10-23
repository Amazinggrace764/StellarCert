import { ApiProperty } from '@nestjs/swagger';

export class CertificateQrResponseDto {
  @ApiProperty({
    example: 'a3d8a582-bd23-4a2d-9630-6d4a2f5fd6f0',
    description: 'Certificate identifier',
  })
  certificateId: string;

  @ApiProperty({
    example: 'AB12CD34',
    description: 'Certificate verification code encoded in the QR payload',
  })
  verificationCode: string;

  @ApiProperty({
    example: 'https://stellarcert.app/verify?serial=AB12CD34',
    description: 'Public verification URL encoded into the QR code',
  })
  verificationUrl: string;

  @ApiProperty({
    example:
      'https://storage.example.com/stellar-cert/123.png?X-Amz-Algorithm=AWS4-HMAC-SHA256',
    description: 'Signed URL for the generated QR image',
  })
  qrUrl: string;
}
