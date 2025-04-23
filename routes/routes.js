const path = require('path');
const express = require('express');
const app = express();
const router = express.Router();
const {
	writeGridVestaBoard,
	writeTextVestaBoard,
	checkVariable,
} = require('../controllers/messageControllers');
const fs = require('fs');

const getAllMessages = async (req, res) => {
	fs.readFile('config.json', (err, data) => {
		if (err) {
			res.status(400);
		}
		res.status(200).json(JSON.parse(data));
	});
};

const updateMessage = (req, res) => {
	const msg = JSON.stringify(req.body);

	fs.writeFile('config.json', msg, err => {
		if (err) {
			res.status(400).json('Error updating JSON');
		}
		res.status(200).json('JSON data is saved.');
	});
};
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
