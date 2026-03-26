class ApiService {
  final dynamic dio;

  ApiService(this.dio);

  Future<void> getBooking() async {
    await dio.get('/api/booking');
  }

  Future<void> createUser() async {
    await dio.post('/api/users');
  }
}
