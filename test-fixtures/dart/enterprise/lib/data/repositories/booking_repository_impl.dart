@injectable
class BookingRepositoryImpl implements BookingRepository {
  final BookingApi api;

  BookingRepositoryImpl(this.api);

  Future<List<dynamic>> getBookings() async {
    return api.getBookings();
  }
}
