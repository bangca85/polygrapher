@riverpod
BookingState booking(BookingRef ref) {
  final data = ref.read(apiServiceProvider);
  return BookingState();
}
