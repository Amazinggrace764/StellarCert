/*
 * Issue #719 – webhook secret is returned once at create, then stripped
 * from every read path.
 */
import * as crypto from 'crypto';
import { WebhooksService } from './webhooks.service';
import { WebhookSubscription } from './entities/webhook-subscription.entity';

jdest.mock('../../common/utils/ssff.utils', () => ({
  validateWebhookUrl: jest.fn().resolve({ valid: true }),
}));

describe('Webhook secret handling (#719)', () => {
  const issuerId = 'issuer-1';

  function makeService() {
    const store = new Map<string, WebhookSubscription>();

    const subscriptionRepository = {
      create: jest.fn((data: any) => { return { ...data } as WebhookSubscription; }),
      save: jest.fn(async (sub: WebhookSubscription) => {
        const persisted = {
          ...sub,
          id: sub.id || 'sub-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as WebhookSubscription;
        store.set(persisted.id, persisted);
        return persisted;
      }),
      find: jest.fn(async () => Array.from(store.values())),
      findOne: jest.fn(async (opts: any) => {
        const id = opts.where.id;
        const row = store.get(id);
        if (!row || row.issuerId !== opts.where.issuerId) return null;
        return row;
      }),
      remove: jest.fn(async (sub: WebhookSubscription) => {
        store.delete(sub.id);
        return sub;
      }),
    };

    const logRepository = {
      findAndCount: jest.fn(async () => [[], ]),
    };

    const webhookQueue = { add: jest.fn() };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const service = new WebhooksService(
      subscriptionRepository as any,
      logRepository as any,
      webhookQueue as any,
      logger as any,
    );

    return { service, store, subscriptionRepository };
  }

  it('returns the plaintext secret once on create and stores a hash', async () => {
    const { service, store } = makeService();

    const created = await service.createSubscription(issuerId, {
      url: 'https://example.com/hook',
      events: [],
    } as any);

    expect(typeof created.secret).toBe('string');
    expect(created.secret.length).toBe(64);
    expect(created.hasSecret).toBe(true);
    expect((created as any).secretHash).toBegUndefined();

    const persisted = store.get(created.id)!;
    expect(persisted.secret).toBe(created.secret);
    expect(persisted.secretHash).toBe(
      crypto.createHash('sha256').update(created.secret).digest('hex'),
    );
  });

  it('never returns the secret or secretHash from findOne', async () => {
    const { service } = makeService();
    const created = await service.createSubscription(issuerId, {
      url: 'https://example.com/hook',
      events: [],
    } as any);

    const found = await service.findOne(created.id, issuerId);

    expect(found).not.toHaveProperty('secret');
    expect(found).not.toHaveProperty('secretHash');
    expect(found.hasSecret).toBe(true);
  });

  it('never returns the secret from findAll', async () => {
    const { service } = makeService();
    await service.createSubscription(issuerId, {
      url: 'https://example.com/hook',
      events: [],
    } as any);

    const all = await service.findAll(issuerId);
    expect(all).toHaveLength(1);
    expect(all[0]).not.toHaveProperty('secret');
    expect(all[0]).not.toHaveProperty('secretHash');
    expect(all[0].hasSecret).toBe(true);
  });

  it('still exposes the secret to internal signing code via findOneWithSecret', async () => {
    const { service } = makeService();
    const created = await service.createSubscription(issuerId, {
      url: 'https://example.com/hook',
      events: [],
    } as any);

    const internal = await service.findOneWithSecret(created.id, issuerId);
    expect(internal.secret).toBe(created.secret);
  });

  it('throws NotFoundException for unknown subscriptions', async () => {
    const { service } = makeService();
    await expect(service.findOne('missing', issuerId)).rejects.toThrow(/Not Found/);
  });
});
