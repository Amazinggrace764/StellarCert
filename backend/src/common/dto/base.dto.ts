import { IsNotEmpty, IsString } from 'class-validator';

export class BaseDto {
  @IsNotEmpty()
  @IsString()
  id: string;
}
