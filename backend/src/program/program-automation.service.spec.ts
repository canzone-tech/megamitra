import { ProgramBusinessEventType } from '../generated/prisma/enums';
import { ProgramAutomationService } from './program-automation.service';

describe('ProgramAutomationService', () => {
  it('consumes ready referral hooks and settles affected binary uplines automatically', async () => {
    const prisma = {
      programBusinessEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'event-1',
          type: ProgramBusinessEventType.PAYMENT_CONFIRMED,
          occurredAt: new Date('2026-10-06T12:00:00.000Z'),
          enrollment: { userId: 'member-1' },
        }),
      },
      binaryQualifyingUnitEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'unit-event-1',
            planVersionId: 'plan-1',
            uplineUnits: [{ ancestorUserId: 'root-1' }],
          },
        ]),
      },
    };
    const orchestration = {
      processEvent: jest.fn().mockResolvedValue({
        run: {
          status: 'PROCESSED',
          binaryLinks: [{ qualifyingUnitEventId: 'unit-event-1' }],
          referralHooks: [{ id: 'hook-1', status: 'READY' }],
        },
        idempotent: false,
      }),
    };
    const referralConsumer = {
      consumeHook: jest.fn().mockResolvedValue({ hook: { id: 'hook-1', status: 'CONSUMED' } }),
      reconcileRefundEvent: jest.fn(),
    };
    const settlements = {
      runIfPairReady: jest.fn().mockResolvedValue({
        settlement: { id: 'settlement-1' },
        skipped: false,
      }),
    };

    const service = new ProgramAutomationService(
      prisma as never,
      orchestration as never,
      referralConsumer as never,
      settlements as never,
    );

    const result = await service.processEvent('event-1');

    expect(orchestration.processEvent).toHaveBeenCalledWith('event-1', 'member-1');
    expect(referralConsumer.consumeHook).toHaveBeenCalledWith('hook-1', 'member-1');
    expect(settlements.runIfPairReady).toHaveBeenCalledWith(
      {
        sourceKey: 'AUTO_BINARY:event-1:root-1:plan-1',
        memberUserId: 'root-1',
        planVersionId: 'plan-1',
        settledAt: '2026-10-06T12:00:00.000Z',
      },
      'member-1',
    );
    expect(result.referrals).toHaveLength(1);
    expect(result.settlements).toHaveLength(1);
  });

  it('reconciles referral effects automatically for confirmed refunds', async () => {
    const prisma = {
      programBusinessEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'refund-event',
          type: ProgramBusinessEventType.REFUND_CONFIRMED,
          occurredAt: new Date('2026-10-06T13:00:00.000Z'),
          enrollment: { userId: 'member-2' },
        }),
      },
      binaryQualifyingUnitEvent: { findMany: jest.fn() },
    };
    const orchestration = {
      processEvent: jest.fn().mockResolvedValue({
        run: { status: 'SKIPPED', binaryLinks: [], referralHooks: [] },
        idempotent: false,
      }),
    };
    const referralConsumer = {
      consumeHook: jest.fn(),
      reconcileRefundEvent: jest.fn().mockResolvedValue({
        evaluation: { id: 'evaluation-1', status: 'POSTED' },
      }),
    };
    const settlements = { runIfPairReady: jest.fn() };

    const service = new ProgramAutomationService(
      prisma as never,
      orchestration as never,
      referralConsumer as never,
      settlements as never,
    );

    const result = await service.processEvent('refund-event');

    expect(referralConsumer.reconcileRefundEvent).toHaveBeenCalledWith(
      'refund-event',
      'member-2',
    );
    expect(result.refund).toEqual({
      evaluation: { id: 'evaluation-1', status: 'POSTED' },
    });
    expect(settlements.runIfPairReady).not.toHaveBeenCalled();
  });
});
