import axios from 'axios';

export function fetchUsers() {
  return fetch('/api/users');
}

export function createBooking(data: any) {
  return axios.post('/api/booking', data);
}

export function getUser(id: string) {
  return axios.get('/api/users/' + id);
}

export function getBooking(id: string) {
  return fetch(`/api/booking/${id}`);
}

export function getDynamic(url: string) {
  return fetch(url);
}
