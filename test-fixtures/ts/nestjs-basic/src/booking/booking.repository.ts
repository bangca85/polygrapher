import { Injectable } from '@nestjs/common';

@Injectable()
export class BookingRepository {
  find() {
    return [];
  }

  findById(id: string) {
    return { id };
  }
}
