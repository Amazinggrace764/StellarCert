import { IsNotEmpty, IsString } from 'class-validator';

export class BaseDto {
  @IsNotEmpty()
  @IsString()
  id: string;
}

export class PaginationDto {
  page: number = 1;
  limit: number = 20;
  skip: number = 0;
  total: number;
  totalPages: number;
}

export class ListResponseDto<T> {
  data: T[];
  pagination: PaginationDto;
  timestamp: string;
  path: string;
  message: string;
}

export class ErrorResponseDto {
  errorCode: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
  path: string;
  correlationId?: string;
}
