const _ = require('underscore');
const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const constants = require('./bk-utils/constants');
const common = require('./bk-utils/common');
// const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsOUsers = require('./bk-utils/rds/rds.occasion.users.helper');
const snsHelper = require('./bk-utils/sns.helper');
// const rdsUsers = require('./bk-utils/rds/rds.users.helper');
const rdsAssets = require('./bk-utils/rds/rds.assets.helper');
const rdsOEvents = require('./bk-utils/rds/rds.occasion.events.helper');
const helper = require('./helper');

const { APP_NOTIFICATIONS, OCCASION_CONFIG } = constants;

async function getOccasionEvent(request) {
  const { pathParameters, queryStringParameters } = request;
  const { occasionId, eventId } = pathParameters;
  let include = [];
  if (queryStringParameters && queryStringParameters.include) include = queryStringParameters.include.split(',');
  logger.info('get event request for ', { eventId, include });

  const event = await rdsOEvents.getEvent(eventId, occasionId);
  logger.info('event ', JSON.stringify(event));
  if (_.isEmpty(event)) errors.handleError(404, 'event not found');

  const extras = await helper.eventExtras(eventId, include);
  Object.assign(event, extras);
  return event;
}

async function createOccasionEvent(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId } = pathParameters;

  logger.info('new occasion event request');
  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (
    muObj.role < OCCASION_CONFIG.ROLES.admin.role
    || muObj.status !== OCCASION_CONFIG.status.verified
  ) errors.handleError(401, 'unauthorized');

  // * meObj - occasion event object
  const meObj = {
    creatorId: decoded.id,
    occasionId,
    name: body.name,
    fromTime: common.convertToDate(body.fromTime),
  };
  if (body.description) meObj.description = body.description;
  if (body.tillTime) meObj.tillTime = common.convertToDate(body.tillTime);
  // location is not being used in the code
  const { insertId } = await rdsOEvents.newEvent(meObj);

  const tasks = [];
  tasks.push(
    snsHelper.pushToSNS('fcm', {
      service: 'notification',
      component: 'notification',
      action: 'new',
      data: {
        id: `${insertId}`,
        type: 'default',
        title: 'New Event Added ✨',
        topic: common.getTopicName('occasion', occasionId),
        groupId: APP_NOTIFICATIONS.channels.occasion,
        subtitle: `${body.name ?? 'New'} event added by @${decoded.username}. Click to see details.`,
        payload: {
          screen: `/events/${insertId}`,
          params: { useCache: 'false', occasionId: `${occasionId}` },
        },
      },
    }),
  );
  tasks.push(
    snsHelper.pushToSNS('notification-bg-tasks', {
      service: 'notification',
      component: 'event',
      action: 'add',
      data: { occasionId, eventId: insertId },
    }),
  );
  await Promise.all(tasks);
  request.pathParameters = { eventId: insertId, occasionId };
  return getOccasionEvent(request);
}

async function getOccasionEvents(request) {
  const { decoded, pathParameters, queryStringParameters } = request;
  const { occasionId } = pathParameters;
  let include = [];
  if (queryStringParameters && queryStringParameters.include) include = queryStringParameters.include.split(',');
  logger.info('get occasion events request for ', { occasionId, include });

  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (muObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');

  const events = await rdsOEvents.getEvents(occasionId);
  logger.info('events ', JSON.stringify(events));

  const extras = await helper.eventsExtras(occasionId, events.items.map((e) => e.id), include);
  logger.info('extras ', JSON.stringify(extras));

  for (let i = 0; i < events.count; i += 1) {
    if (include.includes('location')) {
      [events.items[i].location] = extras.locations.items.filter((l) => l.parentId === `event_${events.items[i].id}`);
    }
    if (include.includes('assets')) {
      events.items[i].assets = { entity: 'collection', count: 0, items: [] };
      events.items[i].assets.items = extras.assets.items.filter(
        (asset) => asset.eventId === events.items[i].id,
      );
      events.items[i].assets.count = events.items[i].assets.items.length;
    }
  }
  return events;
}

async function updateOccasionEvent(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId, eventId } = pathParameters;

  logger.info('update occasion event request');
  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (
    muObj.role < OCCASION_CONFIG.ROLES.admin.role
    || muObj.status !== OCCASION_CONFIG.status.verified
  ) errors.handleError(401, 'unauthorized');

  const meObj = {};
  Object.assign(meObj, _.pick(body, 'name', 'locationId', 'photo', 'description', 'fromTime', 'tillTime'));
  if (meObj.fromTime) meObj.fromTime = common.convertToDate(body.fromTime);
  if (meObj.tillTime) meObj.tillTime = common.convertToDate(body.tillTime);

  await Promise.all([
    rdsOEvents.updateEvent(eventId, occasionId, meObj),
    snsHelper.pushToSNS('fcm', {
      service: 'notification',
      component: 'notification',
      action: 'new',
      data: {
        id: eventId,
        type: 'default',
        title: `${body.name ?? ''} Event details updated ✅`,
        topic: common.getTopicName('occasion', occasionId),
        groupId: APP_NOTIFICATIONS.channels.occasion,
        subtitle: `@${decoded.username} has updated event details. Tap view!`,
        payload: {
          screen: `/events/${eventId}`,
          params: { useCache: 'false', occasionId: `${occasionId}` },
        },
      },
    }),
  ]);
  if (body.fromTime) {
    await snsHelper.pushToSNS('notification-bg-tasks', { service: 'notification', component: 'event', action: 'edit', data: { occasionId, eventId } });
  }
  return getOccasionEvent(request);
}

async function deleteOccasionEvent(request) {
  const { decoded, pathParameters } = request;
  const { occasionId, eventId } = pathParameters;

  logger.info('delete occasion event request');
  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (
    muObj.role < OCCASION_CONFIG.ROLES.admin.role
    || muObj.status !== OCCASION_CONFIG.status.verified
  ) errors.handleError(401, 'unauthorized');

  await snsHelper.pushToSNS('occasion-bg-tasks', {
    service: 'occasion',
    component: 'event',
    action: 'delete',
    data: {
      occasionId: parseInt(occasionId, 10),
      eventId: parseInt(eventId, 10),
      userId: decoded.id,
    },
  });
  return { success: true };
}

async function getEventAssets(request) {
  const { decoded } = request;
  const { occasionId, eventId } = request.pathParameters;

  logger.info('get event images request for ', occasionId);
  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (muObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');

  return rdsAssets.getParentAssets(`event_${eventId}`);
}

async function invoke(event, context, callback) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': true,
  };
  try {
    const request = access.validateRequest(event, context);
    let resp = {};
    switch (request.resourcePath) {
      case '/v1/{occasionId}/event/new':
        resp = await createOccasionEvent(request);
        break;
      case '/v1/{occasionId}/event/list':
        resp = await getOccasionEvents(request);
        break;
      case '/v1/{occasionId}/event/{eventId}':
        switch (request.httpMethod) {
          case 'PUT':
            resp = await updateOccasionEvent(request);
            break;
          case 'DELETE':
            resp = await deleteOccasionEvent(request);
            break;
          case 'GET':
            resp = await getOccasionEvent(request);
            break;
          default:
            errors.handleError(400, 'invalid request method');
        }
        break;
      case '/v1/{occasionId}/event/{eventId}/assets':
        resp = await getEventAssets(request);
        break;

      default:
        errors.handleError(400, 'invalid request path');
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
