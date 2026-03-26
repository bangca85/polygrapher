final bookingProvider = StateNotifierProvider<BookingNotifier, List<String>>((ref) {
  final api = ref.watch(apiProvider);
  return BookingNotifier(api);
});
