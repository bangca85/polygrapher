import { WebSocketGateway, SubscribeMessage } from '@nestjs/websockets';

@WebSocketGateway(3001, { namespace: 'events' })
export class EventsGateway {
  @SubscribeMessage('booking.created')
  handleBookingCreated(client: any, payload: any) { return payload; }

  @SubscribeMessage('booking.updated')
  handleBookingUpdated(client: any, payload: any) { return payload; }
}
