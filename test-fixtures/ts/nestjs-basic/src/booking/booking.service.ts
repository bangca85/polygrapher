import { Injectable } from '@nestjs/common';
import { BookingRepository } from './booking.repository';

@Injectable()
export class BookingService {
  constructor(private readonly bookingRepo: BookingRepository) {}

  findAll() {
    return [];
  }

  findOne(id: string) {
    return { id };
  }

  create(dto: any) {
    return dto;
  }

  update(id: string, dto: any) {
    return { id, ...dto };
  }

  remove(id: string) {
    return { id };
  }
}
