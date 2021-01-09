require('rootpath')();
const path = require('path');
const dotenv = require('dotenv-safe').config();
const express = require('express');
const morgan = require('morgan');
const colors = require('colors');
const app = express();
const cors = require('cors');
// const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const errorHandler = require('./middlewares/error-handler');

// dotenv.config({ path: path.join(__dirname, `.env.${process.env.NODE_ENV}`)});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
// allow cors requests from any origin and with credentials
app.use(
  cors({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
  })
);

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

//api routes
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/users', require('./routes/users'));
app.use('/api/v1/products', require('./routes/products'));
app.use('/api/v1/stores', require('./routes/stores'));
app.use('/api/v1/orders', require('./routes/order'));

//swagger docs route
app.use('/api/v1/docs', require('./utils/swagger'));

//global error handler passed as a middleware
app.use(errorHandler);

module.exports = app;
