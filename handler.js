const _ = require('underscore');
const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const constants = require('./bk-utils/constants');
const common = require('./bk-utils/common');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsOUsers = require('./bk-utils/rds/rds.occasion.users.helper');
const snsHelper = require('./bk-utils/sns.helper');
const rdsUsers = require('./bk-utils/rds/rds.users.helper');
const rdsAssets = require('./bk-utils/rds/rds.assets.helper');
const rdsOEvents = require('./bk-utils/rds/rds.occasion.events.helper');
const helper = require('./helper');
const redis = require('./bk-utils/redis.helper');

const { APP_NOTIFICATIONS, OCCASION_CONFIG } = constants;


async function getOccasion(request) {
  const { decoded, pathParameters, queryStringParameters } = request;
  const { occasionId } = pathParameters;
  let include = [];
  if (queryStringParameters && queryStringParameters.include) include = queryStringParameters.include.split(',');

  logger.info('get occasion request for ', { occasionId, include });
  const occasion = await rdsOccasions.getOccasion(occasionId);
  logger.info('occasion ', JSON.stringify(occasion));
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');
  const gbIds = []; // groom & bride Ids
  if (_.has(occasion.extras, 'brideId')) {
    if (!gbIds.includes(occasion.extras.brideId)) gbIds.push(occasion.extras.brideId);
  }
  if (_.has(occasion.extras, 'groomId')) {
    if (!gbIds.includes(occasion.extras.groomId)) gbIds.push(occasion.extras.groomId);
    logger.info('groom & bride ids ', JSON.stringify(gbIds));
  }

  if (decoded) {
    const muObj = await rdsOUsers.getUser(occasion.id, decoded.id);
    logger.info('requested user ', muObj);
    occasion.ouser = muObj;
  }
  const [ouCounts, extras, gbUsers] = await Promise.all([
    rdsOUsers.getOUsersCounts(occasion.id),
    helper.occasionExtras(occasion.id, include),
    rdsUsers.getUserFieldsIn(gbIds, [...constants.MINI_PROFILE_FIELDS, 'facebook', 'instagram', 'createdAt', 'updatedAt']),
  ]);

  if (_.has(occasion.extras, 'brideId')) {
    [occasion.extras.bride] = gbUsers.items.filter((item) => item.id === occasion.extras.brideId);
  }
  if (_.has(occasion.extras, 'groomId')) {
    [occasion.extras.groom] = gbUsers.items.filter((item) => item.id === occasion.extras.groomId);
  }

  logger.info('ou counts ', JSON.stringify(ouCounts));
  occasion.counts = ouCounts;
  logger.info('extras ', JSON.stringify(extras));
  Object.assign(occasion, { ...extras });
  return occasion;
}


async function getOccasionByCode(request) {
  const { pathParameters, queryStringParameters } = request;
  const { occasionId } = pathParameters;
  let include = [];
  if (queryStringParameters && queryStringParameters.include) include = queryStringParameters.include.split(',');

  logger.info('get occasion request for ', { occasionId, include });
  const occasion = await rdsOccasions.getOccasionByCode(occasionId);
  logger.info('occasion ', JSON.stringify(occasion));
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');
  const gbIds = []; // groom & bride Ids
  if (_.has(occasion.extras, 'brideId')) {
    if (!gbIds.includes(occasion.extras.brideId)) gbIds.push(occasion.extras.brideId);
  }
  if (_.has(occasion.extras, 'groomId')) {
    if (!gbIds.includes(occasion.extras.groomId)) gbIds.push(occasion.extras.groomId);
    logger.info('groom & bride ids ', JSON.stringify(gbIds));
  }

  const muObj = await rdsOUsers.getUser(occasion.id, occasion.creatorId);
  logger.info('requested user ', muObj);
  occasion.ouser = muObj;

  const uObj = await rdsUsers.getUserFieldsIn(occasion.creatorId, constants.MINI_PROFILE_FIELDS);
  logger.info('requested user ', muObj);
  occasion.user = uObj;

  const [ouCounts, extras, gbUsers] = await Promise.all([
    rdsOUsers.getOUsersCounts(occasion.id),
    helper.occasionExtras(occasion.id, include),
    rdsUsers.getUserFieldsIn(gbIds, [...constants.MINI_PROFILE_FIELDS, 'facebook', 'instagram', 'createdAt', 'updatedAt']),
  ]);

  if (_.has(occasion.extras, 'brideId')) {
    [occasion.extras.bride] = gbUsers.items.filter((item) => item.id === occasion.extras.brideId);
  }
  if (_.has(occasion.extras, 'groomId')) {
    [occasion.extras.groom] = gbUsers.items.filter((item) => item.id === occasion.extras.groomId);
  }

  logger.info('ou counts ', JSON.stringify(ouCounts));
  occasion.counts = ouCounts;
  logger.info('extras ', JSON.stringify(extras));
  Object.assign(occasion, { ...extras });
  return occasion;
}


