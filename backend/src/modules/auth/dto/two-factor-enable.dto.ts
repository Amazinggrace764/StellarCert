import { IsString, Length } from 'class-validator';

export class TwoFactorEnableDto {
  @IsString()
  secret: string;

  @IsString()
  @Length(6, 6)
  token: string;
}
