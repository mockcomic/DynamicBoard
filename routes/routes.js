const express = require('express');
const fs = require('fs');
const router = express.Router();

const {
	writeGridVestaBoard,
	writeTextVestaBoard,
	checkVariable,
} = require('../controllers/messageControllers');

router.get('/api', async (req, res) => {
	fs.readFile('config.json', (err, data) => {
		if (err) return res.status(400).end();
		res.status(200).json(JSON.parse(data));
	});
});

router.put('/api', (req, res) => {
	const msg = JSON.stringify(req.body);
	fs.writeFile('config.json', msg, err => {
		if (err) return res.status(400).json('Error updating JSON');
		res.status(200).json('JSON data is saved.');
	});
});

router.get('/', (req, res) => {
	res.render('index');
});

router.post('/api/send', (req, res) => {
	console.log(req.body);
	if (req.body.type === 'grid') {
		writeGridVestaBoard(JSON.parse(req.body.data));
	} else if (req.body.type === 'text') {
		const msg = checkVariable(req.body.data);
		writeTextVestaBoard(msg);
	}
	res.send(req.body);
});

module.exports = router;
