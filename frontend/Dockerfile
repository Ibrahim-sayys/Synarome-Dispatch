FROM node:24

WORKDIR /app

COPY package*.json ./

RUN npm install -g npm@11.19.0

RUN npm install

COPY . .

EXPOSE 4200

CMD ["npm", "start", "--", "--host", "0.0.0.0", "--poll", "2000"]
