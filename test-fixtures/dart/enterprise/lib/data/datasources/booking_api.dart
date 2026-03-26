@RestApi(baseUrl: '/api/v1')
abstract class BookingApi {
  @GET('/bookings')
  Future<List<dynamic>> getBookings();

  @POST('/bookings')
  Future<dynamic> createBooking(@Body() dynamic dto);

  @GET('/bookings/{id}')
  Future<dynamic> getBooking(@Path('id') String id);
}
