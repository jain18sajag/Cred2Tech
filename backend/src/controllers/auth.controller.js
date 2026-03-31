const authService = require('../services/auth.service');
const prisma = require('../../config/db');

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { user, token } = await authService.loginUser(email, password);

    res.json({ message: 'Login successful', user, token });
  } catch (error) {
    res.status(401).json({ error: error.message || 'Authentication failed' });
  }
}

async function getMe(req, res) {
  try {
    const userId = req.user.id;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, tenant: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password_hash, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
}

module.exports = {
  login,
  getMe,
};
