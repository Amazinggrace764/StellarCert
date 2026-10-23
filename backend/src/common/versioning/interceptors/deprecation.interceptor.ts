import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Response } from 'express';

@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const deprecationMetadata = this.reflector.getAllAndOverride('deprecated', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!deprecationMetadata) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>();

        // Add deprecation headers
        response.setHeader('Deprecation', 'true');
        response.setHeader('X-API-Deprecated-Since', deprecationMetadata.since);

        if (deprecationMetadata.sunsetDate) {
          response.setHeader('Sunset', deprecationMetadata.sunsetDate);
        }

        if (deprecationMetadata.alternativeEndpoint) {
          response.setHeader(
            'Link',
            `<${deprecationMetadata.alternativeEndpoint}>; rel="alternate"`,
          );
        }

        response.setHeader(
          'X-API-Deprecation-Info',
          'This endpoint is deprecated. Please check the documentation for alternatives.',
        );
      }),
    );
  }
}
