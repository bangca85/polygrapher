final bookingProvider = StateNotifierProvider<BookingNotifier, List<String>>((ref) {
  final api = ref.watch(apiServiceProvider);
  return BookingNotifier(api);
});

final apiServiceProvider = Provider<ApiService>((ref) {
  return ApiService();
});

final configProvider = Provider<String>((ref) => 'production');
