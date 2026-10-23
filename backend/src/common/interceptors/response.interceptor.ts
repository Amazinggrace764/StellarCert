import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Request, Response as ExpressResponse } from 'express';

export interface ApiResponse<T> {
  statusCode: number;
  message: string;
  data?: T;
  timestamp: string;
  path: string;
  correlationId?: string;
}

interface RequestWithContext extends Request {
  context?: {
    correlationId?: string;
  };
}

/**
 * Response Interceptor
 * Standardizes API response format for all successful responses
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const response = context.switchToHttp().getResponse<ExpressResponse>();
    const { url } = request;
    const context_obj = request.context;

    return next.handle().pipe(
      map((data) => ({
        statusCode: response.statusCode || 200,
        message: this.getStatusMessage(response.statusCode || 200),
        data,
        timestamp: new Date().toISOString(),
        path: url,
        ...(context_obj?.correlationId && {
          correlationId: context_obj.correlationId,
        }),
      })),
    );
  }

  private getStatusMessage(statusCode: number): string {
    const messages: Record<number, string> = {
      200: 'Request successful',
      201: 'Resource created successfully',
      204: 'No content',
      400: 'Bad request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not found',
      500: 'Internal server error',
    };
    return messages[statusCode] || 'Request successful';
  }
}
