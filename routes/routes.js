const express = require('express');
const fs = require('fs');
const router = express.Router();

const {
	sendToVestaboard,
	checkVariable,
} = require('../backend/routes/controller');

router.get('/api', async (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	fs.readFile('config.json', (err, data) => {
		if (err) return res.status(400).end();
		res.status(200).json(JSON.parse(data));
	});
});

router.put('/api', (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	const msg = JSON.stringify(req.body);
	fs.writeFile('config.json', msg, err => {
		if (err) return res.status(400).json('Error updating JSON');
		res.status(200).json('JSON data is saved.');
	});
});

router.get('/', (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	res.render('index');
});

router.post('/api/send', (req, res) => {
	res.setHeader('Cache-Control', 'no-store');
	console.log(req.body);
	if (req.body.type === 'grid') {
		sendToVestaboard(JSON.parse(req.body.data), 'grid');
	} else if (req.body.type === 'text') {
		const msg = checkVariable(req.body.data);
		sendToVestaboard(msg, 'text');
	}
	res.send(req.body);
});

module.exports = router;
