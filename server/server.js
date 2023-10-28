'use strict';

require('dotenv').config();

const express = require('express');
const app = express();
const routes = require('./routes/routes');
const bodyParser = require('body-parser');
const cors = require('cors');

app.use(express.static('public'));

app.use(
	bodyParser.urlencoded({
		extended: true,
	}),
	cors({
		origin: '*',
	})
);

app.use(bodyParser.json());

app.use((req, res, next) => {
	console.log(req.path, req.method);
	next();
});

// routes
app.use('/', routes);

app.listen(process.env.PORT, () =>
	console.log(`Server started at http://localhost:${process.env.PORT}`)
);
