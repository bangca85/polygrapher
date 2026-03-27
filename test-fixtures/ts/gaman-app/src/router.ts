export default composeRouter((r) => {
  r.get('/', [AppController, 'HelloWorld']);
  r.get('/users/:id', [AppController, 'GetUser']);
  r.post('/items', [AppController, 'CreateItem']);
  r.get('/ping', (ctx) => { return ctx.send('pong'); });
  r.group('v1', (v1) => {
    v1.get('/hello', (ctx) => ctx.send({ msg: 'Hello' }));
    v1.post('/data', (ctx) => ctx.send({ data: true }));
  });
});
