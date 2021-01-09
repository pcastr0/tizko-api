// const config = require('../config/db.config');
const mongoose = require('mongoose');

const {
  MONGO_USERNAME,
  MONGO_PASSWORD,
  MONGO_HOSTNAME,
  MONGO_PORT,
  DB_NAME
} = process.env;

const connectionOptions = {
  useCreateIndex: true,
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useFindAndModify: false,
  // reconnectTries: Number.MAX_VALUE,
  // reconnectInterval: 500,
  // connectTimeoutMS: 10000,
};


// const url = `mongodb+srv://${MONGO_USERNAME}:${MONGO_PASSWORD}@${MONGO_HOSTNAME}/${DB_NAME}?retryWrites=true&w=majority`;
const url = `mongodb://${MONGO_USERNAME}:${MONGO_PASSWORD}@${MONGO_HOSTNAME}:${MONGO_PORT}/${DB_NAME}?authSource=admin`;
// const url = `mongodb://127.0.0.1:27017/tizko-dev`;

mongoose
  .connect(url, connectionOptions)
  .then(function () {
    console.log(`MongoDB is connected!`.yellow.bold);
  })
  .catch(function (err) {
    console.log(err);
  });
// mongoose.Promise = global.Promise;

module.exports = {
  User: require('../models/User'),
  RefreshToken: require('../models/Refresh-Token'),
  Product: require('../models/Product'),
  Store: require('../models/Store'),
  Order: require('../models/order'),
  isValidId,
};

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}
