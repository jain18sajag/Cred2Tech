const LEVELS = {
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4
};

function getVisibleLevels(level) {
  if (!level) {
    return ['L1', 'L2', 'L3', 'L4'];
  }

  const current = LEVELS[level];

  return Object.keys(LEVELS).filter(
    l => LEVELS[l] >= current
  );
}

function isValidManager(employeeLevel, managerLevel) {
  if (!employeeLevel || !managerLevel) return true; // root or admin
  return LEVELS[managerLevel] < LEVELS[employeeLevel];
}

module.exports = { getVisibleLevels, isValidManager, LEVELS };
