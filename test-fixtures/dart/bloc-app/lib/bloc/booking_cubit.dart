class BookingCubit extends Cubit<BookingState> {
  final BookingRepository repository;

  BookingCubit(this.repository) : super(BookingState());

  Future<void> loadBookings() async {
    final bookings = await repository.getBookings();
    emit(BookingState(bookings: bookings));
  }

  Future<void> refreshBookings() async {
    final bookings = await repository.getBookings();
    emit(BookingState(bookings: bookings));
  }
}
