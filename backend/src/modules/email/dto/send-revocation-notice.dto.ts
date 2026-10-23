import { IsEmail, IsString, IsDateString } from 'class-validator';

export class SendRevocationNoticeDto {
  @IsEmail()
  to: string;

  @IsString()
  recipientName: string;

  @IsString()
  certificateId: string;

  @IsString()
  certificateName: string;

  @IsString()
  reason: string;

  @IsDateString()
  revocationDate: string;
}
