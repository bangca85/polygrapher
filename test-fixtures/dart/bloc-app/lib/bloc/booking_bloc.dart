class BookingEvent {}
class LoadBookings extends BookingEvent {}

class BookingState {
  final List<String> bookings;
  BookingState({this.bookings = const []});
}

class BookingBloc extends Bloc<BookingEvent, BookingState> {
  final BookingRepository repository;

  BookingBloc(this.repository) : super(BookingState()) {
    on<LoadBookings>(_onLoadBookings);
  }

  Future<void> _onLoadBookings(LoadBookings event, Emitter<BookingState> emit) async {
    final bookings = await repository.getBookings();
    emit(BookingState(bookings: bookings));
  }
}
