const userService = require('../services/user.service');

async function createUser(req, res) {
  try {
    const user = await userService.createUser(req.body, req.user);
    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function getUsers(req, res) {
  try {
    const users = await userService.getUsers(req.user);
    res.json(users);
  } catch (error) {
    res.status(error.status || 500).json({ error: 'Failed to fetch users' });
  }
}

async function getUserById(req, res) {
  try {
    const user = await userService.getUserById(req.params.id, req.user);
    res.json(user);
  } catch (error) {
    res.status(error.status || 404).json({ error: error.message });
  }
}

async function updateUser(req, res) {
  try {
    const user = await userService.updateUser(req.params.id, req.body, req.user);
    res.json(user);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function deleteUser(req, res) {
  try {
    await userService.deleteUser(req.params.id, req.user);
    res.status(204).send();
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message });
  }
}

async function getMe(req, res) {
  try {
    const user = await userService.getMe(req.user);
    res.json(user);
  } catch (error) {
    res.status(error.status || 404).json({ error: error.message });
  }
}

async function getTeam(req, res) {
  try {
    const users = await userService.getUsers(req.user);
    res.json(users);
  } catch (error) {
    res.status(error.status || 500).json({ error: 'Failed to fetch team' });
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
