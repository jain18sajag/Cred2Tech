const userService = require('../services/user.service');

async function createUser(req, res) {
  try {
    const user = await userService.createUser(req.body, req.user);
    res.status(201).json({ message: 'User created successfully', user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
}

async function getUsers(req, res) {
  try {
    const users = await userService.getUsers(req.user);
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

async function getUserById(req, res) {
  try {
    const user = await userService.getUserById(req.params.id, req.user);
    res.json(user);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
}

async function updateUser(req, res) {
  // Stubbed update function
  res.status(501).json({ error: 'Not implemented fully yet' });
}

async function deleteUser(req, res) {
  // Stubbed delete function
  res.status(501).json({ error: 'Not implemented fully yet' });
}

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
};
