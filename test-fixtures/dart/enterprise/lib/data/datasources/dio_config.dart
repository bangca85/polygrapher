class DioConfig {
  static dynamic create() {
    final dio = Dio(BaseOptions(baseUrl: 'https://api.example.com/v1'));
    dio.interceptors.add(AuthInterceptor());
    dio.interceptors.add(LoggingInterceptor());
    return dio;
  }
}

class DioConfig2 {
  static dynamic create() {
    final dio = Dio();
    dio.options.baseUrl = '/api/v2';
    return dio;
  }
}
