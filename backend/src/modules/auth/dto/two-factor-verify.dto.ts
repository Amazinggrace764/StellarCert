import { IsString, Length } from 'class-validator';

export class TwoFactorVerifyDto {
  @IsString()
  preAuthToken: string;

  @IsString()
  @Length(6, 8)
  token: string;
}
