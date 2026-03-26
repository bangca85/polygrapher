# System Map: autoroute-app

Generated: 2026-03-26T08:56:28.723Z
Languages: dart
Nodes: 6 | Edges: 4
Branch: main
Commit: `6fd8a9e` — "init project with go extract"

---

## Architecture Summary
| Metric | Count |
|--------|-------|
| Functions | 2 |
| HTTP Handlers | 0 |
| gRPC Endpoints | 0 |
| Workers | 0 |
| Structs | 0 |
| REST Routes | 2 |
| Call Relationships | 2 |

## Functions

### lib/ui/booking_page.dart

- **BookingPage** (lib/ui/booking_page.dart:2) — component
  `class BookingPage extends StatelessWidget`
- **BookingPage.build** (lib/ui/booking_page.dart:3) — function
  `Widget build(BuildContext context)`
- **ProfilePage** (lib/ui/booking_page.dart:9) — component
  `class ProfilePage extends StatelessWidget`
- **ProfilePage.build** (lib/ui/booking_page.dart:10) — function
  `Widget build(BuildContext context)`
- **/booking** (lib/ui/booking_page.dart:2) — route
  `@RoutePage() BookingPage`
- **/profile** (lib/ui/booking_page.dart:9) — route
  `@RoutePage() ProfilePage`

## Connections

- BookingPage -> BookingPage.build (calls)
- ProfilePage -> ProfilePage.build (calls)
- /booking -> BookingPage (routes-to) [path: /booking, widget: BookingPage]
- /profile -> ProfilePage (routes-to) [path: /profile, widget: ProfilePage]
