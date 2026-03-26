import { NextApiRequest, NextApiResponse } from 'next';

export default function getUserById(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  res.json({ id, name: 'User' });
}
