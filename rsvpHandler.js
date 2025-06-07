const _ = require('underscore');
const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const constants = require('./bk-utils/constants');
const rdsUsers = require('./bk-utils/rds/rds.users.helper');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsRsvps = require('./bk-utils/rds/rds.occasion.rsvps.helper');

const { OCCASION_CONFIG } = constants;

async function getRsvpList(request) {
  const { occasionId } = request.pathParameters;
  const include = _.get(request.queryStringParameters, 'include', '');
  logger.info('include', include);

  const rsvp = await rdsRsvps.getRsvpList(`occasion_${occasionId}`);
  if (include === 'users') {
    const uIds = rsvp.items.map((v) => v.userId).filter(Boolean);
    if (uIds.length > 0) {
      const miniProfiles = await rdsUsers.getUserFieldsIn(uIds, constants.MINI_PROFILE_FIELDS);
      rsvp.items = rsvp.items.map((item) => {
        if (!item.userId) return item;
        const user = miniProfiles.items.find((u) => u.id === item.userId);
        return { ...item, user };
      });
    }
  }

  rsvp.count = rsvp.items.length;
  return rsvp;
}


async function newOccasionRsvp(request) {
  const { occasionId } = request.pathParameters;
  logger.info(request);
  const obj = _.pick(request.body, ['rsvp', 'name', 'side', 'guests', 'accommodation']);
  const occasion = await rdsOccasions.getOccasion(occasionId);
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');

  logger.info('rsvp occasion request for ', occasionId);
  Object.assign(obj, { parentId: `occasion_${occasionId}` });
  await rdsRsvps.insertNewRsvp(obj);
  request.pathParameters.occasionId = occasionId;
  request.queryStringParameters = { include: 'users' };
  return getRsvpList(request);
}


async function getRsvpByUser(request) {
  const { decoded } = request;
  const { occasionId } = request.pathParameters;

  const rsvp = await rdsRsvps.getRsvpList(`occasion_${occasionId}`);
  const uRsvp = _.find(rsvp.items, (item) => item.userId === decoded.id);
  if (!uRsvp) errors.handleError(404, 'rsvp not found for user');
  return uRsvp;
}


async function newOrUpdateRsvp(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId } = pathParameters;

  const occasion = await rdsOccasions.getOccasion(occasionId);
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');
  const user = await rdsUsers.getUserById(decoded.id);
  if (_.isEmpty(user)) errors.handleError(404, 'user not found');
  if (user.status !== OCCASION_CONFIG.status.verified) errors.handleError(403, 'user not verified');

  const obj = _.pick(body, ['rsvp', 'side', 'guests', 'accommodation']);
  obj.userId = decoded.id;
  obj.name = decoded.name || decoded.username;
  obj.parentId = `occasion_${occasionId}`;
  await rdsRsvps.newOrUpdateRsvp(obj);
  request.pathParameters.occasionId = occasionId;
  return getRsvpByUser(request);
}


async function invoke(event, context, callback) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
  try {
    const request = access.validateRequest(event, context);

    let resp = {};
    switch (request.resourcePath) {
      case '/v1/{occasionId}/rsvp/web':
        resp = await newOccasionRsvp(request);
        break;

      case '/v1/{occasionId}/rsvp':
        switch (request.httpMethod) {
          case 'PUT': resp = await newOrUpdateRsvp(request);
            break;
          default: errors.handleError(400, 'invalid request path');
        }
        break;

      case '/v1/{occasionId}/rsvp/list':
        resp = await getRsvpList(request);
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
};
