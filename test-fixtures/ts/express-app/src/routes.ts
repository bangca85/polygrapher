import express from 'express';
import { getUsers, createUser } from './controllers/userController';

const router = express.Router();

router.get('/users', getUsers);
router.post('/users', createUser);
router.get('/users/:id', (req, res) => { res.json({ id: req.params.id }); });
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);

export default router;
