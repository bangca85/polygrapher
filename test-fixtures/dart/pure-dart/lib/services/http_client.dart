class HttpClient {
  Future<void> getBookings() async {
    await http.get(Uri.parse('https://api.example.com/booking'));
  }

  Future<void> createUser() async {
    await http.post(Uri.parse('https://api.example.com/api/users'));
  }
}