async function getOccasions(request) {
  const { decoded } = request;
  const { type } = request.queryStringParameters;
  logger.info({ type });
  const mJoins = await rdsOUsers.getOccasions(decoded.id);
  const oIds = mJoins.items.map((i) => i.occasionId);
  logger.info('occasion ids ', oIds);
  const vIds = mJoins.items.filter((i) => i.status === OCCASION_CONFIG.status.verified).map((i) => i.occasionId);
  logger.info('verified occasion ids ', vIds);
  if (type === 'occasions') {
    const gbIds = []; // groom & bride Ids
    const [occasions, ouCounts] = await Promise.all([rdsOccasions.getOccasionsIn(oIds), rdsOUsers.getOUsersCountsIn(oIds)]);
    logger.info('occasions ', JSON.stringify(occasions));
    logger.info('ou counts ', JSON.stringify(ouCounts));
    for (let i = 0; i < occasions.count; i += 1) {
      const occasion = occasions.items[i];
      [occasion.ouser] = mJoins.items.filter((item) => item.occasionId === occasion.id);
      if (_.has(occasion.extras, 'brideId')) {
        if (occasion.extras.brideId && !gbIds.includes(occasion.extras.brideId)) gbIds.push(occasion.extras.brideId);
      }
      if (_.has(occasion.extras, 'groomId')) {
        if (occasion.extras.groomId && !gbIds.includes(occasion.extras.groomId)) gbIds.push(occasion.extras.groomId);
      }
      const [ouc] = ouCounts.items.filter((item) => item.occasionId === occasion.id);
      occasion.counts = ouc;
      occasions.items[i] = occasion;
    }
    logger.info('groom & bride ids ', JSON.stringify(gbIds));
    const gbUsers = await rdsUsers.getUserFieldsIn(gbIds, [...constants.MINI_PROFILE_FIELDS, 'facebook', 'instagram', 'createdAt', 'updatedAt']);
    logger.info('gbUsers ', JSON.stringify(gbUsers));
    for (let i = 0; i < occasions.count; i += 1) {
      if (_.has(occasions.items[i].extras, 'brideId')) [occasions.items[i].extras.bride] = gbUsers.items.filter((item) => item.id === occasions.items[i].extras.brideId);
      if (_.has(occasions.items[i].extras, 'groomId')) [occasions.items[i].extras.groom] = gbUsers.items.filter((item) => item.id === occasions.items[i].extras.groomId);
    }
    return occasions;
  }

  if (type === 'events') return rdsOEvents.getEventsIn(oIds);
  if (type === 'assets') return rdsAssets.getParentAssetsIn(oIds.map((i) => `occasion_${i}`));
  if (type === 'users') {
    const oUsers = await rdsOUsers.getOUsersIn(vIds);
    const userIds = oUsers.items.map((user) => user.userId);
    const miniProfiles = await rdsUsers.getUserFieldsIn(userIds, constants.MINI_PROFILE_FIELDS);
    for (let i = 0; i < oUsers.count; i += 1) {
      [oUsers.items[i].user] = miniProfiles.items.filter((item) => item.id === oUsers.items[i].userId);
    }
    return oUsers;
  }
  return errors.handleError(400, 'invalid request type');
}


