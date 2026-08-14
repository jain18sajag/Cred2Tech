const userService = require('../services/user.service');
const { sendCaughtError } = require('../utils/sendError');

async function createUser(req, res) {
  try {
    const user = await userService.createUser(req.body, req.user);
    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) {
    sendCaughtError(res, error, 'Failed to create user');
  }
}

async function getUsers(req, res) {
  try {
    const users = await userService.getUsers(req.user);
    res.json(users);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to fetch users', 500);
  }
}

async function getUserById(req, res) {
  try {
    const user = await userService.getUserById(req.params.id, req.user);
    res.json(user);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to fetch user', 404);
  }
}

async function updateUser(req, res) {
  try {
    const user = await userService.updateUser(req.params.id, req.body, req.user);
    res.json(user);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to update user');
  }
}

async function deleteUser(req, res) {
  try {
    await userService.deleteUser(req.params.id, req.user);
    res.status(204).send();
  } catch (error) {
    sendCaughtError(res, error, 'Failed to delete user');
  }
}

async function getMe(req, res) {
  try {
    const user = await userService.getMe(req.user);
    res.json(user);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to fetch current user', 404);
  }
}

async function getTeam(req, res) {
  try {
    const users = await userService.getUsers(req.user);
    res.json(users);
  } catch (error) {
    sendCaughtError(res, error, 'Failed to fetch team', 500);
  }
}

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  getMe,
  getTeam
};
