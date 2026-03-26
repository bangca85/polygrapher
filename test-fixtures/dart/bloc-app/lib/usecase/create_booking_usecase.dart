class CreateBookingUseCase {
  final dynamic repository;

  CreateBookingUseCase(this.repository);

  Future<String> execute(String name) async {
    return repository.createBooking(name, 1);
  }
}
