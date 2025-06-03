const _ = require('underscore');
const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const constants = require('./bk-utils/constants');
const rdsUsers = require('./bk-utils/rds/rds.users.helper');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsRsvps = require('./bk-utils/rds/rds.occasion.rsvps.helper');
const jwtHelper = require('./bk-utils/jwt.helper');


async function getRsvpList(request) {
  const { occasionId } = request.pathParameters;
  const include = _.get(request.queryStringParameters, 'include', '');
  logger.info('include', include);
  const rsvp = await rdsRsvps.getRsvpList(`occasion_${occasionId}`);
  if (include === 'users') {
    rsvp.items = await Promise.all(rsvp.items.map(async (item) => {
      if (item.userId) {
        const user = await rdsUsers.getUserFields(item.userId, constants.MINI_PROFILE_FIELDS);
        return { ...item, user };
      }
      return item;
    }));
  }
  rsvp.count = rsvp.items.length;
  return rsvp;
}


async function newOccasionRsvp(request) {
  const { Authorization } = request.headers;
  if (Authorization) request.decoded = jwtHelper.verifyToken(Authorization, process.env.jwtSecretKey);
  const { occasionId } = request.pathParameters;

  const obj = _.pick(request.body, ['rsvp', 'name', 'side', 'guests', 'accomodation']);
  if (request.decoded) {
    obj.userId = request.decoded.id;
    obj.name = request.decoded.username;
  }
  const occasion = await rdsOccasions.getOccasion(occasionId);
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');

  if (occasion.isPublic === false) errors.handleError(401, 'requested occasion is private');
  logger.info('rsvp occasion request for ', occasionId);
  Object.assign(obj, { parentId: `occasion_${occasionId}` });
  await rdsRsvps.insertNewRsvp(obj);
  request.pathParameters.occasionId = occasionId;
  return getRsvpList(request);
}


async function getRsvpByUser(request) {
  const { decoded } = request;
  const { occasionId, userId } = request.pathParameters;
  if (decoded.id !== parseInt(userId, 10)) errors.handleError(401, 'unauthorized');

  const rsvp = await rdsRsvps.getRsvpList(`occasion_${occasionId}`);
  const uRsvp = _.find(rsvp.items, (item) => item.userId === parseInt(userId, 10));
  if (!uRsvp) errors.handleError(404, 'rsvp not found for user');
  return uRsvp;
}


async function updateRsvp(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId, userId } = pathParameters;
  logger.info(decoded);

  if (decoded.id !== parseInt(userId, 10)) errors.handleError(401, 'unauthorized');
  logger.info(decoded.id, userId);
  const occasion = await rdsOccasions.getOccasion(occasionId);
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');
  const rsvp = await getRsvpByUser(request);
  if (_.isEmpty(rsvp)) errors.handleError(404, 'rsvp not found for user');

  const obj = _.pick(body, ['rsvp', 'name', 'side', 'guests', 'accomodation']);
  const parentId = `occasion_${occasionId}`;
  await rdsRsvps.updateRsvp(parentId, userId, obj);
  request.pathParameters.occasionId = occasionId;
  return getRsvpByUser(request);
}


async function getRsvpSummary(request) {
  const { occasionId } = request.pathParameters;
  const resp = { entity: 'rsvp', count: 0, users: [] };

  const rsvp = await rdsRsvps.getRsvpList(`occasion_${occasionId}`);
  logger.info('rsvp', rsvp);
  const yUsers = _.filter(rsvp.items, (user) => user.rsvp === 'Y');
  logger.info('yUsers', yUsers);

  if (_.isEmpty(yUsers)) return resp;
  const recentRsvp = _.first(yUsers, 5);
  logger.info('recent rsvp', recentRsvp);
  const recentRsvps = await Promise.all(recentRsvp.map(async (item) => {
    if (item.userId) {
      const user = await rdsUsers.getUserFields(item.userId, constants.MINI_PROFILE_FIELDS);
      return { ...item, user };
    }
    return item;
  }));
  resp.count = _.reduce(yUsers, (sum, user) => sum + (user.guests || 0), 0) + yUsers.length;
  resp.users = recentRsvps;
  return resp;
}


async function invoke(event, context, callback) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
  try {
    const request = access.validateRequest(event, context);

    let resp = {};
    switch (request.resourcePath) {
      case '/v1/{occasionId}/rsvp':
        resp = await newOccasionRsvp(request);
        break;

      case '/v1/{occasionId}/rsvp/{userId}':
        switch (request.httpMethod) {
          case 'GET': resp = await getRsvpByUser(request);
            break;
          case 'PUT': resp = await updateRsvp(request);
            break;
          default: errors.handleError(400, 'invalid request path');
        }
        break;

      case '/v1/{occasionId}/rsvp/list':
        resp = await getRsvpList(request);
        break;

      case '/v1/{occasionId}/rsvp/summary':
        resp = await getRsvpSummary(request);
        break;

      default: errors.handleError(400, 'invalid request path');
    }

    context.callbackWaitsForEmptyEventLoop = false;
    logger.info('final response ', JSON.stringify(resp));
    return callback(null, { statusCode: 200, headers, body: JSON.stringify(resp) });
  } catch (err) {
    context.callbackWaitsForEmptyEventLoop = false;
    logger.error('error processing api');
    logger.error(err);
    return callback(null, { headers, ...err });
  }
}


module.exports = {
  invoke,
  getRsvpSummary,
};
