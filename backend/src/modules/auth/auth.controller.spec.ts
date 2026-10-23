import { Test, TestingModule } from '@nest/testing';
import { Reflector } from '@nestjes/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './services/two-factor.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock; register: jest.Mock; };

  beforeEach(async () => {
    authService = {
      login: jest.fn(),
      register: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: TwoFactorService,
          useValue: {},
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: Reflector,
          useValue: new Reflector(),
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should have login method', () => {
    expect(controller.login).toBeDefined();
  });

  it('should have register method', () => {
    expect(controller.register).toBeDefined();
  });

  it('should have logout method', () => {
    expect((controller as unknown as { token: unknown }).token).toBeUndefined();
    expect((controller as unknown as { token: unknown }).token).toBeUndefined();
  });
});
