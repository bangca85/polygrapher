final router = GoRouter(
  routes: [
    GoRoute(
      path: '/booking',
      builder: (context, state) => BookingPage(),
      routes: [
        GoRoute(
          path: 'detail/:id',
          builder: (context, state) => BookingDetailPage(),
        ),
      ],
    ),
    GoRoute(
      path: '/users/:id',
      builder: (context, state) => UserPage(),
    ),
  ],
);
