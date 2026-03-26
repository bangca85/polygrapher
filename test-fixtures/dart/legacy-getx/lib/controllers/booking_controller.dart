class BookingController extends GetxController {
  final bookings = <String>[].obs;

  Future<void> loadBookings() async {
    bookings.value = ['Booking 1', 'Booking 2'];
  }
}
