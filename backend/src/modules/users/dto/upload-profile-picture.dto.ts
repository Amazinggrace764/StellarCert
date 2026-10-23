import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTO for profile picture upload
 */
export class ProfilePictureUploadResponseDto {
  @ApiProperty({
    description: 'Profile picture URL',
    example: 'https://s3.amazonaws.com/bucket/profile-pictures/user-id.jpg',
  })
  profilePicture: string;

  @ApiProperty({
    description: 'Message',
    example: 'Profile picture uploaded successfully',
  })
  message: string;
}

/**
 * DTO for updating profile picture URL in user entity
 */
export class UpdateProfilePictureDto {
  @ApiPropertyOptional({
    description: 'Profile picture URL',
    example: 'https://s3.amazonaws.com/bucket/profile-pictures/user-id.jpg',
  })
  profilePicture?: string;
}
