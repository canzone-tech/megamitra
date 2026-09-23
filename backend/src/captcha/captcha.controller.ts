import { Controller, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { CaptchaService } from './captcha.service';

@Controller('captcha')
export class CaptchaController {
  constructor(private readonly captcha: CaptchaService) {}

  @Public()
  @Post('challenge')
  createChallenge() {
    return this.captcha.createChallenge();
  }
}
