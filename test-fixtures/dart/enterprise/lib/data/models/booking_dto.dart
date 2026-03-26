@JsonSerializable()
class BookingDto {
  final String id;
  final String name;

  BookingDto({required this.id, required this.name});

  factory BookingDto.fromJson(Map<String, dynamic> json) => BookingDto(id: json['id'], name: json['name']);
  Map<String, dynamic> toJson() => {'id': id, 'name': name};
}
