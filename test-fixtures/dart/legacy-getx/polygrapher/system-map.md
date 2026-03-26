# System Map: legacy-getx

Generated: 2026-03-26T10:27:55.068Z
Languages: dart
Nodes: 5 | Edges: 4
Branch: main
Commit: `6fd8a9e` — "init project with go extract"

---

## Tech Stack

### Language & Runtime
- Package: `legacy_getx_app`
- **Dart/Flutter** (from pubspec.yaml)

### Dependencies
| Package | Version | Category |
|---------|---------|----------|
| get | ^4.6.0 | State Management (GetX) |
| dio | ^5.0.0 | HTTP Client (Dio) |

## Architecture Summary
| Metric | Count |
|--------|-------|
| Functions | 3 |
| Components | 1 |
| Services | 1 |
| Call Relationships | 4 |

### Detected Patterns
- Components/Widgets: **1**
- Services: **1** (Repository, Provider, UseCase, etc.)

---

## Functions

### lib/bindings/booking_binding.dart

- **booking_binding** (lib/bindings/booking_binding.dart:1) — function
  `lib/bindings/booking_binding.dart`

### lib/controllers/booking_controller.dart

- **BookingController** (lib/controllers/booking_controller.dart:1) — service
  `class BookingController extends GetxController`
- **BookingController.loadBookings** (lib/controllers/booking_controller.dart:4) — function
  `Future<void> loadBookings()`

### lib/views/booking_view.dart

- **BookingView** (lib/views/booking_view.dart:1) — component
  `class BookingView extends StatelessWidget`
- **BookingView.build** (lib/views/booking_view.dart:2) — function
  `Widget build(BuildContext context)`

## Connections

- booking_binding -> BookingController (calls) [diAction: register, controller: BookingController]
- BookingController -> BookingController.loadBookings (calls)
- BookingView -> BookingView.build (calls)
- BookingView.build -> BookingController (calls) [diAction: lookup, controller: BookingController]
