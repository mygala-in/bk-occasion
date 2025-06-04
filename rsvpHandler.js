const _ = require('underscore');
const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const constants = require('./bk-utils/constants');
const rdsUsers = require('./bk-utils/rds/rds.users.helper');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsRsvps = require('./bk-utils/rds/rds.occasion.rsvps.helper');


async function getRsvpList(request) {
  const { parentId } = request.pathParameters;
  const include = _.get(request.queryStringParameters, 'include', '');
  logger.info('include', include);

  const rsvp = await rdsRsvps.getRsvpList(parentId);
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

  const obj = _.pick(request.body, ['rsvp', 'name', 'side', 'guests', 'accomodation']);
  if (_.has(request, 'decoded')) {
    obj.userId = request.decoded.id;
    obj.name = request.decoded.name || request.decoded.username;
  }
  const occasion = await rdsOccasions.getOccasion(occasionId);
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');

  // if (occasion.isPublic === false) errors.handleError(401, 'requested occasion is private');
  logger.info('rsvp occasion request for ', occasionId);
  Object.assign(obj, { parentId: `occasion_${occasionId}` });
  await rdsRsvps.insertNewRsvp(obj);
  request.pathParameters.occasionId = occasionId;
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


async function updateRsvp(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId } = pathParameters;

  const occasion = await rdsOccasions.getOccasion(occasionId);

  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');
  const rsvp = await getRsvpByUser(request);
  if (_.isEmpty(rsvp)) errors.handleError(404, 'rsvp not found for user');

  const obj = _.pick(body, ['rsvp', 'name', 'side', 'guests', 'accomodation']);
  const parentId = `occasion_${occasionId}`;
  await rdsRsvps.updateRsvp(parentId, decoded.id, obj);
  request.pathParameters.occasionId = occasionId;
  return getRsvpByUser(request);
}


async function invoke(event, context, callback) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
  try {
    const request = access.validateRequest(event, context);

    let resp = {};
    switch (request.resourcePath) {
      case '/v1/{occasionId}/rsvp/app':
        resp = await newOccasionRsvp(request);
        break;

      case '/v1/{occasionId}/rsvp/web':
        resp = await newOccasionRsvp(request);
        break;

      case '/v1/{occasionId}/rsvp':
        switch (request.httpMethod) {
          case 'PUT': resp = await updateRsvp(request);
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
