class CalculatorService {
  int add(int a, int b) => a + b;
  int subtract(int a, int b) => a - b;
}

void main() {
  final calc = CalculatorService();
  print(calc.add(2, 3));
}
