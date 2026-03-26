@dao
abstract class BookingDao {
  @Query('SELECT * FROM bookings')
  Future<List<BookingEntity>> getBookings();

  @insert
  Future<void> insertBooking(BookingEntity booking);
}

@Entity()
class BookingEntity {
  final int id;
  final String name;
  BookingEntity({required this.id, required this.name});
}
