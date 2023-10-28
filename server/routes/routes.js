const path = require('path');
const express = require('express');
const router = express.Router();

const {
	getAllMessages,
	updateMessage,
} = require('../controllers/messageControllers');

router
	.get('/api/', getAllMessages)
	.put('/api/', updateMessage)

router.get('/', (req, res) =>
	res.render(path.join(__dirname, '../public/index.html'))
);

module.exports = router;
