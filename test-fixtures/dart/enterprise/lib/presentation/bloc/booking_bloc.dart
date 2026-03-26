class BookingBloc extends Bloc<dynamic, dynamic> {
  final dynamic useCase;

  BookingBloc(this.useCase) : super(null);

  Future<void> loadBookings() async {
    final result = await useCase.execute('test');
  }
}
