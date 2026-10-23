import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, UserStatus } from '../entities/user.entity';

export class UpdateUserRoleDto {
  @ApiProperty({
    description: 'New role for the user',
    enum: UserRole,
    example: UserRole.ISSUER,
  })
  @IsNotEmpty({ message: 'Role is required' })
  @IsEnum(UserRole, { message: 'Invalid user role' })
  role: UserRole;
}

export class UpdateUserStatusDto {
  @ApiProperty({
    description: 'New status for the user',
    enum: UserStatus,
    example: UserStatus.ACTIVE,
  })
  @IsNotEmpty({ message: 'Status is required' })
  @IsEnum(UserStatus, { message: 'Invalid user status' })
  status: UserStatus;
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional({
    description: 'User first name',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiPropertyOptional({
    description: 'User last name',
    example: 'Doe',
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiPropertyOptional({
    description: 'User role',
    enum: UserRole,
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'User status',
    enum: UserStatus,
  })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({
    description: 'Is user active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Is email verified',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isEmailVerified?: boolean;
}

export class DeactivateUserDto {
  @ApiPropertyOptional({
    description: 'Reason for deactivation',
    example: 'Violation of terms of service',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
