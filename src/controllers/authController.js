import { signupUser, loginUser, fetchAllUsers, removeUser } from '../services/authService.js';

export const signup = async (req, res, next) => {
  try {
    const result = await signupUser(req.body);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const result = await loginUser(req.body);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const logout = (req, res) => {
  res.status(200).json({ message: 'Logged out successfully' });
};

export const getAllUsers = async (req, res, next) => {
  try {
    const users = await fetchAllUsers();
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req, res, next) => {
  try {
    await removeUser(req.user.id);
    res.status(204).json({ message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};
