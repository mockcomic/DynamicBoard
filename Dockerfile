FROM node:18
WORKDIR /user/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 4000
CMD [ "node", "server.js" ]