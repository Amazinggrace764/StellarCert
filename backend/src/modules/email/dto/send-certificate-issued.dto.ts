import { IsEmail, IsString, IsUUID } from 'class-validator';

export class SendCertificateIssuedDto {
  @IsEmail()
  to: string;

  @IsString()
  certificateId: string;

  @IsString()
  recipientName: string;

  @IsString()
  certificateName: string;

  @IsString()
  issuerName: string;
}
