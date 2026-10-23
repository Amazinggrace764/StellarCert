import { IsString, Length } from 'class-validator';

export class TwoFactorTokenDto {
  @IsString()
  @Length(6, 8)
  token: string;
}
