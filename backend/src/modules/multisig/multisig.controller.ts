import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  MultisigService,
  RequestStatus,
  Pagination,
} from './multisig.service';
import {
  TransactionHashResponse,
  SuccessResponse,
  ExpiredResponse,
  RequestStatusResponse,
  PendingRequestResponse,
  MultisigConfigResponse,
  SignatureResultResponse,
  PaginatedPendingRequestsResponse,
} from './dto/multisig-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../../common/constants/roles';
import { LoggingService } from '../../common/logging/logging.service';
import { InitMultisigConfigDto } from './dto/init-multisig-config.dto';
import { UpdateMultisigConfigDto } from './dto/update-multisig-config.dto';
import { ProposeCertificateDto } from './dto/propose-certificate.dto';
import { RejectRequestDto } from './dto/reject-request.dto';

const MAX_PAGE_LIMIT = 100;

function parsePagination(page: unknown, limit: unknown): Pagination {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);

  if (!Number.isInteger(parsedPage) || parsedPage < 0) {
    throw new HttpException(
      'Page must be a non-negative integer',
      HttpStatus.BAD_REQUEST,
    );
  }

  if (
    !Number.isInteger(parsedLimit) ||
    parsedLimit < 1 ||
    parsedLimit > MAX_PAGE_LIMIT
  ) {
    throw new HttpException(
      `Limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
      HttpStatus.BAD_REQUEST,
    );
  }

  return { page: parsedPage, limit: parsedLimit };
}

@Controller('multisig')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MultisigController {
  constructor(
    private readonly multisigService: MultisigService,
    private readonly logger: LoggingService,
  ) {}

  private validateThresholdAgainstSigners(
    threshold: number,
    signers: string[],
  ): void {
    const signerCount = Array.isArray(signers) ? signers.length : 0;
    if (threshold > signerCount) {
      throw new HttpException(
        `Threshold (${threshold}) cannot exceed the number of registered signers (${signerCount})`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('config/init')
  async initMultisigConfig(
    @CurrentUser() user: User,
    @Body() configDto: InitMultisigConfigDto,
  ): Promise<TransactionHashResponse> {
    try {
      this.validateThresholdAgainstSigners(
        configDto.threshold,
        configDto.signers,
      );
      const transactionHash = await this.multisigService.initMultisigConfig(
        user.stellarPublicKey,
        configDto.issuer,
        configDto.threshold,
        configDto.signers,
        configDto.maxSigners,
      );
      return { transactionHash };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error('Failed to initialize multisig config', error);
      throw new HttpException(
        'Failed to initialize multisig configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @Put('config/update/:issuer')
  async updateMultisigConfig(
    @CurrentUser() user: User,
    @Param('issuer') issuer: string,
    @Body() configDto: UpdateMultisigConfigDto,
  ): Promise<TransactionHashResponse> {
    try {
      this.validateThresholdAgainstSigners(
        configDto.threshold,
        configDto.signers,
      );
      const transactionHash = await this.multisigService.updateMultisigConfig(
        user.stellarPublicKey,
        issuer,
        configDto.threshold,
        configDto.signers,
        configDto.maxSigners,
      );
      return { transactionHash };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to update multisig config for issuer ${issuer}`,
        error,
      );
      throw new HttpException(
        'Failed to update multisig configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @Post('propose')
  async proposeCertificate(
    @CurrentUser() user: User,
    @Body() proposeDto: ProposeCertificateDto,
  ): Promise<PendingRequestResponse> {
    try {
      const result = await this.multisigService.proposeCertificate(
        user.stellarPublicKey,
        proposeDto.requestId,
        proposeDto.issuer,
        proposeDto.recipient,
        proposeDto.metadata,
        proposeDto.expirationDays,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to propose certificate ${proposeDto.requestId}`,
        error,
      );
      throw new HttpException(
        'Failed to propose certificate',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @Post('approve/:requestId')
  async approveRequest(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<SignatureResultResponse> {
    try {
      const result = await this.multisigService.approveRequest(
        user.stellarPublicKey,
        requestId,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to approve request ${requestId}`, error);
      throw new HttpException(
        'Failed to approve request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @Post('reject/:requestId')
  async rejectRequest(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
    @Body() rejectDto: RejectRequestDto,
  ): Promise<SignatureResultResponse> {
    try {
      const result = await this.multisigService.rejectRequest(
        user.stellarPublicKey,
        requestId,
        rejectDto.reason,
      );
      return result;
    } catch (error) {
      this.logger.error(`Failed to reject request ${requestId}`, error);
      throw new HttpException(
        'Failed to reject request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @Post('issue/:requestId')
  async issueApprovedCertificate(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<SuccessResponse> {
    try {
      const success = await this.multisigService.issueApprovedCertificate(
        user.stellarPublicKey,
        requestId,
      );
      return { success };
    } catch (error) {
      this.logger.error(
        `Failed to issue certificate for request ${requestId}`,
        error,
      );
      throw new HttpException(
        'Failed to issue certificate',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  @Delete('cancel/:requestId')
  async cancelRequest(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<SuccessResponse> {
    try {
      const success = await this.multisigService.cancelRequest(
        user.stellarPublicKey,
        requestId,
      );
      return { success };
    } catch (error) {
      this.logger.error(`Failed to cancel request ${requestId}`, error);
      throw new HttpException(
        'Failed to cancel request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Roles(UserRole.ADMIN, UserRole.ISSUER, UserRole.USER)
  @Det('config/:issuer')
  async getMultisigConfig(
    @CurrentUser() user: User,
    @Param('issuer') issuer: string,
  ): Promise<MultisigConfigResponse> {
    try {
      const config = await this.multisigService.getMultisigConfig(issuer);
      return config;
    } catch (error) {
      this.logger.error(
        `Failed to get multisig config for issuer ${issuer}`,
        error,
      );
      throw new HttpException(
        'Failed to get multisig configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('request/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async getPendingRequest(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<PendingRequestResponse> {
    try {
      const request = await this.multisigService.getPendingRequest(
        requestId,
        user.stellarPublicKey,
      );
      return request;
    } catch (error) {
      this.logger.error(`Failed to get pending request ${requestId}`, error);
      throw new HttpException(
        'Failed to get pending request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('requests/issuer/:issuer')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async getPendingRequestsForIssuer(
    @CurrentUser() user: User,
    @Param('issuer') issuer: string,
    @Query('page') page: unknown = 0,
    @Query('limit') limit: unknown = 20,
  ): Promise<PaginatedPendingRequestsResponse> {
    try {
      const pagination = parsePagination(page, limit);
      const result = await this.multisigService.getPendingRequestsForIssuer(
        issuer,
        pagination,
        user.stellarPublicKey,
      );
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to get pending requests for issuer ${issuer}`,
        error,
      );
      throw new HttpException(
        'Failed to get pending requests for issuer',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('requests/signer/:signer')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async getPendingRequestsForSigner(
    @CurrentUser() user: User,
    @Param('signer') signer: string,
    @Query('page') page: unknown = 0,
    @Query('limit') limit: unknown = 20,
  ): Promise<PaginatedPendingRequestsResponse> {
    try {
      const pagination = parsePagination(page, limit);
      const result = await this.multisigService.getPendingRequestsForSigner(
        signer,
        pagination,
        user.stellarPublicKey,
      );
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Failed to get pending requests for signer ${signer}`,
        error,
      );
      throw new HttpException(
        'Failed to get pending requests for signer',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('expired/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async isRequestExpired(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<ExpiredResponse> {
    try {
      const expired = await this.multisigService.isRequestExpired(
        requestId,
        user.stellarPublicKey,
      );
      return { expired };
    } catch (error) {
      this.logger.error(
        `Failed to check if request ${requestId} is expired`,
        error,
      );
      throw new HttpException(
        'Failed to check request expiration status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('status/:requestId')
  @Roles(UserRole.ADMIN, UserRole.ISSUER)
  async getRequestStatus(
    @CurrentUser() user: User,
    @Param('requestId') requestId: string,
  ): Promise<RequestStatusResponse> {
    try {
      const request = await this.multisigService.getPendingRequest(
        requestId,
        user.stellarPublicKey,
      );
      return { status: request.status };
    } catch (error) {
      this.logger.error(`Failed to get request status for ${requestId}`, error);
      throw new HttpException(
        'Failed to get request status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
