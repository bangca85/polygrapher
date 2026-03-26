# System Map: enterprise

Generated: 2026-03-26T10:27:49.928Z
Languages: dart
Nodes: 17 | Edges: 16
Branch: main
Commit: `6fd8a9e` — "init project with go extract"

---

## Tech Stack

### Language & Runtime
- Package: `enterprise_app`
- **Dart/Flutter** (from pubspec.yaml)
- **BLoC** state management

### Dependencies
| Package | Version | Category |
|---------|---------|----------|
| flutter_bloc | ^8.1.0 | State Management (BLoC) |
| get_it | ^7.6.0 | Dependency Injection (GetIt) |
| injectable | ^2.3.0 | Dependency Injection (Injectable) |
| retrofit | ^4.0.0 | API Client (Retrofit) |
| dio | ^5.0.0 | HTTP Client (Dio) |
| freezed_annotation | ^2.4.0 | Code Generation (Freezed) |
| json_annotation | ^4.9.0 | Code Generation (JsonSerializable) |
| auto_route | ^7.8.0 | Routing (AutoRoute) |
| floor | ^1.4.0 | Database (Floor) |

## Architecture Summary
| Metric | Count |
|--------|-------|
| Functions | 5 |
| HTTP Handlers | 3 |
| Services | 5 |
| BLoC/Cubit | 1 |
| Models | 3 |
| Call Relationships | 16 |

### Detected Patterns
- Database: Database (Floor)
- BLoC/Cubit: **1** state managers
- Services: **5** (Repository, Provider, UseCase, etc.)

---

## Functions

### lib/data/datasources/booking_api.dart

- **BookingApi** (lib/data/datasources/booking_api.dart:2) — service
  `class BookingApi`
- **GET /api/v1/bookings** (lib/data/datasources/booking_api.dart:4) — handler
  `@GET('/api/v1/bookings')`
- **POST /api/v1/bookings** (lib/data/datasources/booking_api.dart:7) — handler
  `@POST('/api/v1/bookings')`
- **GET /api/v1/bookings/:id** (lib/data/datasources/booking_api.dart:10) — handler
  `@GET('/api/v1/bookings/:id')`

### lib/data/datasources/booking_dao.dart

- **BookingDao** (lib/data/datasources/booking_dao.dart:2) — service
  `class BookingDao`
- **BookingEntity** (lib/data/datasources/booking_dao.dart:11) — model
  `class BookingEntity`

### lib/data/datasources/dio_config.dart

- **dio_config** (lib/data/datasources/dio_config.dart:1) — function
  `lib/data/datasources/dio_config.dart`

### lib/data/datasources/mobx_store.dart

- **BookingStore** (lib/data/datasources/mobx_store.dart:3) — service
  `class BookingStore`
- **BookingStore.loadBookings** (lib/data/datasources/mobx_store.dart:8) — function
  `Future<void> loadBookings()`

### lib/data/models/booking_dto.dart

- **BookingDto** (lib/data/models/booking_dto.dart:2) — model
  `class BookingDto`

### lib/data/repositories/booking_repository_impl.dart

- **BookingRepositoryImpl** (lib/data/repositories/booking_repository_impl.dart:2) — service
  `class BookingRepositoryImpl`
- **BookingRepositoryImpl.getBookings** (lib/data/repositories/booking_repository_impl.dart:7) — function
  `Future<List<dynamic>> getBookings()`

### lib/domain/usecases/create_booking.dart

- **Booking** (lib/domain/usecases/create_booking.dart:2) — model
  `class Booking`
- **CreateBookingUseCase** (lib/domain/usecases/create_booking.dart:6) — service
  `class CreateBookingUseCase`
- **CreateBookingUseCase.execute** (lib/domain/usecases/create_booking.dart:10) — function
  `Future<dynamic> execute(String name)`

### lib/presentation/bloc/booking_bloc.dart

- **BookingBloc** (lib/presentation/bloc/booking_bloc.dart:1) — bloc
  `class BookingBloc extends Bloc`
- **BookingBloc.loadBookings** (lib/presentation/bloc/booking_bloc.dart:6) — function
  `Future<void> loadBookings()`

## Connections

- BookingApi -> GET /api/v1/bookings (calls)
- GET /api/v1/bookings -> /api/v1/bookings (calls) [method: GET, path: /api/v1/bookings]
- BookingApi -> POST /api/v1/bookings (calls)
- POST /api/v1/bookings -> /api/v1/bookings (calls) [method: POST, path: /api/v1/bookings]
- BookingApi -> GET /api/v1/bookings/:id (calls)
- GET /api/v1/bookings/:id -> /api/v1/bookings/:id (calls) [method: GET, path: /api/v1/bookings/:id]
- BookingDao -> BookingEntity (calls) [relationship: dao-entity]
- BookingDao -> BookingEntity (calls) [relationship: dao-entity]
- dio_config -> AuthInterceptor (calls) [interceptor: AuthInterceptor]
- dio_config -> LoggingInterceptor (calls) [interceptor: LoggingInterceptor]
- BookingStore -> BookingStore.loadBookings (calls)
- BookingStore -> bookings.length (calls) [receiver: bookings, method: length]
- BookingRepositoryImpl -> BookingRepositoryImpl.getBookings (calls)
- CreateBookingUseCase -> CreateBookingUseCase.execute (calls)
- BookingBloc -> BookingBloc.loadBookings (calls)
- BookingBloc -> CreateBookingUseCase.execute (calls) [receiver: useCase, method: execute]
