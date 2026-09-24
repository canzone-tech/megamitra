import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_CMS,
  DEFAULT_TEMPLATE,
  DEFAULT_THEME,
  checksum,
  validatePresentationContent,
} from './presentation-schema';

describe('presentation schema', () => {
  it('accepts the compiled safe defaults with deterministic checksums', () => {
    expect(validatePresentationContent('THEME', DEFAULT_THEME)).toEqual(DEFAULT_THEME);
    expect(validatePresentationContent('TEMPLATE', DEFAULT_TEMPLATE)).toEqual(DEFAULT_TEMPLATE);
    expect(validatePresentationContent('CMS', DEFAULT_CMS)).toEqual(DEFAULT_CMS);
    expect(checksum(DEFAULT_THEME)).toHaveLength(64);
    expect(checksum({ ...DEFAULT_THEME })).toBe(checksum(DEFAULT_THEME));
  });

  it('rejects inaccessible palette combinations and unknown raw styling keys', () => {
    expect(() =>
      validatePresentationContent('THEME', {
        ...DEFAULT_THEME,
        pageBackground: '#FFFFFF',
        textColor: '#FFFFFF',
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validatePresentationContent('TEMPLATE', {
        ...DEFAULT_TEMPLATE,
        rawCss: 'body { display:none }',
      }),
    ).toThrow(BadRequestException);
  });
});
