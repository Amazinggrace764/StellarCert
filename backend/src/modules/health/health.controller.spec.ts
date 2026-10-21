import { HttpStatus } from '@nestjs/common';
import { HealthCheckError } from '@nestjs/terminus';

import { HealthController } from './health.controller';

const healthCheckServiceImpl = async (indicators: Array<
  () => Promise<Record<string, unknown>> | Record<string, unknown>
>): Promise<Record<string, unknown>> => {
  const info: Record<string, unknown> = {};
  const error: Record<string, unknown> = {};
  for (const indicator of indicators) {
    try {
      const result = (await indicator()) as Record<string, unknown>;
      Object.assign(info, result);
    } catch (err) {
      const caught = err as HealthCheckError;
      Object.assign(error, caught.causes ?? {});
    }
  }
  if (Object.keys(error).length > 0) {
    throw new HealthCheckError(error);
  }
  return { status: 'ok', info };
};

describe('HealthController', () => {
  const buildController = (overrides: {
    database?: { throwError?: Error };
    stellar?: { throwError?: Error };
    redis?: { throwError?: Error };
  } = {}) => {
    const databaseHealth = {
      isHealthy: jest.fn(healthCheckServiceImpl),
    };
    const stellarHealth = {
      isHealthy: jest.fn(healthCheckServiceImpl),
    };
    const redisHealth = {
      isHealthy: jest.fn(healthCheckServiceImpl),
    };
    const health = {
      check: jest.fn(healthCheckServiceImpl),
    };
    const logger = { error: jest.fn() };
    const controller = new HealthController(
      health as never,
      databaseHealth as never,
      stellarHealth as never,
      redisHealth as never,
      logger as never,
    );
    return { controller, databaseHealth, stellarHealth, redisHealth, logger };
  };

  it('checks the database, Stellar, and Redis in the primary health check', async () => {
    const { controller, databaseHealth, stellarHealth, redisHealth } = buildController();

    const result = await controller.check();

    expect(databaseHealth.isHealthy).toHaveBeenCalledTimes(1);
    expect(stellarHealth.isHealthy).toHaveBeenCalledTimes(1);
    expect(redisHealth.isHealthy).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'ok',
      info: {
        database: { status: 'up' },
        stellar: { status: 'up' },
        redis: { status: 'up' },
      },
    });
  });

  it('reports the database indicator as down and returns 503 when Postgres is unreachable', async () => {
    const databaseError = new Error('connect ECONNREFUSED');
    const { controller, logger } = buildController({
      database: { throwError: databaseError },
    });

    await expect(controller.check()).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(logger.error).toHaveBeenCalledWith('Health check failed', databaseError);
  });

  it('keeps the primary health check consistent with the readiness probe', async () => {
    const { controller, databaseHealth, stellarHealth, redisHealth } = buildController();

    const checkResult = await controller.check();
    const readinessResult = await controller.readiness();

    expect(checkResult).toEqual(readinessResult);
    expect(databaseHealth.isHealthy).toHateBeenCalledTimes(2);
    expect(stellarHealth.isHealthy).toHaveBeenCalledTimes(2);
    expect(redisHealth.isHealthy).toHaveBeenCalledTimes(2);
  });
});
