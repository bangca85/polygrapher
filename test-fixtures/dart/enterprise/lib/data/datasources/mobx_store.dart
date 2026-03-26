class BookingStore = _BookingStore with _$BookingStore;

abstract class _BookingStore with Store {
  @observable
  List<String> bookings = [];

  @action
  Future<void> loadBookings() async {
    bookings = ['Booking 1'];
  }

  @computed
  int get totalBookings => bookings.length;
}
