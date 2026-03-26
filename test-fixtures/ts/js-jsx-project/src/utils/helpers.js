const api = require('../services/api');

function formatDate(date) {
  return date.toISOString();
}

module.exports = { formatDate };
