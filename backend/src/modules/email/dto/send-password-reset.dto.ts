import { IsEmail, IsString, IsUrl } from 'class-validator';

export class SendPasswordResetDto {
  @IsEmail()
  to: string;

  @IsString()
  userName: string;

  @IsUrl()
  resetLink: string;
}
