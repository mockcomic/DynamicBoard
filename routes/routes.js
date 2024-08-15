const path = require('path');
const express = require('express');
const app = express();
const router = express.Router();
const {
	writeGridVestaBoard,
	writeTextVestaBoard,
	checkVariable,
} = require('../controllers/messageControllers');

const {
	getAllMessages,
	updateMessage,
} = require('../controllers/messageControllers');

app.use(express.json());

router.get('/api/', getAllMessages).put('/api/', updateMessage);

router.get('/', (req, res) =>
	res.render(path.join(__dirname, '../public/index.html'))
);

router.post('/api/send', (req, res) => {
	if (req.body.type == 'grid') {
		writeGridVestaBoard(JSON.parse(req.body.data));
	}
	if (req.body.type == 'text') {
		console.log('text', req.body);
		const msg = checkVariable(req.body.data);
		writeTextVestaBoard(msg);
	}

	res.send(req.body);
});

module.exports = router;
