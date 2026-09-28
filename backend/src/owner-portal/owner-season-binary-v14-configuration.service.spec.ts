import { BadRequestException } from '@nestjs/common';
import type { OwnerSeasonAdvancedConfigDto } from './owner-season-configuration.dto';
import { OwnerSeasonConfigurationService } from './owner-season-configuration.service';
import { OwnerSeasonBinaryV14ConfigurationService } from './owner-season-binary-v14-configuration.service';

describe('OwnerSeasonBinaryV14ConfigurationService', () => {
  function service() {
    return new OwnerSeasonBinaryV14ConfigurationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['2.0000', '1.0000'],
    ['1.0000', '2.0000'],
    ['2.0000', '2.0000'],
  ])('rejects generic binary ratios %s:%s outside the locked 1:4 lane contract', async (left, right) => {
    const subject = service();
    const dto = {
      leftVolumePerPair: left,
      rightVolumePerPair: right,
    } as OwnerSeasonAdvancedConfigDto;

    await expect(subject.updateAdvancedConfiguration('season-1', dto, 'actor-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('always exposes the authoritative A/B/C/D topology and fixed pair lanes', async () => {
    jest
      .spyOn(OwnerSeasonConfigurationService.prototype, 'getAdvancedConfiguration')
      .mockResolvedValue({ season: { id: 'season-1' }, binary: {} } as never);

    const result = await service().getAdvancedConfiguration('season-1');

    expect(result).toMatchObject({
      season: { id: 'season-1' },
      binaryTopology: {
        model: '1:4',
        slots: {
          A: 'LEFT',
          B: 'LEFT',
          C: 'RIGHT',
          D: 'RIGHT',
        },
        pairLanes: [
          ['A', 'C'],
          ['B', 'D'],
        ],
        genericCrossPairingAllowed: false,
      },
    });
  });
});
