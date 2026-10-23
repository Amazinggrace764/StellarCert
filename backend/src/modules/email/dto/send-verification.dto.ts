import { IsEmail, IsString, IsUrl } from 'class-validator';

export class SendVerificationDto {
  @IsEmail()
  to: string;

  @IsString()
  userName: string;

  @IsUrl()
  verificationLink: string;
}
