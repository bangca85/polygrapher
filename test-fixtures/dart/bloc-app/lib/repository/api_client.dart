class ApiClient {
  final dynamic dio;

  ApiClient(this.dio);

  Future<void> fetchBookings() async {
    await dio.get('/api/booking');
  }

  Future<void> createBooking(String name) async {
    await dio.post('/api/booking', data: {'name': name});
  }

  Future<void> updateBooking(String id) async {
    await dio.put('/api/booking/$id');
  }

  Future<void> deleteBooking() async {
    await dio.delete('/api/booking/123');
  }

  Future<void> patchBooking() async {
    await dio.patch('/api/booking/status');
  }

  Future<void> customRequest() async {
    await dio.request('/api/booking', options: Options(method: 'PATCH'));
  }

  Future<void> dynamicUrl(String url) async {
    await dio.get(url);
  }
}
