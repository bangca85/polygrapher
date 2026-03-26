import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1' });

export const userApi = {
  getUsers: () => api.get('/users'),
  createUser: (data: any) => api.post('/users', data),
  deleteUser: (id: string) => fetch('/api/users/' + id),
};

export default userApi;