async function createNewOccasion(request) {
  const { body, decoded } = request;
  logger.info('new occasion request');

  let isCodeExists = true;
  let code = common.genCode();
  while (isCodeExists) {
    code = common.genCode();
    // eslint-disable-next-line no-await-in-loop
    const occasion = await rdsOccasions.getOccasion(code);
    isCodeExists = occasion != null && occasion.entity === 'occasion';
    logger.info('occasion code exists check ', { code, isCodeExists });
  }

  // * mObj - occasion object
  const mObj = { creatorId: decoded.id, code };
  Object.assign(mObj, _.pick(body, ['title', 'note', 'type', 'fromTime', 'tillTime', 'isPublic', 'extras', 'url', 'locationId']));
  if (mObj.fromTime) mObj.fromTime = common.convertToDate(mObj.fromTime);
  if (mObj.tillTime) mObj.tillTime = common.convertToDate(mObj.tillTime);

  logger.info('new occasion object ', mObj);
  const { insertId } = await rdsOccasions.newOccasion(mObj);

  // * muObj - occasion user object
  const muObj = { userId: decoded.id, occasionId: insertId, role: OCCASION_CONFIG.ROLES.admin.role, status: OCCASION_CONFIG.status.verified, verifierId: decoded.id };
  if (body.side) muObj.side = body.side;
  await Promise.all([
    rdsOUsers.newUser(muObj),
    snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'chat', action: 'new', data: { userId: decoded.id, username: decoded.username, name: body.title, chatId: `GC_${code}`, users: [decoded.id], type: 'occasion', isGroup: true } }),
  ]);

  await snsHelper.pushToSNS('post-bg-tasks', { service: 'post', component: 'post', action: 'add', data: { userId: decoded.id, parentId: `occasion_${insertId}`, type: 'join', status: 'A' } });
  // TODO send an alert to indicate new occasion event was created
  request.pathParameters = { occasionId: insertId };
  await redis.set('{occasion}_recent_id', JSON.stringify(insertId));
  return getOccasion(request);
}

async function updateOccasion(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId } = pathParameters;
  logger.info('occasion update request');
  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (muObj.role < OCCASION_CONFIG.ROLES.admin.role || muObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
  const user = await rdsUsers.getUserFields(decoded.id, ['name', 'username']);

  const tasks = [];
  if (body.title || body.url) {
    logger.info('occasion chat needs update');
    const occasion = await rdsOccasions.getOccasion(occasionId);
    const url = body.url || occasion.url;
    const title = body.title || occasion.name;
    await snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'chat', action: 'edit', data: { userId: decoded.id, username: decoded.username, name: title, url, chatId: `GC_${occasion.code}` } });
  }

  if (body.extras?.groomId) {
    const gMuObj = { userId: body.extras.groomId, occasionId, role: OCCASION_CONFIG.ROLES.admin.role, status: OCCASION_CONFIG.status.verified, side: 'G', verifierId: decoded.id };
    tasks.push(rdsOUsers.newOrUpdateUser(gMuObj));
  }
  if (body.extras?.brideId) {
    const bMuObj = { userId: body.extras.brideId, occasionId, role: OCCASION_CONFIG.ROLES.admin.role, status: OCCASION_CONFIG.status.verified, side: 'B', verifierId: decoded.id };
    tasks.push(rdsOUsers.newOrUpdateUser(bMuObj));
  }
  if (body.side && muObj.side !== body.side) tasks.push(rdsOUsers.updateUser(occasionId, decoded.id, { side: body.side }));
  if (body.side) delete body.side;
  if (body.fromTime) body.fromTime = common.convertToDate(body.fromTime);
  if (body.tillTime) body.tillTime = common.convertToDate(body.tillTime);

  // tasks.push(snsHelper.pushToSNS('emails', { service: 'email', component: 'occasion', action: 'update', data: { comment: 'occasion details updated', id: occasionId, userId: decoded.id, ...body } }));
  tasks.push(rdsOccasions.updateOccasion(occasionId, body));
  tasks.push(snsHelper.pushToSNS('fcm', {
    service: 'notification',
    component: 'notification',
    action: 'new',
    data: {
      id: occasionId,
      type: 'default',
      title: 'Occasion Details Updated!',
      topic: common.getTopicName('occasion.admin', occasionId),
      groupId: APP_NOTIFICATIONS.channels.occasion,
      subtitle: `@${user.username || user.name} has updated the occasion details🥳`,
      payload: { screen: `/occasions/${occasionId}`, params: { useCache: 'false' } },
    },
  }));
  await Promise.all(tasks);
  return getOccasion(request);
}

async function deleteOccasion(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId } = pathParameters;

  logger.info('occasion update request');
  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (muObj.role < OCCASION_CONFIG.ROLES.admin.role || muObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');

  const occasion = await rdsOccasions.getOccasion(occasionId);
  if (occasion.code !== body.code) errors.handleError(400, 'invalid occasion code');
  await snsHelper.pushToSNS('occasion-bg-tasks', { service: 'occasion', component: 'occasion', action: 'delete', data: { occasionId: parseInt(occasionId, 10), userId: decoded.id } });
  return { success: true };
}

