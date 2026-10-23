import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SentryService } from '../monitoring/sentry.service';
import { LoggingService } from '../logging/logging.service';

/**
 * @deprecated Use GlobalExceptionFilter from exceptions module instead
 * This filter is kept for backward compatibility
 */
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    @Optional() private sentryService?: SentryService,
    @Optional() private loggingService?: LoggingService,
  ) {}

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();
    const context = (request as any).context;

    const errorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: exception.message,
      ...(context &&
        typeof context === 'object' &&
        'correlationId' in context && {
          correlationId: context.correlationId,
        }),
    };

    // Log error
    if (this.loggingService) {
      this.loggingService.error(
        `${request.method} ${request.url}`,
        new Error(exception.message),
        context,
      );
    } else {
      console.error(
        `${request.method} ${request.url}`,
        JSON.stringify(errorResponse),
        'HttpExceptionFilter',
      );
    }

    // Capture in Sentry if status code is 5xx
    if (this.sentryService && status >= 500) {
      this.sentryService.captureException(exception, {
        url: request.url,
        method: request.method,
        statusCode: status,
        ...context,
      });
    }

    response.status(status).json(errorResponse);
  }
}
