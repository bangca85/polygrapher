class BookingRepository {
  final String apiUrl;

  BookingRepository(this.apiUrl);

  Future<List<String>> getBookings() async {
    return ['Booking 1', 'Booking 2'];
  }

  Future<String> createBooking(String name, int guests) async {
    return 'Created: $name';
  }

  void _internalHelper() {
    // private — should NOT be extracted
  }
}
