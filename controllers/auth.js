const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const sendEmail = require('../utils/send-email');
const db = require('../utils/db.connection');
const Role = require('../utils/role');
const asyncHandler = require('../middlewares/async');
const ErrorResponse = require('../utils/errorResponse');

exports.authenticate = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  const { ipAddress } = req.ip;

  const user = await db.User.findOne({ email });

  if (!user || !user.isVerified || !bcrypt.compareSync(password, user.passwordHash)) {
    return next(new ErrorResponse('Invalid Credentials!', 401));
  }

  //authentcation successfull so generate jwt and refresh token
  const jwtToken = generateJwtToken(user);
  const refreshToken = generateRefreshToken(user, ipAddress);

  //save refresh token
  await refreshToken.save();

  //set refresh token as cookie
  setTokenCookie(res, refreshToken.token);

  //return basic user details and access token
  res.status(200).json({
    ...basicDetails(user),
    jwtToken
  })
});

exports.refreshToken = asyncHandler(async (req, res, next) => {
  const token = req.cookies.refreshToken;
  const ipAddress = req.ip;
  const refreshToken = await getRefreshToken(token);
  const { user } = refreshToken;

  if (!refreshToken || !refreshToken.isActive) {
    return next(new ErrorResponse('Invalid Token!', 400));
  }

  //replace old refresh token with the new one and save
  const newRefreshToken = generateRefreshToken(user, ipAddress);

  refreshToken.revoked = Date.now();
  refreshToken.revokeByIp = ipAddress;
  refreshToken.replacedByToken = newRefreshToken.token;

  await refreshToken.save();
  await newRefreshToken.save();

  //generate new accessToken
  const jwtToken = generateJwtToken(user);

  //set cookie as the new generated refreshtoken
  setTokenCookie(res, newRefreshToken.token);

  res.status(200).json({
    ...basicDetails(user),
    jwtToken
  })
});

exports.revokeToken = asyncHandler(async (req, res, next) => {
  const token = req.body.token || req.cookies.refreshToken;
  const ipAddress = req.ip;

  if (!token) {
    return next(new ErrorResponse('Token is required!', 400));
  }

  // users can revoke their own tokens and super admins can revoke any tokens
  if (!req.user.ownsToken(token) && req.user.role !== Role.SuperAdmin) {
    return next(new ErrorResponse('Unauthorized!', 401));
  }

  const refreshToken = await getRefreshToken(token);

  if (!refreshToken || !refreshToken.isActive) {
    return next(new ErrorResponse('Invalid Token!', 400));
  }

  //revoke and save
  refreshToken.revoked = Date.now(),
  refreshToken.revokeByIp = ipAddress;
  await refreshToken.save();

  res.status(200).json({
    success: true,
    message: 'Token revoked!'
  });
});

exports.register = asyncHandler(async (req, res, next) => {
  //validate
  if (await db.User.findOne({ email: req.body.email })) {
    await sendAlreadyRegisteredEmail(req.body.email, req.get('origin'));
    return next(new ErrorResponse('email already in use!', 400));
  }

  //create user account object
  const user = new db.User(req.body);

  user.verificationToken = randomTokenString();

  //hash password
  if (req.body.password) {
    user.passwordHash = hash(req.body.password);
  }

  //save account
  await user.save();

  //send email
  await sendVerificationEmail(user, req.get('origin'));

  res.status(201).json({
    success: true,
    message: 'Registration Succesful, please check your email for Verification instructions.'
  });
});

exports.verifyEmail = asyncHandler(async (req, res, next) => {
  
  const { token } = req.body;

  const user = await db.User.findOne({ verificationToken: token});

  if (!user) {
    return next(new ErrorResponse('Verification Failed!', 400));
  }

  user.verified = Date.now();
  user.verificationToken = undefined;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Verification successful, you can now login.'
  });

});

exports.forgotPassword = asyncHandler(async (req, res, next) => {
  const user = await db.User.findOne({ email: req.body.email });

  // alawys return ok response to prevent email enumeration
  // if (!user) {
  //   return;
  // }

  //return error if emails does not exist in user db
  if (!user) {
    return next(new ErrorResponse('email is not registered!', 400));
  }

  // create reset token that expires after 24hrs
  user.resetToken = {
    token: randomTokenString(),
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };

  await user.save();

  //send email
  await sendPasswordResetEmail(user, req.get('origin'));

  res.status(200).json({
    success: true,
    message: 'Please check your email for password reset instructions'
  });

});

