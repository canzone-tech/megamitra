import { BadRequestException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { MemberPaymentService } from './member-payment.service';
import { UpdatePaymentSettingsDto, SubmitInstallmentPaymentDto } from './member-payment.dto';

const validQr = (base64Length: number) => 'data:image/jpeg;base64,' + 'A'.repeat(base64Length);

function createService() {
  const query = jest.fn().mockResolvedValue([{
    id: 1, upiId: 'uat@upi', payeeName: 'UAT',
    qrImageDataUrl: validQr(150_000), instructions: 'UAT only', enabled: true,
  }]);
  const transaction = jest.fn(async (callback: (connection: { query: typeof query }) => Promise<unknown>) =>
    callback({ query }),
  );
  const execute = jest.fn().mockResolvedValue(undefined);
  const log = jest.fn().mockResolvedValue(undefined);
  const service = new MemberPaymentService(
    { $queryRawUnsafe: query } as never, { execute, transaction } as never, {} as never,
    {} as never, { log } as never,
  );
  return { service, query, execute, log };
}

describe('Super Admin payment QR upload contract', () => {
  it('accepts a roughly 111KB JPEG base64 QR without truncation or compressing financial proof limits', async () => {
    const { service, execute, log } = createService();
    const qr = validQr(150_000);
    const settings = await service.updatePaymentSettings({
      upiId: 'uat@upi', payeeName: 'UAT',
      qrImageDataUrl: qr, enabled: true,
    }, 'super-admin-1');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1][2]).toBe(qr);
    expect(settings.qrImageDataUrl).toBe(qr);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized QR or unsupported image types before writing settings', async () => {
    const { service, execute } = createService();
    await expect(service.updatePaymentSettings({
      enabled: true, qrImageDataUrl: validQr(320_000),
    }, 'super-admin-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updatePaymentSettings({
      enabled: true, qrImageDataUrl: 'data:image/svg+xml;base64,AAA',
    }, 'super-admin-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('validates different limits for QR settings and payment proof screenshots', () => {
    const settings = Object.assign(new UpdatePaymentSettingsDto(), {
      enabled: true, qrImageDataUrl: validQr(150_000),
    });
    expect(validateSync(settings)).toEqual([]);
    const proof = Object.assign(new SubmitInstallmentPaymentDto(), {
      amount: '1000.00', utr: 'UTR12345', paymentProofDataUrl: validQr(150_000),
    });
    expect(validateSync(proof).some((error) => error.property === 'paymentProofDataUrl')).toBe(true);
  });
});
