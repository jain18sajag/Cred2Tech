const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Default route
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the platform APIs' });
});

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');

app.use('/auth', authRoutes);
app.use('/users', userRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

module.exports = app;
