import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { User, UserRole } from '../entities/user.entity';
import { UserRepository } from '../repositories/user.repository';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { IUserPublic } from '../interfaces/user.interface';
import { LoggingService } from '../../../common/logging/logging.service';
import { StorageService } from '../../files/services/storage.service';

@Injectable()
export class UserProfileService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: LoggingService,
    private readonly storageService: StorageService,
  ) {}

  async getProfile(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<User> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if username is being changed and if it's already taken
    if (
      updateProfileDto.username &&
      updateProfileDto.username !== user.username
    ) {
      if (
        await this.userRepository.existsByUsername(updateProfileDto.username)
      ) {
        throw new ConflictException('Username already taken');
      }
    }

    // Check if Stellar public key is being changed and if it's already taken
    if (
      updateProfileDto.stellarPublicKey &&
      updateProfileDto.stellarPublicKey !== user.stellarPublicKey
    ) {
      if (
        await this.userRepository.existsByStellarPublicKey(
          updateProfileDto.stellarPublicKey,
        )
      ) {
        throw new ConflictException('Stellar public key already registered');
      }
    }

    const updatedUser = await this.userRepository.update(
      userId,
      updateProfileDto,
    );

    this.logger.log(`Profile updated for user: ${user.email}`);

    return updatedUser!;
  }

  async deleteProfile(userId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Soft delete
    await this.userRepository.softDelete(userId);

    this.logger.log(`Profile deleted (soft) for user: ${user.email}`);

    return { message: 'Account deactivated successfully' };
  }

  /**
   * Maps a User entity to the public representation.
   *
   * `user.profilePicture` stores the S3 object key. The public field
   * `profilePicture` exposes a freshly signed URL so clients always receive
   * a valid, reachable URL. The object key is also exposed as
   * `profilePictureKey` for clients that need to reference it directly.
   */
  private async toPublicUser(user: User): Promise<IUserPublic> {
    const profilePictureKey = user.profilePicture || null;
    const profilePictureUrl = await this.storageService.getSignedUrlOrNull(
      profilePictureKey,
    );

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePicture: profilePictureUrl,
      profilePictureKey,
      role: user.role,
      stellarPublicKey: user.stellarPublicKey,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt,
    };
  }

  /**
   * Public accessor for controllers that need to return a sanitized user
   * payload with a freshly signed profile picture URL.
   */
  async toPublicUserResponse(user: User): Promise<IUserPublic> {
    return this.toPublicUser(user);
  }
}
