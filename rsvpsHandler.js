const _ = require('underscore');
const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const rdsUsers = require('./bk-utils/rds/rds.users.helper');
const rdsRsvps = require('./bk-utils/rds/rds.occasion.rsvps.helper');
const rdsOUsers = require('./bk-utils/rds/rds.occasion.users.helper');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const redis = require('./bk-utils/redis.helper');
const { OCCASION_CONFIG, REDIS_CONFIG, MINI_PROFILE_FIELDS } = require('./bk-utils/constants');


async function validate(decoded, parentId) {
  logger.info('validating request');
  const [resource, ...entityIdx] = parentId.split('_');
  const entityId = entityIdx.join('_');
  logger.info('parent resource', resource);
  const entity = await rdsOccasions.getOccasion(entityId);
  if (_.isEmpty(entity)) errors.handleError(404, 'Occasion not found');
  if (!entity.isPublic) {
    const user = await rdsOUsers.getUser(entityId, decoded.id);
    if (_.isEmpty(user)) { errors.handleError(404, 'no association with requested occasion'); }
    if (user.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorised');
  }
}


async function getRsvpList(request) {
  const { parentId } = request.pathParameters;
  const include = _.get(request.queryStringParameters, 'include', '');
  const rsvpList = await rdsRsvps.getRsvpList(parentId);
  logger.info('rsvpList', rsvpList);
  if (include !== 'user') return rsvpList;
  const userIds = rsvpList.items.map((rsvp) => rsvp.userId);
  if (_.isEmpty(userIds)) return rsvpList;
  const extras = await rdsUsers.getUserFieldsIn(userIds, [MINI_PROFILE_FIELDS]);
  logger.info('extras', extras);
  const extrasMap = {};
  extras.items.forEach((item) => { extrasMap[item.id] = item; });
  rsvpList.items = rsvpList.items.map((item) => ({ ...item, user: extrasMap[item.userId] }));
  return rsvpList;
}


async function getRsvp(request) {
  const { decoded } = request;
  const { parentId } = request.pathParameters;
  logger.info('getRsvp request', { parentId, userId: decoded.id });
  await validate(decoded, parentId);
  const rsvp = await rdsRsvps.getRsvp(parentId, decoded.id);
  if (_.isEmpty(rsvp)) { errors.handleError(404, 'RSVP not found'); }
  return rsvp;
}


async function generateRsvp(parentId) {
  const rsvps = await getRsvpList({ pathParameters: { parentId } });
  let gCount = 0;
  rsvps.forEach((rsvp) => {
    if (rsvp.status === 'Y') gCount += 1;
  });
  const recentRsvps = await rdsOccasions.getRecentRsvps(parentId);
  const recentRsvpsUsers = await Promise.all(
    recentRsvps.map((rsvp) => rdsUsers.getUserFields(rsvp.userId, MINI_PROFILE_FIELDS)),
  );
  const obj = { gCount, users: recentRsvpsUsers, totalCount: rsvps.count - 5 };
  await redis.set(`${redis.transformKey(parentId)}_rsvp_summary`, JSON.stringify(obj), REDIS_CONFIG.rsvp);
  return { entity: 'rsvp', ...obj };
}


async function newOrUpdateRsvp(request) {
  const { decoded } = request;
  const { parentId } = request.pathParameters;
  const { status } = request.queryStringParameters;
  const obj = { parentId, userId: decoded.id, status };
  logger.info('newOrUpdateRsvp request', { obj });
  await validate(decoded, parentId);
  await rdsRsvps.newOrUpdateRsvp(obj);
  await generateRsvp(parentId);
  return getRsvp(request);
}


async function deleteRsvp(request) {
  const { decoded, pathParameters } = request;
  const { parentId } = pathParameters;
  logger.info('deleteRsvp request', { parentId, userId: decoded.id });
  const rsvp = await rdsRsvps.getRsvp(parentId, decoded.id);
  if (_.isEmpty(rsvp)) errors.handleError(404, 'no association with requested rsvp');
  await rdsRsvps.deleteRsvp(parentId, decoded.id);
  return { success: true };
}


async function invoke(event, context, callback) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
  try {
    const request = access.validateRequest(event, context);

    let resp = {};
    switch (request.resourcePath) {
      case '/v1/rsvp/{parentId}':
        switch (request.httpMethod) {
          case 'GET': resp = await getRsvp(request);
            break;

          case 'PUT': resp = await newOrUpdateRsvp(request);
            break;

          case 'DELETE': resp = await deleteRsvp(request);
            break;

          default: errors.handleError(400, 'invalid request path');
        }
        break;

      case '/v1/rsvp/{parentId}/list':
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
  generateRsvp,
};
