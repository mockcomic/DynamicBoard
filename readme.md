# Dynamic VestaBoard

## Video Demo

https://github.com/mockcomic/DynamicBoard/assets/1287667/3df06ce9-a22e-4fae-8dfe-7bc9935d1821

## Description

Dynamic VestaBoard allows you to send messages to your Vestaboard at timed intervals, enhancing communication efficiency.

## Available Functions

All functions must be rapped with `{12,25,2023}`. For example, `Christams is in {tillDate()}!`

- tillDate(dd,nn,yyyy)
  - Returns how many days till date specified
  - Will count up after passing the date
- date()
  - Returns the current date

## Installation Instructions

1. **Clone the Repository**: Clone the package repository and navigate to the server directory:

- `git clone [repository-link]`
- `cd server`

2. **Environment Setup**: Create a `.env` file in the `server` directory with the necessary keys:

- `PORT` - The port number for your server.
- `key`, `secret`, `subId` - These are Vestaboard specific credentials. Obtain them from the [Vestaboard Development Website](https://docs.vestaboard.com/methods).

3. **Install Dependencies and Run the Server**:
   npm install
   npm start

4. **Access the Application**: Open your web browser and connect to `http://localhost:4000`.

## To Do

-[ ] Clean up PWA icon -[ ] Fix PWA caching -[ ] Add more functions -[ ] Clean up frontend -[ ] Fix known time delay -[ ] Add event list that will automatically add/remove messages to the list withing a set amount of days EX: Birthdays
