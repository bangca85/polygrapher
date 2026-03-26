class BookingModel {
  final String name;
  final int guests;

  BookingModel({required this.name, required this.guests});

  Map<String, dynamic> toJson() {
    return {'name': name, 'guests': guests};
  }
}
