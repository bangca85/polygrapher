import { Module } from '@nestjs/common';
import { BookingModule } from './booking/booking.module';
import { UserModule } from './users/users.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({ imports: [BookingModule, UserModule], controllers: [AppController], providers: [AppService] })
export class AppModule {}
