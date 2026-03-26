import { createBrowserRouter } from 'react-router-dom';
import { Home } from './pages/Home';
import { About } from './pages/About';

function fetchUserData() {
  return fetch('/api/users');
}

function submitForm() {
  return fetch('/api/submit', { method: 'POST' });
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Home />,
    children: [
      {
        path: 'about',
        element: <About />,
      },
      {
        path: 'users',
        loader: fetchUserData,
        element: <div>Users</div>,
      },
      {
        path: 'contact',
        action: submitForm,
        element: <div>Contact</div>,
      },
      {
        path: 'settings',
        lazy: () => import('./pages/Settings'),
      },
    ],
  },
]);