async function joinOccasion(request) {
  const { decoded } = request;
  const { occasionId } = request.pathParameters;
  const side = _.has(request.queryStringParameters, 'side') ? request.queryStringParameters.side : null;
  if (side) logger.info('side parameter is provided');

  logger.info('join occasion request for ', occasionId);
  const [occasion, muObj] = await Promise.all([rdsOccasions.getOccasion(occasionId), rdsOUsers.getUser(occasionId, decoded.id)]);
  logger.info('requested user ', muObj);
  if (!_.isEmpty(muObj)) {
    if (muObj.status === OCCASION_CONFIG.status.verified) errors.handleError(409, 'already joined');
  }
  const user = await rdsUsers.getUserFields(decoded.id, ['name', 'username']);
  logger.info('joining user to occasion and sending fcm push');
  if (occasion.isPublic) {
    logger.info('public occasion, joining user');
    // added side: side || null
    await rdsOUsers.newOrUpdateUser({ userId: decoded.id, occasionId, role: OCCASION_CONFIG.ROLES.user.role, status: OCCASION_CONFIG.status.verified, side: side || null, isDeleted: false, verifierId: 0 });
  } else {
    let sideText;
    if (side === 'B') {
      sideText = 'Bride';
    } else if (side === 'G') {
      sideText = 'Groom';
    } else {
      sideText = 'event';
    }

    logger.info('private occasion, sending join request');

    await Promise.all([
      rdsOUsers.newOrUpdateUser({ userId: decoded.id, occasionId, role: OCCASION_CONFIG.ROLES.user.role, status: OCCASION_CONFIG.status.pending, side: side || null, isDeleted: false }),
      snsHelper.pushToSNS('fcm', {
        service: 'notification',
        component: 'notification',
        action: 'new',
        data: {
          id: occasionId,
          type: 'default',
          title: 'New Join Request',
          topic: common.getTopicName('occasion.admin', occasionId),
          groupId: APP_NOTIFICATIONS.channels.occasion,
          // subtitle: `@${user.username || user.name} is requesting to join the ${side === 'B' ? 'Bride' : 'Groom'} Squad!😍`,
          subtitle: `@${user.username || user.name} is requesting to join the ${sideText} Squad!😍`,
          payload: { screen: `/occasions/${occasionId}/users`, params: { useCache: 'false' } },
        },
      }),
    ]);
  }
  return getOccasion(request);
}

async function getOccasionAssets(request) {
  const { decoded } = request;
  const { occasionId } = request.pathParameters;

  logger.info('get occasion images request for ', occasionId);
  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (muObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
  return rdsAssets.getParentAssets(`occasion_${occasionId}`);
}

async function getOccasionUsers(request) {
  const { decoded } = request;
  const { occasionId } = request.pathParameters;

  logger.info('get occasion users request for ', occasionId);
  const muObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', muObj);
  if (_.isEmpty(muObj)) errors.handleError(404, 'no association with requested occasion');
  if (muObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');

  let wUsers;
  if (muObj.role < OCCASION_CONFIG.ROLES.admin.role) wUsers = await rdsOUsers.getVerifiedUsers(occasionId);
  else wUsers = await rdsOUsers.getUsers(occasionId);

  const userIds = wUsers.items.map((user) => user.userId);
  const miniProfiles = await rdsUsers.getUserFieldsIn(_.unique(userIds), constants.MINI_PROFILE_FIELDS);
  for (let i = 0; i < wUsers.count; i += 1) {
    [wUsers.items[i].user] = miniProfiles.items.filter((user) => user.id === wUsers.items[i].userId);
  }
  return wUsers;
}



async function invoke(event, context, callback) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': true };
  try {
    const request = access.validateRequest(event, context);

    let resp = {};
    switch (request.resourcePath) {
      case '/v1/list':
        resp = await getOccasions(request);
        break;

      case '/v1/new':
        resp = await createNewOccasion(request);
        break;

      case '/v1/{occasionId}':
        switch (request.httpMethod) {
          case 'GET': resp = await getOccasion(request);
            break;
          case 'PUT': resp = await updateOccasion(request);
            break;
          case 'DELETE': resp = await deleteOccasion(request);
            break;
          default: errors.handleError(400, 'invalid request path');
        }
        break;

      case '/v1/{occasionId}/join':
        resp = await joinOccasion(request);
        break;

      case '/v1/{occasionId}/assets':
        resp = await getOccasionAssets(request);
        break;

      case '/v1/{occasionId}/users':
        resp = await getOccasionUsers(request);
        break;

      case '/v1/{occasionId}/preview':
        resp = await getOccasionByCode(request);
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
