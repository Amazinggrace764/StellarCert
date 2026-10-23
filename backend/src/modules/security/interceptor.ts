import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class SecurityHeadersInterceptor implements NestInterceptor {
  constructor(private readonly configService: ConfigService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse();

    response.removeHeader('X-Powered-By');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=()',
    );
    response.setHeader('Content-Security-Policy', this.contentSecurityPolicy());

    if (this.shouldSetHsts(request)) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    }

    return next.handle();
  }

  private contentSecurityPolicy(): string {
    const configured = this.configService.get<string>('SECURITY_CSP');
    if (configured?.trim()) {
      return configured;
    }

    return [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "font-src 'self' data:",
      'upgrade-insecure-requests',
    ].join('; ');
  }

  private shouldSetHsts(request: Request): boolean {
    const forceHsts = this.configService.get<string>('SECURITY_FORCE_HSTS');
    if (forceHsts === 'true') {
      return true;
    }

    return request.headers['x-forwarded-proto'] === 'https';
  }
}
