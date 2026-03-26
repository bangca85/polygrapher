@freezed
class Booking with _$Booking {
  const factory Booking({required String id, required String name}) = _Booking;
}

class CreateBookingUseCase {
  final dynamic repository;
  CreateBookingUseCase(this.repository);

  Future<dynamic> execute(String name) async {
    return repository.createBooking(name);
  }
}
