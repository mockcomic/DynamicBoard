# Dynamic VestaBoard
#### Video Demo  
<https://youtu.be/jgEpNnlIW8o>
#### Description 
Send messages to your Vestboard on a timed interval.
#### How to install:
1. Clone the package and `cd server`

2. Create an `.env` file in `/server` directory with the following keys: `PORT`, `key`, `secret`, `subId`. <br> You can obtain your `key`, `secret` and `subId` by visiting Vestaboard's development website(<https://docs.vestaboard.com/methods>).

2. Run `npm install`, then `npm start`

3. Launch web browser and connect to `http://localhost:4000`.

#### TODO
- Allow for template literal strings.
- Delayed messages.
- Seperate messages array.
- Clean up frontend.
