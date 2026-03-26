void initializeApp() {
  print('Initializing...');
}

String formatBooking(String name, int guests) {
  return '$name ($guests guests)';
}

void _privateHelper() {
  // should NOT be extracted
}
