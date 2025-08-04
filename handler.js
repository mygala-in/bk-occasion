const _ = require('underscore');
const helper = require('./helper');
const logger = require('./bk-utils/logger');
const access = require('./bk-utils/access');
const errors = require('./bk-utils/errors');
const common = require('./bk-utils/common');
const constants = require('./bk-utils/constants');
const snsHelper = require('./bk-utils/sns.helper');
const redisHelper = require('./bk-utils/redis.helper');
const rdsUsers = require('./bk-utils/rds/rds.users.helper');
const rdsAssets = require('./bk-utils/rds/rds.assets.helper');
const rdsOccasions = require('./bk-utils/rds/rds.occasions.helper');
const rdsOUsers = require('./bk-utils/rds/rds.occasion.users.helper');
const rdsOEvents = require('./bk-utils/rds/rds.occasion.events.helper');
const rdsVendors = require('./bk-utils/rds/rds.vendor.helper');
const rdsRsvps = require('./bk-utils/rds/rds.occasion.rsvps.helper');

const { APP_NOTIFICATIONS, OCCASION_CONFIG, VENDOR_CONFIG } = constants;


async function getOccasion(request) {
  const { decoded, pathParameters, queryStringParameters } = request;
  const { occasionId } = pathParameters;
  let include = [];
  if (queryStringParameters && queryStringParameters.include) include = queryStringParameters.include.split(',');

  logger.info('get occasion request for ', { occasionId, include });
  const occasion = await rdsOccasions.getOccasion(occasionId);
  logger.info('occasion ', JSON.stringify(occasion));
  if (_.isEmpty(occasion)) errors.handleError(404, 'occasion not found');
  const gbhIds = []; // groom, bride & host Ids
  if (_.has(occasion.extras, 'brideId')) {
    if (!gbhIds.includes(occasion.extras.brideId)) gbhIds.push(occasion.extras.brideId);
  }
  if (_.has(occasion.extras, 'groomId')) {
    if (!gbhIds.includes(occasion.extras.groomId)) gbhIds.push(occasion.extras.groomId);
    logger.info('groom & bride ids ', JSON.stringify(gbhIds));
  }
  if (_.has(occasion.extras, 'hostId')) {
    if (!gbhIds.includes(occasion.extras.hostId)) gbhIds.push(occasion.extras.hostId);
    logger.info('groom & bride ids ', JSON.stringify(gbhIds));
  }

  if (decoded) {
    const ouObj = await rdsOUsers.getUser(occasion.id, decoded.id);
    logger.info('requested user ', ouObj);
    occasion.ouser = ouObj;
  }
  const [ouCounts, extras, gbUsers] = await Promise.all([
    rdsOUsers.getOUsersCounts(occasion.id),
    helper.occasionExtras(occasion.id, include),
    rdsUsers.getUserFieldsIn(gbhIds, [...constants.MINI_PROFILE_FIELDS, 'facebook', 'instagram', 'createdAt', 'updatedAt']),
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
    const gbhIds = []; // groom, bride & host Ids
    const [occasions, ouCounts] = await Promise.all([rdsOccasions.getOccasionsIn(oIds), rdsOUsers.getOUsersCountsIn(oIds)]);
    logger.info('occasions ', JSON.stringify(occasions));
    logger.info('ou counts ', JSON.stringify(ouCounts));
    for (let i = 0; i < occasions.count; i += 1) {
      const occasion = occasions.items[i];
      [occasion.ouser] = mJoins.items.filter((item) => item.occasionId === occasion.id);
      if (_.has(occasion.extras, 'brideId')) {
        if (occasion.extras.brideId && !gbhIds.includes(occasion.extras.brideId)) gbhIds.push(occasion.extras.brideId);
      }
      if (_.has(occasion.extras, 'groomId')) {
        if (occasion.extras.groomId && !gbhIds.includes(occasion.extras.groomId)) gbhIds.push(occasion.extras.groomId);
      }
      if (_.has(occasion.extras, 'hostId')) {
        if (occasion.extras.hostId && !gbhIds.includes(occasion.extras.hostId)) gbhIds.push(occasion.extras.hostId);
      }
      const [ouc] = ouCounts.items.filter((item) => item.occasionId === occasion.id);
      occasion.counts = ouc;
      occasions.items[i] = occasion;
    }
    logger.info('groom & bride ids ', JSON.stringify(gbhIds));
    const gbhUsers = await rdsUsers.getUserFieldsIn(gbhIds, [...constants.MINI_PROFILE_FIELDS, 'facebook', 'instagram', 'createdAt', 'updatedAt']);
    logger.info('gbhUsers ', JSON.stringify(gbhUsers));
    for (let i = 0; i < occasions.count; i += 1) {
      if (_.has(occasions.items[i].extras, 'brideId')) [occasions.items[i].extras.bride] = gbhUsers.items.filter((item) => item.id === occasions.items[i].extras.brideId);
      if (_.has(occasions.items[i].extras, 'groomId')) [occasions.items[i].extras.groom] = gbhUsers.items.filter((item) => item.id === occasions.items[i].extras.groomId);
      if (_.has(occasions.items[i].extras, 'hostId')) [occasions.items[i].extras.host] = gbhUsers.items.filter((item) => item.id === occasions.items[i].extras.hostId);
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

  // * oObj - occasion object
  const oObj = { creatorId: decoded.id, code };
  Object.assign(oObj, _.pick(body, ['title', 'note', 'type', 'fromTime', 'tillTime', 'isPublic', 'extras', 'url', 'locationId']));
  if (oObj.fromTime) oObj.fromTime = common.convertToDate(oObj.fromTime);
  if (oObj.tillTime) oObj.tillTime = common.convertToDate(oObj.tillTime);

  if (decoded.role >= 2) {
    logger.info('adding approved vendors to occasion');
    const vendors = await rdsVendors.getVendors(decoded.id);
    const vIds = vendors.items.filter((k) => k.status === VENDOR_CONFIG.status.approved).map((v) => v.id);
    if (!_.isEmpty(vIds)) Object.assign(oObj, { vendors: JSON.stringify(vIds) });
  }
  logger.info('new occasion object ', oObj);
  const { insertId } = await rdsOccasions.newOccasion(oObj);

  // * ouObj - occasion user object
  const ouObj = { userId: decoded.id, occasionId: insertId, role: OCCASION_CONFIG.ROLES.admin.role, status: OCCASION_CONFIG.status.verified, verifierId: decoded.id, rsvp: 'Y' };
  if (body.side) ouObj.side = body.side;
  await Promise.all([
    rdsOUsers.newUser(ouObj),
    redisHelper.set('{occasion}_recent', `${insertId}`),
    snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'chat', action: 'new', data: { userId: decoded.id, username: decoded.username, name: body.title, chatId: `GC_${code}`, users: [decoded.id], type: 'occasion', isGroup: true } }),
  ]);

  await snsHelper.pushToSNS('post-bg-tasks', { service: 'post', component: 'post', action: 'add', data: { userId: decoded.id, parentId: `occasion_${insertId}`, type: 'join', status: 'A' } });
  const user = await rdsUsers.getUserFields(decoded.id, [...constants.MINI_PROFILE_FIELDS, 'phone', 'role']);
  const message = { content: `**New Invite**:\nLink: https://link.mygala.in/${code}/invite\nCreator: \n${JSON.stringify(user, null, 2)}` };
  logger.info('pushing to discord-sns-notifier');
  await snsHelper.pushToSNS('discord-sns-notifier', { service: 'discord', channel: 'invite', action: 'notify', data: message });
  request.pathParameters = { occasionId: insertId };
  return getOccasion(request);
}

async function updateOccasion(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId } = pathParameters;
  logger.info('occasion update request');
  const ouObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', ouObj);
  if (_.isEmpty(ouObj)) errors.handleError(404, 'no association with requested occasion');
  if (ouObj.role < OCCASION_CONFIG.ROLES.admin.role || ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
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
  if (body.extras?.hostId) {
    const hMuObj = { userId: body.extras.hostId, occasionId, role: OCCASION_CONFIG.ROLES.admin.role, status: OCCASION_CONFIG.status.verified, verifierId: decoded.id };
    tasks.push(rdsOUsers.newOrUpdateUser(hMuObj));
  }
  if (body.vendors) body.vendors = JSON.stringify(body.vendors);
  if (body.side && ouObj.side !== body.side) tasks.push(rdsOUsers.updateUser(occasionId, decoded.id, { side: body.side }));
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
      payload: { screen: `/app/occasions/${occasionId}`, params: { useCache: 'false' } },
    },
  }));
  await Promise.all(tasks);
  return getOccasion(request);
}

