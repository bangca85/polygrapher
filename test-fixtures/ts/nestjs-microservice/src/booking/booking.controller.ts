import { Controller } from '@nestjs/common';
import { MessagePattern, EventPattern } from '@nestjs/microservices';

@Controller()
export class BookingController {
  @MessagePattern({ cmd: 'get_booking' })
  getBooking(data: any) { return data; }

  @EventPattern('booking_created')
  handleBookingCreated(data: any) { console.log(data); }
}
