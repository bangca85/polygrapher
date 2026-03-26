class BookingPage extends StatelessWidget {
  Widget build(BuildContext context) {
    final bloc = BlocProvider.of(context);
    return Container();
  }
}

class BookingForm extends StatefulWidget {
  State<BookingForm> createState() => _BookingFormState();
}

class _BookingFormState extends State<BookingForm> {
  Widget build(BuildContext context) {
    return TextField();
  }
}

class BookingCard extends HookWidget {
  Widget build(BuildContext context) {
    return Card();
  }
}

class BookingHelper {
  String format(String name) => name.toUpperCase();
}
