import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { LoggingService } from '../../../common/logging/logging.service';

@Injectable()
export class CorsMiddleware implements NestMiddleware {
  private readonly allowedOrigins: string[];

  constructor(
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
  ) {
    const allowed =
      this.configService.get<string>('ALLOWED_ORIGINS') ||
      'http://localhost:5173';

    this.allowedOrigins = allowed
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;

    if (!origin || this.isAllowed(origin)) {
      res.setHeader('Vary', 'Origin');
      next();
      return;
    }

    this.loggingService.warn('Blocked request due to CORS policy', {
      origin,
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
    });

    res.status(403).json({
      statusCode: 403,
      message: 'Origin is not allowed by CORS policy',
    });
  }

  private isAllowed(origin: string): boolean {
    return (
      this.allowedOrigins.includes('*') || this.allowedOrigins.includes(origin)
    );
  }
}