async function deleteOccasion(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId } = pathParameters;

  logger.info('occasion update request');
  const ouObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', ouObj);
  if (_.isEmpty(ouObj)) errors.handleError(404, 'no association with requested occasion');
  if (ouObj.role < OCCASION_CONFIG.ROLES.admin.role || ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');

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
  const [occasion, ouObj] = await Promise.all([rdsOccasions.getOccasion(occasionId), rdsOUsers.getUser(occasionId, decoded.id)]);
  logger.info('requested user ', ouObj);
  if (!_.isEmpty(ouObj)) {
    if (ouObj.status === OCCASION_CONFIG.status.verified) errors.handleError(409, 'already joined');
  }
  const user = await rdsUsers.getUserFields(decoded.id, ['name', 'username']);
  logger.info('joining user to occasion and sending fcm push');
  if (occasion.isPublic) {
    logger.info('public occasion, joining user');
    await Promise.all([
      rdsOUsers.newOrUpdateUser({ userId: decoded.id, occasionId, role: OCCASION_CONFIG.ROLES.user.role, status: OCCASION_CONFIG.status.verified, side: side || null, isDeleted: false, verifierId: 0 }),
      snsHelper.pushToSNS('post-bg-tasks', { service: 'post', component: 'post', action: 'add', data: { userId: decoded.id, parentId: `occasion_${occasionId}`, type: 'join', status: 'A' } }),
      snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'cuser', action: 'add', data: { chatId: `GC_${occasion.code}`, by: { userId: decoded.id, username: decoded.username }, on: { userId: decoded.id, username: user.username } } }),
    ]);
  } else {
    let sideText = 'occasion';
    if (side === 'B') sideText = 'Bride';
    else if (side === 'G') sideText = 'Groom';
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
          payload: { screen: `/app/occasions/${occasionId}/users`, params: { useCache: 'false' } },
        },
      }),
    ]);
  }
  return getOccasion(request);
}

