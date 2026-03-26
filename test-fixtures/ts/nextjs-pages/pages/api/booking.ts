import { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const bookings = getBookings();
  res.json(bookings);
}

function getBookings() {
  return [{ id: 1, name: 'Test' }];
}