exports.resetPassword = asyncHandler(async (req, res, next) => {

  const { token, password } = req.body;
  const user = await db.User.findOne({
    'resetToken.token': token,
    'resetToken.expires': { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorResponse('Invalid Token!', 400));
  }

  //update password and remove reset token
  user.passwordHash = hash(password);
  user.passwordReset = Date.now();
  user.resetToken = undefined;

  await user.save();

  res.status(200).json({
    success: true,
    message: 'Password reset successful, you can now login.'
  });

});

exports.validateResetToken = asyncHandler(async (req, res, next) => {

  const { token } = req.body;
  
  const user = await db.User.findOne({
    'resetToken.token': token,
    'resetToken.expires': { $gt: Date.now() },
  });

  if (!user) {
    return next(new ErrorResponse('Invalid Token!', 400));
  }

  res.status(200).json({
    success: true,
    message: 'Token is valid!'
  });

});

//helper functions

const setTokenCookie = (res, token) => {
  //create cookie with refresh token that expires in 7 days
  const cookieOptions = {
    httpOnly: true,
    expires: new Date(Date.now() + 7 + 24 * 60 * 60 * 1000),
  };

  res.cookie('refreshToken', token, cookieOptions);
}

const getRefreshToken = async (token) => {
  const refreshToken = await db.RefreshToken.findOne({ token }).populate(
    'user'
  );

  return refreshToken;
}

const hash = (password) => {
  return bcrypt.hashSync(password, 10);
}


const generateJwtToken = (user) => {
  // create a jwt token containing the user account id that expires in 15 mins
  return jwt.sign({ sub: user.id, id: user.id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRATION,
  });
}

const generateRefreshToken = (user, ipAddress) => {
  // create a refresh token that expires in 7 days
  return new db.RefreshToken({
    user: user.id,
    token: randomTokenString(),
    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdByIp: ipAddress,
  });
}

const randomTokenString = () => {
  return crypto.randomBytes(40).toString('hex');
}

const basicDetails = (user) => {
  const {
    id,
    firstName,
    lastName,
    email,
    contactNumber,
    shippingAddress,
    billingAddress,
    role,
    created,
    updated,
    isVerified,
    store,
  } = user;
  return {
    id,
    firstName,
    lastName,
    email,
    role,
    contactNumber,
    shippingAddress,
    billingAddress,
    created,
    updated,
    isVerified,
    store,
  };
}

const sendVerificationEmail = asyncHandler(async (user, origin) => {
  let message;
  if (origin) {
    const verifyUrl = `${origin}/users/verify-email?token=${user.verificationToken}`;
    message = `<p>Please click the below link to verify your email address:</p>
               <p><a href="${verifyUrl}">${verifyUrl}</a></p>
               <p>You can also enter this verification token:</p>
               <p><strong>${user.verificationToken}</strong></p>`;
  } else {
    message = `<p>Please use the below token to verify your email address with the <code>/user/verify-email</code> api route:</p>
               <p><code>${user.verificationToken}</code></p>`;
  }

  await sendEmail({
    to: user.email,
    subject: 'Tizko - Please Verify your Email',
    html: `<h4>Verify Email</h4>
           <p>Thanks for Signing up!</p>
           ${message}`,
  });
});

const sendAlreadyRegisteredEmail = asyncHandler(async(email, origin) => {
  let message;
  if (origin) {
    message = `<p>Someone is trying to Sign up using your email address.</p>
               <p>Please contact us IMMEDIETELY if this was NOT you.</p>`;
  } else {
    message = `<p>If you don't know your password you can reset it via the <code>/account/forgot-password</code> api route.</p>`;
  }

  await sendEmail({
    to: email,
    subject: `Tizko - Email Already Registered`,
    html: `<h4>Email Already Registered</h4>
           <p>Your email <strong>${email}</strong> is already registered.</p>
           ${message}`,
  });
});

const sendPasswordResetEmail = asyncHandler(async (user, origin) => {
  let message;
  if (origin) {
    const resetUrl = `${origin}/users/reset-password?token=${user.resetToken.token}`;
    message = `<p>Please click the below lin to reset your password, the link will be valid for 1 day:</p>
               <p><a href="${resetUrl}">${resetUrl}</a></p>`;
  } else {
    message = `<p>Please use the below token to reset your password with the <code>/users/reset-password</code> api route:</p>
               <p><code><strong>${user.resetToken.token}</strong></code></p>`;
  }

  await sendEmail({
    to: user.email,
    subject: 'Tizko - Reset Password',
    html: `<h4>Reset Password Email</h4>
           ${message}`,
  });
});

