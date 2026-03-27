import { Controller, Get, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { LoggingInterceptor } from '../logging/logging.interceptor';
import { BookingService } from './booking.service';

@Controller('booking')
@UseGuards(AuthGuard)
export class BookingController {
  constructor(private readonly service: BookingService) {}

  @Get()
  @UseInterceptors(LoggingInterceptor)
  findAll() { return []; }

  @Get(':id')
  findOne(@Param('id') id: string) { return { id }; }
}
