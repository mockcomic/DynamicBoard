'use strict';

require('dotenv').config();

const express = require('express');
const app = express();
const routes = require('./routes/routes');
const bodyParser = require('body-parser');

const port = process.env.PORT;
app.use(express.static('public'));

app.use(bodyParser.json());

// routes
app.use('/', routes);

app.listen(port, () => {
	console.log(`Server is running on http://localhost:${port}`);
});
