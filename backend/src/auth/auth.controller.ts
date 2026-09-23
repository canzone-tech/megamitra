import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { AuthUser } from './auth-user';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  @Post('logout')
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