async function rsvpOccasion(request) {
  const { decoded } = request;
  const { occasionId } = request.pathParameters;
  const { rsvp } = request.body;
  logger.info('rsvp occasion request for ', occasionId);
  const ouObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', ouObj);
  if (_.isEmpty(ouObj)) errors.handleError(404, 'no association with requested occasion');
  if (ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');

  await rdsOUsers.updateUser(occasionId, decoded.id, { rsvp });
  return getOccasion(request);
}

async function getOccasionAssets(request) {
  const { decoded } = request;
  const { occasionId } = request.pathParameters;

  logger.info('get occasion images request for ', occasionId);
  const ouObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', ouObj);
  if (_.isEmpty(ouObj)) errors.handleError(404, 'no association with requested occasion');
  if (ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
  return rdsAssets.getParentAssets(`occasion_${occasionId}`);
}

async function getOccasionUsers(request) {
  const { decoded } = request;
  const { occasionId } = request.pathParameters;

  logger.info('get occasion users request for ', occasionId);
  const ouObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', ouObj);
  if (_.isEmpty(ouObj)) errors.handleError(404, 'no association with requested occasion');
  if (ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');

  let oUsers;
  if (ouObj.role < OCCASION_CONFIG.ROLES.admin.role) oUsers = await rdsOUsers.getVerifiedUsers(occasionId);
  else oUsers = await rdsOUsers.getUsers(occasionId);

  const userIds = oUsers.items.map((user) => user.userId);
  const miniProfiles = await rdsUsers.getUserFieldsIn(_.unique(userIds), constants.MINI_PROFILE_FIELDS);
  for (let i = 0; i < oUsers.count; i += 1) {
    [oUsers.items[i].user] = miniProfiles.items.filter((user) => user.id === oUsers.items[i].userId);
  }
  return oUsers;
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

  const [uObj, extras] = await Promise.all([
    rdsUsers.getUserFields(occasion.creatorId, [...constants.MINI_PROFILE_FIELDS, 'role']),
    helper.occasionExtras(occasion.id, include),
  ]);
  occasion.host = uObj;

  const rsvp = await rdsRsvps.getRsvpList(`occasion_${occasion.id}`);
  const yUsers = _.filter(rsvp.items, (user) => user.rsvp === 'Y');
  logger.info('yUsers', yUsers);
  if (!_.isEmpty(yUsers)) {
    let recentRsvp = _.first(yUsers, 5);
    const uIds = recentRsvp.filter((u) => u.userId).map((k) => k.userId);
    logger.info('recent rsvp user ids', uIds);
    const miniProfiles = await rdsUsers.getUserFieldsIn(uIds, constants.MINI_PROFILE_FIELDS);
    recentRsvp = recentRsvp.map((item) => {
      if (item.userId) {
        const user = miniProfiles.items.find((u) => u.id === item.userId);
        return { ...item, user };
      }
      return item;
    });
    const count = _.reduce(yUsers, (sum, user) => sum + (user.guests || 0), 0) + yUsers.length;
    occasion.rsvpSummary = { entity: 'rsvp', count, users: recentRsvp };
  }

  logger.info('extras ', JSON.stringify(extras));
  Object.assign(occasion, { ...extras });
  return occasion;
}

async function getOccasionUser(request) {
  const { decoded } = request;
  const { occasionId, userId } = request.pathParameters;
  logger.info('get occasion user request for ', { occasionId, userId });
  const [oUsers, user] = await Promise.all([rdsOUsers.getUsersIn(occasionId, [decoded.id, userId]), rdsUsers.getUserFields(userId, constants.MINI_PROFILE_FIELDS)]);
  const ouObj = _.find(oUsers.items, (u) => `${u.userId}` === `${decoded.id}`);
  const ouOnObj = _.find(oUsers.items, (u) => `${u.userId}` === `${userId}`);
  if (_.isEmpty(ouOnObj)) errors.handleError(404, 'user not found');
  logger.info('requested user ', ouObj);

  if (_.isEmpty(ouObj)) errors.handleError(404, 'no association with requested occasion');
  if (ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
  ouOnObj.user = user;
  return ouOnObj;
}

async function actionOnUser(request) {
  const { decoded } = request;
  const { occasionId, userId } = request.pathParameters;
  const { action, side } = request.queryStringParameters;
  logger.info(`performing ${action} action on occasion ${occasionId} and user ${userId}`);

  const [oUsers, occasion, user] = await Promise.all([rdsOUsers.getUsersIn(occasionId, [decoded.id, userId]), rdsOccasions.getOccasion(occasionId), rdsUsers.getUserFields(userId, constants.MINI_PROFILE_FIELDS)]);
  logger.info(oUsers);
  if (_.isEmpty(oUsers)) errors.handleError(500, 'something went wrong');
  const ouObj = _.find(oUsers.items, (u) => `${u.userId}` === `${decoded.id}`);
  const ouOnObj = _.find(oUsers.items, (u) => `${u.userId}` === `${userId}`);
  if (!ouObj || !ouOnObj) errors.handleError(404, 'user not found');
  logger.info('requested by user ', ouObj);
  logger.info('requested on user ', ouOnObj);
  if (_.isEmpty(ouObj)) errors.handleError(404, 'no association with requested occasion');
  let sideText = 'occasion';
  if (side === 'B') sideText = 'Bride';
  else if (side === 'G') sideText = 'Groom';

  const updateObj = {};
  switch (action) {
    // * - while approving join request
    case 'verify':
      if (ouObj.role < OCCASION_CONFIG.ROLES.admin.role || ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
      await Promise.all([
        rdsOUsers.updateUser(occasionId, userId, { status: OCCASION_CONFIG.status.verified, verifierId: decoded.id }),
        snsHelper.pushToSNS('post-bg-tasks', { service: 'post', component: 'post', action: 'add', data: { userId, parentId: `occasion_${occasionId}`, type: 'join', status: 'A' } }),
        snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'cuser', action: 'add', data: { chatId: `GC_${occasion.code}`, by: { userId: decoded.id, username: decoded.username }, on: { userId, username: user.username } } }),
        snsHelper.pushToSNS('fcm', {
          service: 'notification',
          component: 'notification',
          action: 'new',
          data: {
            id: occasionId,
            type: 'default',
            title: 'Join Request Approved!!',
            topic: common.getTopicName('user', userId),
            groupId: APP_NOTIFICATIONS.channels.occasion,
            subtitle: `Welcome to ${sideText} squad! 🎉`,
            payload: { screen: `/app/occasions/${occasionId}/users`, params: { useCache: 'false' } },
          },
        }),
      ]);
      return getOccasionUser(request);

    // * - while removing verified user
    case 'remove':
      if (ouObj.role < OCCASION_CONFIG.ROLES.admin.role || ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
      if (`${occasion.groomId}` === `${userId}`) updateObj.groomId = null;
      if (`${occasion.brideId}` === `${userId}`) updateObj.brideId = null;
      logger.info({ updateObj });
      if (Object.keys(updateObj).length > 0) await rdsOccasions.updateOccasion(occasionId, updateObj);
      await Promise.all([
        rdsOUsers.removeUser(occasionId, userId),
        snsHelper.pushToSNS('post-bg-tasks', { service: 'post', component: 'occasion', action: 'exit', data: { userId, occasionId } }),
        snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'cuser', action: 'delete', data: { chatId: `GC_${occasion.code}`, by: { userId: decoded.id, username: decoded.username }, on: { userId, username: user.username } } }),
        snsHelper.pushToSNS('fcm', {
          service: 'notification',
          component: 'notification',
          action: 'new',
          data: {
            id: occasionId,
            type: 'default',
            title: 'Occasion update',
            subtitle: 'Occasion update',
            topic: common.getTopicName('user', userId),
            groupId: APP_NOTIFICATIONS.channels.occasion,
            payload: { hidden: true, tasks: ['/occasion/delete'], params: { occasionId } },
          },
        }),
      ]);
      return { success: true };

    case 'exit':
      // exit is not allowed for admins, they can only do full delete of occasion
      if (ouOnObj.userId !== decoded.id || ouObj.role === OCCASION_CONFIG.ROLES.admin.role) errors.handleError(401, 'unauthorised');
      if (`${occasion.groomId}` === `${userId}`) updateObj.groomId = null;
      if (`${occasion.brideId}` === `${userId}`) updateObj.brideId = null;
      logger.info({ updateObj });
      if (Object.keys(updateObj).length > 0) await rdsOccasions.updateOccasion(occasionId, updateObj);
      await Promise.all([
        rdsOUsers.removeUser(occasionId, userId),
        snsHelper.pushToSNS('post-bg-tasks', { service: 'post', component: 'occasion', action: 'exit', data: { userId, occasionId } }),
        snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'cuser', action: 'delete', data: { chatId: `GC_${occasion.code}`, by: { userId: decoded.id, username: decoded.username }, on: { userId, username: user.username } } }),
        snsHelper.pushToSNS('fcm', {
          service: 'notification',
          component: 'notification',
          action: 'new',
          data: {
            id: occasionId,
            type: 'default',
            title: 'Occasion update',
            subtitle: 'Occasion update',
            topic: common.getTopicName('user', userId),
            groupId: APP_NOTIFICATIONS.channels.occasion,
            payload: { hidden: true, tasks: ['/occasion/delete'], params: { occasionId } },
          },
        }),
      ]);
      return { success: true };

    // * - while making admin back as user or while approving rejected user
    case 'user':
      if (ouObj.role < OCCASION_CONFIG.ROLES.admin.role || ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
      await Promise.all([
        rdsOUsers.updateUser(occasionId, userId, { status: OCCASION_CONFIG.status.verified, role: OCCASION_CONFIG.ROLES.user.role, verifierId: decoded.id }),
        snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'cuser', action: 'edit', data: { chatId: `GC_${occasion.code}`, isAdmin: false, by: { userId: decoded.id, username: decoded.username }, on: { userId, username: user.username } } }),
        snsHelper.pushToSNS('fcm', {
          service: 'notification',
          component: 'notification',
          action: 'new',
          data: {
            id: occasionId,
            type: 'default',
            title: 'Role updated',
            topic: common.getTopicName('user', userId),
            groupId: APP_NOTIFICATIONS.channels.occasion,
            subtitle: `@${decoded.username} has updated your role, tap to view!`,
            payload: { screen: `/app/occasions/${occasionId}/users`, params: { useCache: 'false' } },
          },
        }),
      ]);
      return getOccasionUser(request);

    // * - while making watcher/user as admin
    case 'admin':
      if (ouObj.role < OCCASION_CONFIG.ROLES.admin.role || ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
      await rdsOUsers.updateUser(occasionId, userId, { role: OCCASION_CONFIG.ROLES.admin.role, verifierId: decoded.id });
      await snsHelper.pushToSNS('chat-bg-tasks', { service: 'chat', component: 'cuser', action: 'edit', data: { chatId: `GC_${occasion.code}`, isAdmin: true, by: { userId: decoded.id, username: decoded.username }, on: { userId, username: user.username } } });
      await snsHelper.pushToSNS('fcm', {
        service: 'notification',
        component: 'notification',
        action: 'new',
        data: {
          id: occasionId,
          type: 'default',
          title: 'You are now an Admin',
          topic: common.getTopicName('user', userId),
          groupId: APP_NOTIFICATIONS.channels.occasion,
          subtitle: `@${decoded.username} has made you occasion Admin. Tap to view!`,
          payload: { screen: `/app/occasions/${occasionId}`, params: { useCache: 'false' } },
        },
      });
      return getOccasionUser(request);


    // * - while user changing his side
    case 'side':
      if (ouObj.role < OCCASION_CONFIG.ROLES.user.role || ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');
      await rdsOUsers.updateUser(occasionId, userId, { status: ouObj.role < OCCASION_CONFIG.ROLES.admin.role ? OCCASION_CONFIG.status.pending : OCCASION_CONFIG.status.verified, side });
      await snsHelper.pushToSNS('fcm', {
        service: 'notification',
        component: 'notification',
        action: 'new',
        data: {
          id: occasionId,
          type: 'default',
          title: 'Change squad request',
          topic: common.getTopicName('occasion.admin', occasionId),
          groupId: APP_NOTIFICATIONS.channels.occasion,
          subtitle: `@${user.username || user.name} is requesting to join the ${sideText} Squad! 😍`,
          payload: { screen: `/app/occasions/${occasionId}/users`, params: { useCache: 'false' } },
        },
      });
      return getOccasionUser(request);

    default: return errors.handleError(400, 'invalid action');
  }
}

async function getOccasionVendors(request) {
  const { occasionId } = request.pathParameters;
  const resp = { entity: 'collection', items: [], count: 0 };
  const { vendors } = await rdsOccasions.getOccasion(occasionId);
  if (_.isEmpty(vendors)) return resp;
  logger.info('occasion vendors', vendors);

  const oVendors = await rdsVendors.getVendorsIn(vendors);
  const uIds = oVendors.items.map((v) => v.creatorId);
  const vUsers = await rdsUsers.getUserFieldsIn(uIds, constants.MINI_PROFILE_FIELDS);
  resp.items = oVendors.items.map((v) => ({
    ...common.purgePrivates(constants.VENDOR_CONFIG.PRIVATE_FIELDS, v),
    user: vUsers.items.find((u) => u.id === v.creatorId),
  }));
  resp.count = oVendors.count;
  return resp;
}

async function updateOccasionAccounts(request) {
  const { decoded, pathParameters, body } = request;
  const { occasionId } = pathParameters;

  const ouObj = await rdsOUsers.getUser(occasionId, decoded.id);
  logger.info('requested user ', ouObj);
  if (_.isEmpty(ouObj)) errors.handleError(404, 'no association with requested occasion');
  if (ouObj.role < OCCASION_CONFIG.ROLES.admin.role || ouObj.status !== OCCASION_CONFIG.status.verified) errors.handleError(401, 'unauthorized');

  const accountIds = Object.values(body.accounts);
  const users = await rdsUsers.getUserByAccounts(accountIds);
  if (_.isEmpty(users) || users.items.length !== accountIds.length) errors.handleError(404, 'one or more users not found for provided account IDs');

  const userIds = users.items.map((user) => user.id);
  const oUsers = await rdsOUsers.getUsersIn(occasionId, userIds);
  if (oUsers.count !== userIds.length) errors.handleError(404, 'one or more users not found in occasion');


  Object.entries(body.accounts).forEach(([side, accountId]) => {
    const user = users.items.find((u) => u.accountId === accountId);
    const oUser = oUsers.items.find((ou) => ou.userId === user.id);

    if (oUser.role < OCCASION_CONFIG.ROLES.admin.role) {
      errors.handleError(401, `user with account ${accountId} is not an admin`);
    }
    if (oUser.status !== OCCASION_CONFIG.status.verified) {
      errors.handleError(401, `user with account ${accountId} is not verified`);
    }
    if ((side === 'B' || side === 'G') && oUser.side !== side) {
      errors.handleError(401, `user with account ${accountId} has incorrect side assignment`);
    }
  });

  await rdsOccasions.updateOccasion(occasionId, { accounts: JSON.stringify(body.accounts) });
  return getOccasion(request);
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

      case '/v1/{occasionId}/rsvp':
        resp = await rsvpOccasion(request);
        break;

      case '/v1/{occasionId}/assets':
        resp = await getOccasionAssets(request);
        break;

      case '/v1/{occasionId}/users':
        resp = await getOccasionUsers(request);
        break;

      case '/v1/{occasionId}/invite':
        resp = await getOccasionByCode(request);
        break;

      case '/v1/{occasionId}/user/{userId}':
        resp = await actionOnUser(request);
        break;

      case '/v1/{occasionId}/vendors/list':
        resp = await getOccasionVendors(request);
        break;

      case '/v1/{occasionId}/accounts':
        resp = await updateOccasionAccounts(request);
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
